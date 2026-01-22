const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const { securityHeaders, secureErrorHandler, authenticateAPI } = require('./middleware/security');
const { isValidIPv4 } = require('./utils/validators');
const { logSystemEvent } = require('./utils/system-logger');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Security middleware - re-enabled with sensible defaults
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://cdn.jsdelivr.net"], // Required for inline scripts and Chart.js
      "script-src-attr": ["'self'", "'unsafe-inline'"], // Allow inline event handlers
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"], // Required for inline styles
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "ws:", "wss:", "http://localhost:*", "https://localhost:*", "http://127.0.0.1:*", "https://127.0.0.1:*", "http:", "https:"], // For WebSocket, API calls and Chrome DevTools
      fontSrc: ["'self'", "https:", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'", "blob:"],
      frameSrc: ["'none'"]
    }
  },
  hsts: false,  // Disable HSTS for local network
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: { policy: "same-origin" },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  noSniff: true, // Enable X-Content-Type-Options
  xssFilter: true // Enable X-XSS-Protection
}));

// Additional security headers
app.use(securityHeaders);

app.use(compression());
app.use(morgan('combined'));

// CORS - restricted to allowed origins
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);

    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:80',
      'http://127.0.0.1:3000',
      'http://10.0.0.1',
      'http://10.0.0.1:80',
      'http://pisowifi.local',
      /^http:\/\/10\.0\.0\.[0-9]{1,3}(:[0-9]+)?$/  // Allow local network
    ];

    const isAllowed = allowedOrigins.some(allowed => {
      if (allowed instanceof RegExp) return allowed.test(origin);
      return allowed === origin;
    });

    if (isAllowed) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Force HTTP for local PISOWifi network (prevent HTTPS redirects)
app.use((req, res, next) => {
  // Remove any HTTPS enforcement headers
  res.removeHeader('Strict-Transport-Security');
  res.removeHeader('Cross-Origin-Opener-Policy');
  res.removeHeader('Cross-Origin-Resource-Policy');
  res.removeHeader('Cross-Origin-Embedder-Policy');
  res.removeHeader('Origin-Agent-Cluster');

  // Set headers to prefer HTTP and disable HTTPS caching
  res.setHeader('X-Force-HTTP', 'true');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  // If someone tries HTTPS, redirect to HTTP
  if (req.headers['x-forwarded-proto'] === 'https' || req.secure) {
    return res.redirect(301, `http://${req.headers.host}${req.originalUrl}`);
  }

  next();
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views/pages'));

// Debug route for troubleshooting - PROTECTED (requires admin auth)
app.get('/debug-status', authenticateAPI, async (req, res) => {
  try {
    const db = require('./db/sqlite-adapter');

    // Get client IP
    let clientIP = req.headers['x-forwarded-for'] ||
      req.headers['x-real-ip'] ||
      req.connection.remoteAddress ||
      req.socket.remoteAddress ||
      (req.connection.socket ? req.connection.socket.remoteAddress : null);

    if (clientIP && clientIP.startsWith('::ffff:')) {
      clientIP = clientIP.substring(7);
    }

    if (clientIP && clientIP.includes(':') && !clientIP.includes('::')) {
      clientIP = clientIP.split(':')[0];
    }

    console.log(`[DEBUG STATUS] Request from IP: ${clientIP}`);

    // Get all clients from database
    const allClients = await db.query('SELECT * FROM clients ORDER BY last_seen DESC');
    const authClients = await db.query(
      'SELECT * FROM clients WHERE status = $1 AND time_remaining > 0 ORDER BY last_seen DESC',
      ['CONNECTED']
    );
    const activeSessions = await db.query(
      'SELECT * FROM sessions WHERE status = $1 ORDER BY started_at DESC',
      ['ACTIVE']
    );

    // Try to detect current client's MAC
    let detectedMac = null;
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const { stdout: arpOutput } = await execAsync(`arp -n ${clientIP} 2>/dev/null || echo ""`);
      if (arpOutput) {
        const arpMatch = arpOutput.match(/([0-9a-fA-F]{2}[:-]){5}([0-9a-fA-F]{2})/);
        if (arpMatch) {
          detectedMac = arpMatch[0].toUpperCase();
        }
      }
    } catch (error) {
      console.warn('MAC detection failed:', error.message);
    }

    console.log(`[DEBUG STATUS] Detected MAC: ${detectedMac}`);
    console.log(`[DEBUG STATUS] Found ${authClients.rows.length} authenticated clients in database`);

    const debugInfo = {
      timestamp: new Date().toISOString(),
      request_info: {
        client_ip: clientIP,
        detected_mac: detectedMac,
        user_agent: req.headers['user-agent']
      },
      database_state: {
        total_clients: allClients.rows.length,
        authenticated_clients: authClients.rows.length,
        active_sessions: activeSessions.rows.length
      },
      all_clients: allClients.rows.map(c => ({
        id: c.id,
        mac_address: c.mac_address,
        ip_address: c.ip_address,
        status: c.status,
        time_remaining: c.time_remaining,
        device_name: c.device_name,
        last_seen: c.last_seen
      })),
      authenticated_clients: authClients.rows.map(c => ({
        id: c.id,
        mac_address: c.mac_address,
        ip_address: c.ip_address,
        status: c.status,
        time_remaining: c.time_remaining,
        device_name: c.device_name,
        last_seen: c.last_seen
      })),
      active_sessions: activeSessions.rows
    };

    res.json(debugInfo);
  } catch (error) {
    console.error('Debug status error:', error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

// Captive portal detection routes (MUST be first, before auth middleware)
// Using enhanced captive portal with better device support
app.use('/', require('./routes/captive-enhanced'));

// Admin routes (before auth middleware to allow admin access from any IP)
app.use('/admin', require('./routes/admin'));

// Global catch-all middleware for unauthenticated access
// This ensures any HTTP request from non-authenticated clients gets redirected
app.use(async (req, res, next) => {
  // Skip authentication for portal, API, admin routes, debug, captive detection, and static files
  if (req.path.startsWith('/portal') ||
    req.path.startsWith('/api') ||
    req.path.startsWith('/admin') ||
    req.path.startsWith('/debug-status') ||
    req.path.startsWith('/socket.io') ||
    req.path === '/hotspot-detect.html' ||
    req.path === '/library/test/success.html' ||
    req.path === '/generate_204' ||
    req.path === '/gen_204' ||
    req.path === '/connecttest.txt' ||
    req.path === '/ncsi.txt' ||
    req.path === '/connectivity-check.html' ||
    req.path === '/canonical.html' ||
    req.path === '/success.txt' ||
    req.path === '/chrome-variations/seed' ||
    req.path === '/redirect' ||
    req.path.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$/)) {
    return next();
  }

  try {
    // Get client IP
    let clientIP = req.headers['x-forwarded-for'] ||
      req.headers['x-real-ip'] ||
      req.connection.remoteAddress ||
      req.socket.remoteAddress ||
      (req.connection.socket ? req.connection.socket.remoteAddress : null);

    if (clientIP && clientIP.startsWith('::ffff:')) {
      clientIP = clientIP.substring(7);
    }

    if (clientIP && clientIP.includes(':') && !clientIP.includes('::')) {
      clientIP = clientIP.split(':')[0];
    }

    // Try to get MAC address using multiple methods
    let detectedMac = null;
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    try {
      // Try ARP table
      const { stdout: arpOutput } = await execAsync(`arp -n ${clientIP} 2>/dev/null || echo ""`);
      if (arpOutput) {
        const arpMatch = arpOutput.match(/([0-9a-fA-F]{2}[:-]){5}([0-9a-fA-F]{2})/);
        if (arpMatch) {
          detectedMac = arpMatch[0].toUpperCase();
        }
      }

      // Try neighbor table if ARP failed
      if (!detectedMac) {
        const { stdout: neighborOutput } = await execAsync(`ip neighbor show 2>/dev/null || echo ""`);
        const neighborLines = neighborOutput.split('\n');
        for (const line of neighborLines) {
          if (line.includes(clientIP)) {
            const macMatch = line.match(/([0-9a-fA-F]{2}[:-]){5}([0-9a-fA-F]{2})/);
            if (macMatch) {
              detectedMac = macMatch[0].toUpperCase();
              break;
            }
          }
        }
      }
    } catch (error) {
      console.warn('MAC detection failed in auth middleware:', error.message);
    }

    // Check if client is authenticated
    if (detectedMac) {
      const db = require('./db/sqlite-adapter');
      const authCheck = await db.query(
        'SELECT * FROM clients WHERE mac_address = $1 AND status = $2 AND time_remaining > 0',
        [detectedMac, 'CONNECTED']
      );

      if (authCheck.rows.length > 0) {
        // Client is authenticated, allow through
        return next();
      }
    }

    // Client is not authenticated, redirect to portal
    return res.redirect(302, `/portal?redirect=${encodeURIComponent(req.originalUrl)}`);

  } catch (error) {
    console.warn('Auth middleware error:', error.message);
    // On error, redirect to portal to be safe
    return res.redirect(302, '/portal');
  }
});

// Routes
app.use('/portal', require('./routes/portal'));
app.use('/api', require('./routes/api'));
app.use('/', require('./routes/index'));

// Socket.io for real-time coin detection
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('coin-inserted', (data) => {
    io.emit('coin-detected', data);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // Listen on all interfaces

server.listen(PORT, HOST, async () => {
  console.log(`🚀 PISOWifi Express server running on ${HOST}:${PORT}`);
  logSystemEvent('info', `Server started on ${HOST}:${PORT}`, 'system');
  console.log(`📡 Portal accessible at:`);
  console.log(`   - http://localhost:${PORT}/portal`);
  console.log(`   - http://10.0.0.1/portal`);
  console.log(`   - http://[your-ip]:${PORT}/portal`);

  // Initialize network stack for captive portal
  try {
    const NetworkManager = require('./services/network-manager');
    const networkManager = new NetworkManager();
    const result = await networkManager.initializeNetworkStack();
    if (result.success) {
      console.log('✅ Network stack initialized: Captive portal ready');
    } else {
      console.log('⚠️ Network initialization warning:', result.error);
      logSystemEvent('warn', `Network initialization warning: ${result.error}`, 'network');
    }
  } catch (error) {
    console.log('⚠️ Network manager not available:', error.message);
    logSystemEvent('warn', `Network manager not available: ${error.message}`, 'network');
  }

  // Initialize DNS interceptor for captive portal (optional)
  if (process.env.ENABLE_DNS_INTERCEPTOR === 'true') {
    try {
      const DNSInterceptor = require('./services/dns-interceptor');
      const dnsInterceptor = new DNSInterceptor({
        portalIP: process.env.PISOWIFI_GATEWAY || '10.0.0.1'
      });
      await dnsInterceptor.start();
      console.log('✅ DNS Interceptor started for enhanced captive portal');
    } catch (error) {
      console.log('⚠️ DNS Interceptor not available:', error.message);
    }
  }

  // Auto-reconnect WAN on boot (DHCP or PPPoE)
  try {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    const db = require('./db/sqlite-adapter');

    const result = await db.query('SELECT wan_mode, wan_interface FROM network_config WHERE id = 1');
    const wanMode = result.rows.length > 0 ? result.rows[0].wan_mode || 'dhcp' : 'dhcp';
    const wanInterface = result.rows.length > 0 ? result.rows[0].wan_interface || 'eth0' : 'eth0';

    if (wanMode === 'pppoe') {
      await execAsync('sudo poff pisowifi-wan 2>/dev/null || true');
      await execAsync('sudo pon pisowifi-wan');
      console.log('✅ WAN PPPoE reconnected on boot');
    } else {
      await execAsync(`sudo dhclient -r ${wanInterface} 2>/dev/null || true`);
      await execAsync(`sudo dhclient ${wanInterface}`);
      console.log('✅ WAN DHCP lease renewed on boot');
    }
  } catch (error) {
    console.log('⚠️ WAN auto-reconnect skipped:', error.message);
  }

  // Initialize TTL detection (anti-tethering)
  try {
    const ttlDetector = require('./services/ttl-detector');
    await ttlDetector.initialize();

    const ttlInterface = process.env.TTL_INTERFACE || 'wlan0';
    if (ttlDetector.enabled) {
      await ttlDetector.startTrafficMonitoring(ttlInterface);
      console.log(`✅ TTL monitoring started on ${ttlInterface}`);
    } else {
      console.log('ℹ️ TTL monitoring is disabled (enable in settings)');
    }
  } catch (error) {
    console.log('⚠️ TTL detector not available:', error.message);
  }

  // Start time countdown system for authenticated clients
  startTimeCountdownSystem();

  console.log('\n🔍 Captive Portal Detection URLs:');
  console.log('   Android: /generate_204');
  console.log('   iOS/macOS: /hotspot-detect.html');
  console.log('   Windows: /connecttest.txt');
  console.log('   Firefox: /canonical.html');
});

// Time countdown system - decrements time_remaining in database every second
function startTimeCountdownSystem() {
  console.log('⏰ Starting time countdown system...');

  setInterval(async () => {
    try {
      const db = require('./db/sqlite-adapter');

      // Get portal settings to check if auto-pause is enabled
      const settingsResult = await db.query('SELECT auto_pause_on_disconnect FROM portal_settings WHERE id = 1');
      const autoPauseEnabled = settingsResult.rows.length > 0 && settingsResult.rows[0].auto_pause_on_disconnect === 1;
      const autoResumeEnabled = settingsResult.rows.length > 0 && settingsResult.rows[0].auto_resume_on_pause === 1;
      const pauseResumeMinutes = settingsResult.rows.length > 0 ? (settingsResult.rows[0].pause_resume_minutes || 0) : 0;

      // If auto-pause is enabled, check for disconnected clients and pause them
      if (autoPauseEnabled) {
        // Find clients that haven't been seen for 30 seconds (likely disconnected)
        await db.query(`
          UPDATE clients 
          SET status = 'PAUSED',
              paused_until = CASE 
                WHEN $1 > 0 THEN datetime('now', '+' || $1 || ' minutes')
                ELSE NULL
              END
          WHERE status = 'CONNECTED' 
          AND time_remaining > 0
          AND (julianday('now') - julianday(last_seen)) * 86400 > 30
        `, [autoResumeEnabled ? pauseResumeMinutes : 0]);
      }

      // Auto-resume paused clients when timer expires
      if (autoResumeEnabled && pauseResumeMinutes > 0) {
        await db.query(`
          UPDATE clients
          SET status = 'CONNECTED',
              paused_until = NULL,
              last_seen = CURRENT_TIMESTAMP
          WHERE status = 'PAUSED'
          AND paused_until IS NOT NULL
          AND paused_until <= datetime('now')
        `);
      }

      // Decrement time_remaining for all connected clients only (not paused)
      await db.query(`
        UPDATE clients 
        SET time_remaining = MAX(0, time_remaining - 1),
            last_seen = CURRENT_TIMESTAMP
        WHERE status = 'CONNECTED' 
        AND time_remaining > 0
      `);

      // Get updated clients for logging
      const result = await db.query(`
        SELECT id, mac_address, time_remaining
        FROM clients
        WHERE status = 'CONNECTED' AND time_remaining >= 0
      `);

      // Check for expired clients
      const expiredResult = await db.query(`
        SELECT id, mac_address, ip_address 
        FROM clients 
        WHERE status = 'CONNECTED' 
        AND time_remaining <= 0
      `);

      // Disconnect expired clients
      if (expiredResult.rows.length > 0) {
        console.log(`⏰ Found ${expiredResult.rows.length} expired clients, disconnecting...`);

        for (const client of expiredResult.rows) {
          try {
            // Update client status to disconnected
            await db.query(`
              UPDATE clients 
              SET status = 'DISCONNECTED', time_remaining = 0, last_seen = CURRENT_TIMESTAMP 
              WHERE id = $1
            `, [client.id]);

            // End active sessions
            await db.query(`
              UPDATE sessions 
              SET status = 'ENDED', ended_at = CURRENT_TIMESTAMP 
              WHERE client_id = $1 AND status = 'ACTIVE'
            `, [client.id]);

            // Deauthenticate using NetworkManager
            try {
              const NetworkManager = require('./services/network-manager');
              const networkManager = new NetworkManager();
              await networkManager.deauthenticateClient(client.mac_address);
              console.log(`⏰ Deauthenticated expired client: ${client.mac_address}`);
            } catch (networkError) {
              console.warn(`Failed to deauthenticate ${client.mac_address}:`, networkError.message);
            }

            // Emit socket event to update frontend
            io.emit('client-disconnected', {
              mac_address: client.mac_address,
              reason: 'time_expired'
            });

          } catch (clientError) {
            console.error(`Failed to disconnect expired client ${client.mac_address}:`, clientError.message);
          }
        }
      }

      // Auto-cleanup disconnected unauthenticated devices (every 30 seconds)
      const now = new Date();
      if (now.getSeconds() % 30 === 0) {
        await cleanupDisconnectedDevices();
      }

      // Log active clients count every minute
      if (result.rows.length > 0) {
        if (now.getSeconds() === 0) { // Log only at the start of each minute
          console.log(`⏰ ${result.rows.length} active clients with time remaining`);
        }
      }

    } catch (error) {
      console.error('Time countdown system error:', error.message);
    }
  }, 1000); // Run every second
}

// Auto-cleanup function for disconnected unauthenticated devices
async function cleanupDisconnectedDevices() {
  try {
    const db = require('./db/sqlite-adapter');
    const NetworkManager = require('./services/network-manager');
    const networkManager = new NetworkManager();

    // Get all unauthenticated clients from database
    const unauthenticatedClients = await db.query(`
      SELECT id, mac_address, ip_address, device_name, last_seen
      FROM clients 
      WHERE status IN ('DISCONNECTED', 'UNAUTHENTICATED')
      AND time_remaining <= 0
    `);

    if (unauthenticatedClients.rows.length === 0) return;

    // Get currently connected devices from network
    const connectedDevices = await networkManager.getConnectedClients();
    const connectedMACs = new Set(connectedDevices.map(device => device.mac_address.toUpperCase()));

    const devicesToRemove = [];

    // Check each unauthenticated client
    for (const client of unauthenticatedClients.rows) {
      const isConnected = connectedMACs.has(client.mac_address.toUpperCase());

      if (!isConnected) {
        // Device is not connected - check how long it's been disconnected
        const lastSeenDate = new Date(client.last_seen);
        const minutesDisconnected = (Date.now() - lastSeenDate.getTime()) / (1000 * 60);

        // Remove devices that have been disconnected for more than 5 minutes
        if (minutesDisconnected > 5) {
          devicesToRemove.push(client);
        }
      } else {
        // Device is still connected but unauthenticated - update last_seen
        await db.query(`
          UPDATE clients 
          SET last_seen = CURRENT_TIMESTAMP 
          WHERE id = $1
        `, [client.id]);
      }
    }

    // Remove disconnected devices
    if (devicesToRemove.length > 0) {
      console.log(`🧹 Auto-cleanup: Removing ${devicesToRemove.length} disconnected unauthenticated devices`);

      for (const device of devicesToRemove) {
        try {
          // Delete related records first (foreign key constraints)
          await db.query('DELETE FROM sessions WHERE client_id = $1', [device.id]);
          await db.query('DELETE FROM transactions WHERE client_id = $1', [device.id]);

          // Delete the client
          await db.query('DELETE FROM clients WHERE id = $1', [device.id]);

          console.log(`🧹 Removed disconnected device: ${device.device_name || 'Unknown'} (${device.mac_address})`);

          // Emit socket event to update admin frontend
          io.emit('client-removed', {
            mac_address: device.mac_address,
            reason: 'auto_cleanup_disconnected'
          });

        } catch (deleteError) {
          console.error(`Failed to remove device ${device.mac_address}:`, deleteError.message);
        }
      }
    }

  } catch (error) {
    console.error('Auto-cleanup error:', error.message);
  }
}

// Error handler (log + secure response)
app.use((err, req, res, next) => {
  logSystemEvent('error', `${req.method} ${req.originalUrl} - ${err.message}`, 'http', {
    stack: err.stack
  });
  secureErrorHandler(err, req, res, next);
});

module.exports = { app, io };