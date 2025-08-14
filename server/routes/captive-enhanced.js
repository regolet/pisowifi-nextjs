const express = require('express');
const router = express.Router();
const db = require('../db/sqlite-adapter');

// Enhanced captive portal detection endpoints with better device support
// These URLs are requested by devices to detect internet connectivity

// Helper function to check if client is authenticated
async function isClientAuthenticated(req) {
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

    // Try to get MAC address
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    let detectedMac = null;
    
    try {
      // Try ARP table (Windows)
      const { stdout: arpOutput } = await execAsync(`arp -a ${clientIP} 2>nul || echo ""`);
      if (arpOutput) {
        const arpMatch = arpOutput.match(/([0-9a-fA-F]{2}[:-]){5}([0-9a-fA-F]{2})/);
        if (arpMatch) {
          detectedMac = arpMatch[0].replace(/-/g, ':').toUpperCase();
        }
      }
    } catch (error) {
      console.warn('MAC detection failed:', error.message);
    }

    // Check authentication in database
    if (detectedMac) {
      const authCheck = await db.query(
        'SELECT * FROM clients WHERE mac_address = $1 AND status = $2 AND time_remaining > 0',
        [detectedMac, 'CONNECTED']
      );
      
      if (authCheck.rows.length > 0) {
        console.log(`[CAPTIVE] Client ${detectedMac} is authenticated with time_remaining=${authCheck.rows[0].time_remaining}`);
        return true;
      }
    }
    
    console.log(`[CAPTIVE] Client ${clientIP} (MAC: ${detectedMac || 'unknown'}) is NOT authenticated`);
    return false;
  } catch (error) {
    console.error('[CAPTIVE] Authentication check error:', error);
    return false;
  }
}

// Get portal URL - ensure HTTP only
const getPortalUrl = (req) => {
  const host = req.headers.host || 'pisowifi.local';
  // Always use HTTP for local network
  return `http://${host}/portal`;
};

// Apple devices (iOS, macOS) - Primary detection
router.get('/hotspot-detect.html', async (req, res) => {
  console.log(`[CAPTIVE] Apple hotspot-detect.html requested from ${req.ip}`);
  
  const isAuth = await isClientAuthenticated(req);
  
  if (isAuth) {
    // Client is authenticated, return success
    res.send('<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>');
  } else {
    // Not authenticated, redirect to portal
    const portalUrl = getPortalUrl(req);
    console.log(`[CAPTIVE] Redirecting Apple device to: ${portalUrl}`);
    res.status(302);
    res.set('Location', portalUrl);
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send('<HTML><HEAD><TITLE>Portal</TITLE></HEAD><BODY>Portal</BODY></HTML>');
  }
});

// Apple devices - iOS 7+ variant
router.get('/library/test/success.html', async (req, res) => {
  console.log(`[CAPTIVE] Apple library/test/success.html requested from ${req.ip}`);
  
  const isAuth = await isClientAuthenticated(req);
  
  if (isAuth) {
    res.send('<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>');
  } else {
    res.status(302);
    res.set('Location', getPortalUrl(req));
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send('<HTML><HEAD><TITLE>Portal</TITLE></HEAD><BODY>Portal</BODY></HTML>');
  }
});

// Android devices - Primary detection
router.get('/generate_204', async (req, res) => {
  console.log(`[CAPTIVE] Android generate_204 requested from ${req.ip}`);
  
  const isAuth = await isClientAuthenticated(req);
  
  if (isAuth) {
    // Client is authenticated, return 204 No Content
    res.status(204);
    res.set('Content-Length', '0');
    res.end();
  } else {
    // Not authenticated, redirect to portal
    const portalUrl = getPortalUrl(req);
    console.log(`[CAPTIVE] Redirecting Android device to: ${portalUrl}`);
    res.status(302);
    res.set('Location', portalUrl);
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Content-Length', '0');
    res.end();
  }
});

// Android devices - Older variant
router.get('/gen_204', async (req, res) => {
  console.log(`[CAPTIVE] Android gen_204 requested from ${req.ip}`);
  
  const isAuth = await isClientAuthenticated(req);
  
  if (isAuth) {
    res.status(204);
    res.set('Content-Length', '0');
    res.end();
  } else {
    res.status(302);
    res.set('Location', getPortalUrl(req));
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Content-Length', '0');
    res.end();
  }
});

// Google Chrome connectivity check
router.get('/chrome-variations/seed', async (req, res) => {
  console.log(`[CAPTIVE] Chrome variations requested from ${req.ip}`);
  
  const isAuth = await isClientAuthenticated(req);
  
  if (isAuth) {
    // Return empty response for authenticated clients
    res.status(200);
    res.set('Content-Type', 'application/octet-stream');
    res.end();
  } else {
    res.status(302);
    res.set('Location', getPortalUrl(req));
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.end();
  }
});

// Microsoft/Windows devices - Network Connectivity Status Indicator
router.get('/connecttest.txt', async (req, res) => {
  console.log(`[CAPTIVE] Windows connecttest.txt requested from ${req.ip}`);
  
  const isAuth = await isClientAuthenticated(req);
  
  if (isAuth) {
    res.send('Microsoft Connect Test');
  } else {
    res.status(302);
    res.set('Location', getPortalUrl(req));
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send('Redirect');
  }
});

// Windows NCSI check
router.get('/ncsi.txt', async (req, res) => {
  console.log(`[CAPTIVE] Windows ncsi.txt requested from ${req.ip}`);
  
  const isAuth = await isClientAuthenticated(req);
  
  if (isAuth) {
    res.send('Microsoft NCSI');
  } else {
    res.status(302);
    res.set('Location', getPortalUrl(req));
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send('Redirect');
  }
});

// Generic connectivity checks
router.get('/connectivity-check.html', async (req, res) => {
  console.log(`[CAPTIVE] Generic connectivity-check.html requested from ${req.ip}`);
  
  const isAuth = await isClientAuthenticated(req);
  
  if (isAuth) {
    res.send('<html><head><title>Connected</title></head><body>Connected to the Internet</body></html>');
  } else {
    res.status(302);
    res.set('Location', getPortalUrl(req));
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send('<html><head><title>Redirect</title></head><body>Redirect</body></html>');
  }
});

// Firefox detection
router.get('/canonical.html', async (req, res) => {
  console.log(`[CAPTIVE] Firefox canonical.html requested from ${req.ip}`);
  
  const isAuth = await isClientAuthenticated(req);
  
  if (isAuth) {
    res.send('<html><head><title>Connected</title></head><body>Connected</body></html>');
  } else {
    res.status(302);
    res.set('Location', getPortalUrl(req));
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send('<html><head><title>Redirect</title></head><body>Redirect</body></html>');
  }
});

// Success check endpoint
router.get('/success.txt', async (req, res) => {
  console.log(`[CAPTIVE] Success.txt requested from ${req.ip}`);
  
  const isAuth = await isClientAuthenticated(req);
  
  if (isAuth) {
    res.send('success');
  } else {
    res.status(302);
    res.set('Location', getPortalUrl(req));
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send('redirect');
  }
});

// Generic redirect endpoint
router.get('/redirect', async (req, res) => {
  console.log(`[CAPTIVE] Redirect requested from ${req.ip}`);
  res.status(302);
  res.set('Location', getPortalUrl(req));
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.end();
});

// Catch-all for root domain access when not authenticated
router.get('/', async (req, res, next) => {
  // Check if this is a captive portal detection request
  const userAgent = req.headers['user-agent'] || '';
  const isCaptivePortalCheck = 
    userAgent.includes('CaptiveNetworkSupport') || // iOS
    userAgent.includes('Android') ||
    userAgent.includes('Microsoft NCSI') ||
    req.headers['x-requested-with'] === 'XMLHttpRequest';
  
  if (isCaptivePortalCheck) {
    console.log(`[CAPTIVE] Root domain captive check from ${req.ip}`);
    
    const isAuth = await isClientAuthenticated(req);
    
    if (!isAuth) {
      res.status(302);
      res.set('Location', getPortalUrl(req));
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      return res.end();
    }
  }
  
  // Not a captive portal check, continue to next middleware
  next();
});

module.exports = router;