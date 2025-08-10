const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { exec } = require('child_process');
const { promisify } = require('util');
const UAParser = require('ua-parser-js');

const execAsync = promisify(exec);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://pisowifi_user:admin123@localhost:5432/pisowifi'
});

// Portal page
router.get('/', async (req, res) => {
  try {
    // Get active rates
    const result = await pool.query('SELECT * FROM rates WHERE is_active = true ORDER BY duration');
    const rates = result.rows;
    
    res.render('portal', {
      title: 'PISOWifi Portal',
      rates: rates
    });
  } catch (error) {
    console.error('Portal error:', error);
    res.status(500).render('error', { error: 'Database connection failed' });
  }
});

// Connect endpoint
router.post('/connect', async (req, res) => {
  try {
    const { coinsInserted, duration, macAddress, deviceInfo } = req.body;
    const clientIP = req.ip || req.connection.remoteAddress;
    
    // Auto-detect MAC address if not provided
    let detectedMac = macAddress;
    if (!detectedMac || detectedMac === 'auto-detect') {
      try {
        const { stdout } = await execAsync(`arp -n | grep ${clientIP}`);
        const arpEntry = stdout.trim().split(/\s+/);
        if (arpEntry.length >= 3) {
          detectedMac = arpEntry[2];
        }
      } catch (err) {
        console.warn('Could not auto-detect MAC address:', err.message);
        detectedMac = 'unknown-' + Date.now();
      }
    }
    
    // Parse device information if provided
    let parsedDeviceInfo = {};
    if (deviceInfo && deviceInfo.userAgent) {
      const parser = new UAParser(deviceInfo.userAgent);
      const result = parser.getResult();
      
      parsedDeviceInfo = {
        device_name: result.device.model || result.device.vendor || 'Unknown Device',
        device_type: result.device.type || 'desktop',
        os: `${result.os.name || 'Unknown'} ${result.os.version || ''}`.trim(),
        browser: `${result.browser.name || 'Unknown'} ${result.browser.version || ''}`.trim(),
        user_agent: deviceInfo.userAgent,
        platform: deviceInfo.platform,
        language: deviceInfo.language,
        screen_resolution: `${deviceInfo.screenWidth}x${deviceInfo.screenHeight}`,
        timezone: deviceInfo.timezone
      };
    }
    
    // Create or update client record
    const clientResult = await pool.query(
      `INSERT INTO clients (
        mac_address, ip_address, device_name, device_type, os, browser, 
        user_agent, platform, language, screen_resolution, timezone,
        status, time_remaining, created_at, last_seen
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (mac_address) 
      DO UPDATE SET 
        ip_address = EXCLUDED.ip_address,
        device_name = COALESCE(EXCLUDED.device_name, clients.device_name),
        device_type = COALESCE(EXCLUDED.device_type, clients.device_type),
        os = COALESCE(EXCLUDED.os, clients.os),
        browser = COALESCE(EXCLUDED.browser, clients.browser),
        user_agent = COALESCE(EXCLUDED.user_agent, clients.user_agent),
        platform = COALESCE(EXCLUDED.platform, clients.platform),
        language = COALESCE(EXCLUDED.language, clients.language),
        screen_resolution = COALESCE(EXCLUDED.screen_resolution, clients.screen_resolution),
        timezone = COALESCE(EXCLUDED.timezone, clients.timezone),
        status = EXCLUDED.status,
        time_remaining = EXCLUDED.time_remaining,
        last_seen = CURRENT_TIMESTAMP
      RETURNING id`,
      [
        detectedMac.toUpperCase(), clientIP, 
        parsedDeviceInfo.device_name, parsedDeviceInfo.device_type,
        parsedDeviceInfo.os, parsedDeviceInfo.browser, parsedDeviceInfo.user_agent,
        parsedDeviceInfo.platform, parsedDeviceInfo.language,
        parsedDeviceInfo.screen_resolution, parsedDeviceInfo.timezone,
        'CONNECTED', duration || 3600
      ]
    );
    
    const clientId = clientResult.rows[0].id;
    
    // Create session record
    const sessionResult = await pool.query(
      `INSERT INTO sessions (client_id, mac_address, ip_address, duration, status, started_at)
       VALUES ($1, $2, $3, $4, 'ACTIVE', CURRENT_TIMESTAMP)
       RETURNING id`,
      [clientId, detectedMac.toUpperCase(), clientIP, duration || 3600]
    );
    
    // Create transaction record
    await pool.query(
      `INSERT INTO transactions (client_id, session_id, amount, coins_used, payment_method, status, created_at)
       VALUES ($1, $2, $3, $4, 'COIN', 'COMPLETED', CURRENT_TIMESTAMP)`,
      [clientId, sessionResult.rows[0].id, coinsInserted * 5, coinsInserted]
    );
    
    // Allow internet access (placeholder for iptables integration)
    try {
      await execAsync(`echo "Allowing client ${detectedMac} internet access for ${duration} seconds"`);
    } catch (err) {
      console.warn('Internet access setup failed:', err);
    }
    
    // Log the connection
    await pool.query(
      'INSERT INTO system_logs (level, message, category, metadata) VALUES ($1, $2, $3, $4)',
      ['INFO', `Client connected: ${detectedMac}`, 'portal', 
       JSON.stringify({ ip: clientIP, duration, coins: coinsInserted })]
    );
    
    res.json({
      success: true,
      message: 'Connection successful! You now have internet access.',
      session_id: sessionResult.rows[0].id,
      duration: duration,
      expires_at: new Date(Date.now() + (duration * 1000))
    });
    
  } catch (error) {
    console.error('Connect error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Connection failed. Please try again.' 
    });
  }
});

module.exports = router;