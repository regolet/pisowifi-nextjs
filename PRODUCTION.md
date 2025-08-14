# PISOWifi Production Setup

## Essential Scripts

The following scripts are the only ones needed for production deployment:

### **Setup & Installation**
- `scripts/setup-autostart-services.sh` - Complete production setup with auto-start services
- `scripts/create-admin.js` - Create admin user for dashboard access

### **Database**
- `scripts/create-base-tables.sql` - Database schema
- `scripts/coin-slots-migration.sql` - Coin slot tables
- `scripts/network-config-migration.sql` - Network configuration tables
- `scripts/run-base-tables-migration.js` - Database migration runner
- `scripts/run-coin-slots-migration.js` - Coin slots migration runner

### **Network Management**
- `scripts/pisowifi-allow-client` - Allow client internet access
- `scripts/pisowifi-allow-client-ethernet` - Allow client (ethernet version)
- `scripts/pisowifi-block-client` - Block client internet access
- `scripts/pisowifi-block-client-ethernet` - Block client (ethernet version)
- `scripts/pisowifi-list-clients` - List connected clients
- `scripts/pisowifi-list-clients-ethernet` - List clients (ethernet version)
- `scripts/pisowifi-reset-ethernet` - Reset ethernet configuration

## Production Deployment

### 1. Initial Setup
```bash
# Clone repository
git clone https://github.com/regolet/pisowifi-nextjs.git
cd pisowifi-nextjs

# Install dependencies
npm install

# Setup database
node scripts/run-base-tables-migration.js
node scripts/run-coin-slots-migration.js

# Create admin user
node scripts/create-admin.js
```

### 2. Production Services
```bash
# Setup auto-start services (run once)
sudo chmod +x scripts/setup-autostart-services.sh
sudo ./scripts/setup-autostart-services.sh
```

This creates systemd services:
- `pisowifi-network.service` - Network configuration
- `pisowifi-dhcp.service` - DHCP/DNS server
- `pisowifi-portal.service` - Web portal server

### 3. Service Management
```bash
# Check service status
systemctl status pisowifi-portal.service
systemctl status pisowifi-dhcp.service
systemctl status pisowifi-network.service

# View logs
journalctl -u pisowifi-portal.service -f
journalctl -u pisowifi-dhcp.service -f

# Restart services
systemctl restart pisowifi-network pisowifi-dhcp pisowifi-portal
```

### 4. Access Points
- **Admin Panel**: `http://[orange-pi-ip]:3000/admin`
  - Username: `admin`
  - Password: `admin123`
- **Client Portal**: `http://192.168.100.1:3000/portal`
- **Client Network**: 192.168.100.10 - 192.168.100.50

## Network Architecture

```
[Internet] ← → [Orange Pi end0] ← → [Orange Pi enx00e04c68276e] ← → [Client Devices]
              192.168.1.x                192.168.100.1              192.168.100.10-50
```

- **WAN Interface**: `end0` (connects to internet)
- **LAN Interface**: `enx00e04c68276e` (serves PISOWifi clients)
- **DHCP Server**: Serves 192.168.100.10-50 to clients
- **DNS Hijacking**: All domains redirect to portal until authenticated
- **HTTP Interception**: All web traffic redirects to portal

## Features

### ✅ Auto-Start & Recovery
- All services start automatically on boot
- Services restart automatically if they crash
- Proper dependency management between services

### ✅ Captive Portal
- Automatic detection by all device types (iOS, Android, Windows)
- DNS hijacking redirects all domains to portal
- HTTP/HTTPS traffic interception

### ✅ Client Management
- Real-time client monitoring
- Coin-based time allocation
- Internet access control per client

### ✅ Admin Dashboard
- Revenue tracking
- Client management
- System monitoring
- Rate configuration

## Production Notes

- All temporary setup/debug scripts have been removed
- System is configured for reliable 24/7 operation
- Services automatically recover from failures
- Network configuration persists across reboots
- Database handles concurrent client connections
- Logging available via journalctl for troubleshooting