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

// Authentication middleware for captive portal
app.use(async (req, res, next) => {
  // Skip authentication for portal, API, admin routes, and static files
  if (req.path.startsWith('/portal') || 
      req.path.startsWith('/api') || 
      req.path.startsWith('/admin') || 
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

// Captive portal detection routes (must be first)
app.use('/', require('./routes/captive'));

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
});

module.exports = { app, io };