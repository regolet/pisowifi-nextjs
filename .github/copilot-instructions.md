# PISOWifi Copilot Instructions

## Project Overview
This is a **coin-operated WiFi hotspot system** (Filipino "Piso WiFi") built for deployment on Orange Pi hardware. Despite the name `pisowifi-nextjs`, this is **Express.js only** — the Next.js frontend was removed. The system manages internet access via iptables, handling coin insertion through GPIO, client authentication by MAC address, and captive portal redirection.

## Architecture

### Core Components
- **[server/app.js](../server/app.js)** - Express server with captive portal, WebSocket (Socket.IO), and admin UI
- **[services/gpio-bridge.js](../services/gpio-bridge.js)** - Standalone GPIO service for coin detection via Orange Pi Python GPIO library
- **[server/db/sqlite-adapter.js](../server/db/sqlite-adapter.js)** - Primary database adapter (SQLite via better-sqlite3)
- **[server/db/adapter.js](../server/db/adapter.js)** - Database abstraction supporting PostgreSQL fallback via `DATABASE_URL`

### Key Data Flow
1. Unauthenticated devices → DNS hijack → Captive portal detection endpoints → `/portal`
2. User inserts coin → GPIO pulse → WebSocket event → Time credited to client
3. Client authenticated → iptables rule added → Internet access granted
4. Session expires → iptables rule removed → Back to captive portal

## Development Commands
```bash
npm run dev          # Start Express server (port 3000)
npm run gpio         # Start GPIO bridge service (port 3001) - requires Orange Pi
npm run create-admin # Create initial admin user (requires DATABASE_URL for PostgreSQL)
```

For SQLite admin creation, use `scripts/create-admin-sqlite.js` directly.

## Database Conventions

### Query Parameter Style
Use **PostgreSQL-style placeholders** (`$1`, `$2`) even for SQLite — the adapter translates them:
```javascript
// Correct - works with both SQLite and PostgreSQL
await db.query('SELECT * FROM clients WHERE mac_address = $1', [macAddress]);

// Wrong - don't use named parameters or ?
await db.query('SELECT * FROM clients WHERE mac_address = ?', [macAddress]);
```

### Important Tables
- `clients` - Connected devices (MAC, IP, time_remaining, status)
- `coin_slots` - Available coin acceptor slots with claim/expire logic
- `rates` - Time-to-coin conversion rates
- `sessions` - Active/historical connection sessions
- `portal_settings` - Customizable portal appearance

## Security Patterns

### Input Validation (CRITICAL)
All user input passed to shell commands **must** be validated using [server/utils/validators.js](../server/utils/validators.js):
```javascript
const { isValidMacAddress, sanitizeMacAddress, isValidIPv4 } = require('../utils/validators');

// Always validate before shell execution
if (!isValidMacAddress(macAddress)) {
  return res.status(400).json({ error: 'Invalid MAC address format' });
}
const safeMac = sanitizeMacAddress(macAddress);
await execAsync(`sudo ${scriptsPath}/pisowifi-allow-client ${safeMac}`);
```

### Authentication
- Admin routes use `authenticateAdmin` middleware (redirects to login)
- API routes use `authenticateAPI` middleware (returns 401 JSON)
- JWT stored in `auth-token` cookie; secret via `JWT_SECRET` env var

## Captive Portal Detection
Routes in [server/routes/captive-enhanced.js](../server/routes/captive-enhanced.js) handle OS-specific detection:
- Apple: `/hotspot-detect.html`, `/library/test/success.html`
- Android: `/generate_204`, `/gen_204`
- Windows: `/connecttest.txt`, `/ncsi.txt`

All redirect unauthenticated clients to `/portal`.

## Network Scripts
Shell scripts in `scripts/` manage iptables (require `sudo`):
- `pisowifi-allow-client <MAC>` - Grant internet access
- `pisowifi-block-client <MAC>` - Revoke access
- `pisowifi-list-clients` - Show authenticated clients
- Ethernet variants exist with `-ethernet` suffix

## Client Identification Priority
The system identifies clients in this order (see [server/routes/portal.js](../server/routes/portal.js#L44-L91)):
1. **MAC address** (most reliable, from ARP/neighbor table)
2. **Session token** (fallback for random MAC addresses)
3. **IP address** (least reliable, last resort)

## API Structure
Routes follow RESTful patterns under `/api`:
- `/api/clients` - Client management
- `/api/coin-slots` - Coin slot claiming/release
- `/api/settings` - System configuration
- `/api/transactions` - Payment history

Admin pages served from `/admin/*` use EJS templates in `server/views/pages/`.

## Environment Variables
| Variable | Purpose | Required |
|----------|---------|----------|
| `JWT_SECRET` | Token signing (32+ chars in production) | Production |
| `DATABASE_URL` | PostgreSQL connection string | For PostgreSQL |
| `GPIO_PIN_COIN` | Coin sensor GPIO pin number | Orange Pi |
| `GPIO_PIN_LED` | Status LED GPIO pin | Orange Pi |
| `PISOWIFI_INTERFACE` | Network interface (default: wlan0) | Optional |
