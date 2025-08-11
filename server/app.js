const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Middleware - Minimal helmet for local PISOWifi network
app.use(helmet({
  contentSecurityPolicy: false,  // Disable CSP completely for local network
  hsts: false,  // Disable HTTP Strict Transport Security
  crossOriginOpenerPolicy: false,  // Disable COOP header
  crossOriginResourcePolicy: false,  // Disable CORP header
  crossOriginEmbedderPolicy: false,  // Disable COEP header
  originAgentCluster: false,  // Disable Origin-Agent-Cluster header
  referrerPolicy: false,  // Disable referrer policy
  noSniff: false  // Allow content type sniffing for local development
}));
app.use(compression());
app.use(morgan('combined'));
app.use(cors());
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

// Captive portal detection routes (MUST be first, before auth middleware)
app.use('/', require('./routes/captive'));

// Debug route for troubleshooting (must be before auth middleware)
app.get('/debug-status', async (req, res) => {
  try {
    const db = require('./db/simple-adapter');
    
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

// Authentication middleware for captive portal
app.use(async (req, res, next) => {
  // Skip authentication for portal, API, admin routes, debug, and static files
  if (req.path.startsWith('/portal') || 
      req.path.startsWith('/api') || 
      req.path.startsWith('/admin') || 
      req.path.startsWith('/debug-status') ||
      req.path.startsWith('/socket.io') ||
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
      const db = require('./db/simple-adapter');
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
app.use('/admin', require('./routes/admin'));
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
server.listen(PORT, async () => {
  console.log(`🚀 PISOWifi Express server running on port ${PORT}`);
  
  // Initialize network stack for captive portal
  try {
    const NetworkManager = require('./services/network-manager');
    const networkManager = new NetworkManager();
    const result = await networkManager.initializeNetworkStack();
    if (result.success) {
      console.log('✅ Network stack initialized: Captive portal ready');
    } else {
      console.log('⚠️ Network initialization warning:', result.error);
    }
  } catch (error) {
    console.log('⚠️ Network manager not available:', error.message);
  }
  
  // Start time countdown system for authenticated clients
  startTimeCountdownSystem();
});

// Time countdown system - decrements time_remaining in database every second
function startTimeCountdownSystem() {
  console.log('⏰ Starting time countdown system...');
  
  setInterval(async () => {
    try {
      const db = require('./db/simple-adapter');
      
      // Decrement time_remaining for all connected clients
      const result = await db.query(`
        UPDATE clients 
        SET time_remaining = GREATEST(0, time_remaining - 1),
            last_seen = CURRENT_TIMESTAMP
        WHERE status = 'CONNECTED' 
        AND time_remaining > 0
        RETURNING id, mac_address, time_remaining
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
      
      // Log active clients count every minute
      if (result.rows.length > 0) {
        const now = new Date();
        if (now.getSeconds() === 0) { // Log only at the start of each minute
          console.log(`⏰ ${result.rows.length} active clients with time remaining`);
        }
      }
      
    } catch (error) {
      console.error('Time countdown system error:', error.message);
    }
  }, 1000); // Run every second
}

module.exports = { app, io };