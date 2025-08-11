const express = require('express');
const router = express.Router();
const { exec } = require('child_process');
const { promisify } = require('util');
const UAParser = require('ua-parser-js');
const NetworkManager = require('../services/network-manager');
const db = require('../db/simple-adapter');

const execAsync = promisify(exec);
const networkManager = new NetworkManager();

// Portal page
router.get('/', async (req, res) => {
  try {
    // Get client IP and clean it
    let clientIP = req.headers['x-forwarded-for'] || 
                   req.headers['x-real-ip'] ||
                   req.connection.remoteAddress || 
                   req.socket.remoteAddress ||
                   (req.connection.socket ? req.connection.socket.remoteAddress : null);

    // Clean IPv6-mapped IPv4 addresses (remove ::ffff: prefix)
    if (clientIP && clientIP.startsWith('::ffff:')) {
      clientIP = clientIP.substring(7);
    }
    
    // Remove port if present
    if (clientIP && clientIP.includes(':') && !clientIP.includes('::')) {
      clientIP = clientIP.split(':')[0];
    }

    console.log(`Portal access from cleaned IP: ${clientIP}`);
    
    // Try to detect MAC address from multiple sources
    let detectedMac = null;
    let clientInfo = null;
    
    try {
      // First try ARP table for Ethernet interface
      const { stdout: arpOutput } = await execAsync(`arp -n ${clientIP} 2>/dev/null || echo ""`);
      if (arpOutput) {
        const arpMatch = arpOutput.match(/([0-9a-fA-F]{2}[:-]){5}([0-9a-fA-F]{2})/);
        if (arpMatch) {
          detectedMac = arpMatch[0].toUpperCase();
          console.log(`Detected MAC from ARP: ${detectedMac} for IP: ${clientIP}`);
        }
      }
      
      // Try DHCP leases if no ARP entry
      if (!detectedMac) {
        const { stdout: dhcpLeases } = await execAsync(`cat /var/lib/dhcp/dhcpd.leases /var/lib/misc/dnsmasq.leases 2>/dev/null || echo ""`);
        const leaseLines = dhcpLeases.split('\n');
        for (const line of leaseLines) {
          if (line.includes(clientIP)) {
            const parts = line.split(' ');
            if (parts.length >= 2) {
              detectedMac = parts[1].toUpperCase();
              console.log(`Found MAC in DHCP leases: ${detectedMac}`);
              break;
            }
          }
        }
      }
      
      // Try getting MAC from ethernet interface neighbor table
      if (!detectedMac) {
        const { stdout: neighborOutput } = await execAsync(`ip neighbor show dev enx00e04c68276e 2>/dev/null || echo ""`);
        const neighborLines = neighborOutput.split('\n');
        for (const line of neighborLines) {
          if (line.includes(clientIP)) {
            const macMatch = line.match(/([0-9a-fA-F]{2}[:-]){5}([0-9a-fA-F]{2})/);
            if (macMatch) {
              detectedMac = macMatch[0].toUpperCase();
              console.log(`Found MAC from neighbor table: ${detectedMac}`);
              break;
            }
          }
        }
      }
    } catch (error) {
      console.warn('MAC detection failed:', error.message);
    }

    // Check if client is already authenticated
    let isAuthenticated = false;
    if (detectedMac) {
      console.log(`[DEBUG PORTAL] Checking auth for MAC: ${detectedMac}`);
      try {
        const authCheck = await db.query(
          'SELECT * FROM clients WHERE mac_address = $1 AND status = $2 AND time_remaining > 0',
          [detectedMac, 'CONNECTED']
        );
        
        console.log(`[DEBUG PORTAL] Auth check result: ${authCheck.rows.length} rows found`);
        if (authCheck.rows.length > 0) {
          isAuthenticated = true;
          clientInfo = authCheck.rows[0];
          console.log(`[DEBUG PORTAL] Client ${detectedMac} is authenticated with time_remaining=${clientInfo.time_remaining}`);
        } else {
          console.log(`[DEBUG PORTAL] Client ${detectedMac} is NOT authenticated`);
        }
      } catch (dbError) {
        console.warn('Database auth check failed:', dbError.message);
      }
    }

    // Get active rates
    const result = await db.query('SELECT * FROM rates WHERE is_active = true ORDER BY duration');
    const rates = result.rows;
    
    // Get WAN connectivity status
    let wanStatus = 'unknown';
    try {
      await execAsync('ping -c 1 -W 2 8.8.8.8');
      wanStatus = 'connected';
    } catch (pingError) {
      wanStatus = 'disconnected';
    }
    
    // Get portal settings
    let portalSettings = {
      coin_timeout: 60,
      portal_title: 'PISOWifi Portal',
      portal_subtitle: 'Insert coins for internet access'
    };
    
    try {
      const settingsResult = await db.query('SELECT coin_timeout, portal_title, portal_subtitle FROM portal_settings LIMIT 1');
      if (settingsResult.rows.length > 0) {
        portalSettings = settingsResult.rows[0];
      }
    } catch (settingsError) {
      console.warn('Failed to load portal settings, using defaults:', settingsError.message);
    }
    
    res.render('portal', {
      title: portalSettings.portal_title,
      rates: rates,
      clientIP: clientIP,
      clientMAC: detectedMac || 'Unknown',
      isAuthenticated: isAuthenticated,
      clientInfo: clientInfo,
      wanStatus: wanStatus,
      portalSettings: portalSettings
    });
  } catch (error) {
    console.error('Portal error:', error);
    res.status(500).render('error', { error: 'Portal service unavailable' });
  }
});

// Connect endpoint
router.post('/connect', async (req, res) => {
  try {
    console.log('=== CONNECT REQUEST START ===');
    console.log('Connect request received:', req.body);
    
    const { coinsInserted, duration, rateId, macAddress, deviceInfo } = req.body;
    console.log('Extracted request data:', { coinsInserted, duration, rateId, macAddress, deviceInfo });
    let clientIP = req.headers['x-forwarded-for'] || 
                   req.connection.remoteAddress || 
                   req.socket.remoteAddress ||
                   (req.connection.socket ? req.connection.socket.remoteAddress : null);
    
    // Clean IPv6-mapped IPv4 addresses
    if (clientIP && clientIP.startsWith('::ffff:')) {
      clientIP = clientIP.substring(7);
    }
    
    // Remove port if present
    if (clientIP && clientIP.includes(':') && !clientIP.includes('::')) {
      clientIP = clientIP.split(':')[0];
    }
    
    console.log(`Connection request from IP: ${clientIP}, Coins: ${coinsInserted}, Duration: ${duration}`);
    
    console.log('Step 1: Validating required fields...');
    // Validate required fields
    if (!coinsInserted || coinsInserted <= 0) {
      return res.status(400).json({ 
        success: false,
        error: 'No coins inserted. Please insert coins first.' 
      });
    }
    
    console.log('Step 2: Detecting MAC address...');
    // Auto-detect MAC address if not provided
    let detectedMac = macAddress;
    if (!detectedMac || detectedMac === 'auto-detect') {
      try {
        console.log('Attempting MAC detection for IP:', clientIP);
        
        // Try ARP table first
        try {
          const { stdout: arpOutput } = await execAsync(`arp -n ${clientIP}`);
          const arpMatch = arpOutput.match(/([0-9a-fA-F]{2}[:-]){5}([0-9a-fA-F]{2})/);
          if (arpMatch) {
            detectedMac = arpMatch[0].replace(/[-:]/g, ':').toUpperCase();
            console.log('MAC found via ARP:', detectedMac);
          }
        } catch (arpError) {
          console.log('ARP lookup failed:', arpError.message);
        }
        
        // Try neighbor table if ARP failed
        if (!detectedMac) {
          try {
            const { stdout: neighborOutput } = await execAsync(`ip neighbor show`);
            const neighborLines = neighborOutput.split('\n');
            for (const line of neighborLines) {
              if (line.includes(clientIP)) {
                const macMatch = line.match(/([0-9a-fA-F]{2}[:-]){5}([0-9a-fA-F]{2})/);
                if (macMatch) {
                  detectedMac = macMatch[0].replace(/[-:]/g, ':').toUpperCase();
                  console.log('MAC found via neighbor table:', detectedMac);
                  break;
                }
              }
            }
          } catch (neighborError) {
            console.log('Neighbor lookup failed:', neighborError.message);
          }
        }
        
        // If still no MAC, generate a temporary one based on IP
        if (!detectedMac) {
          console.log('MAC detection failed, generating temporary MAC');
          const ipParts = clientIP.split('.');
          if (ipParts.length === 4) {
            detectedMac = `02:00:${ipParts[2].padStart(2, '0')}:${ipParts[3].padStart(2, '0')}:00:01`;
            console.log('Generated temporary MAC:', detectedMac);
          } else {
            throw new Error('Could not detect or generate MAC address');
          }
        }
      } catch (err) {
        console.error('MAC detection completely failed:', err.message);
        return res.status(400).json({ 
          success: false,
          error: 'Unable to detect device. Please try again.' 
        });
      }
    }
    
    // Get rate information if rateId is provided
    let selectedRate = null;
    if (rateId) {
      try {
        const rateResult = await db.query('SELECT * FROM rates WHERE id = $1 AND is_active = true', [rateId]);
        if (rateResult.rows.length > 0) {
          selectedRate = rateResult.rows[0];
        }
      } catch (rateError) {
        console.warn('Rate lookup failed:', rateError.message);
      }
    }
    
    // Calculate duration and cost based on rates
    let sessionDuration = duration || 3600; // Default 1 hour
    let sessionCost = 0;
    
    if (selectedRate) {
      sessionDuration = selectedRate.duration;
      sessionCost = selectedRate.price;
    } else if (coinsInserted) {
      // Get the first active rate as default for coin-based calculation
      try {
        const defaultRateResult = await db.query('SELECT * FROM rates WHERE is_active = true ORDER BY duration LIMIT 1');
        if (defaultRateResult.rows.length > 0) {
          const defaultRate = defaultRateResult.rows[0];
          // Calculate based on coins and rate
          const coinsNeeded = defaultRate.coins_required;
          const pricePerCoin = defaultRate.price / coinsNeeded;
          const timePerCoin = defaultRate.duration / coinsNeeded;
          
          sessionCost = coinsInserted * pricePerCoin;
          sessionDuration = coinsInserted * timePerCoin;
        } else {
          // Fallback if no rates exist
          sessionCost = coinsInserted * 5; // ₱5 per coin
          sessionDuration = coinsInserted * 30 * 60; // 30 minutes per coin
        }
      } catch (rateError) {
        console.warn('Failed to get rates for calculation, using fallback:', rateError.message);
        sessionCost = coinsInserted * 5; // ₱5 per coin
        sessionDuration = coinsInserted * 30 * 60; // 30 minutes per coin
      }
    }
    
    console.log('Step 3: Parsing device information...');
    // Parse device information if provided
    let parsedDeviceInfo = {};
    if (deviceInfo && deviceInfo.userAgent) {
      console.log('Device info provided:', deviceInfo);
      const parser = new UAParser(deviceInfo.userAgent);
      const result = parser.getResult();
      console.log('UAParser result:', result);
      
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
    
    console.log('Step 4: Creating client record...');
    console.log('Client data to insert:', {
      macAddress: detectedMac,
      clientIP,
      sessionDuration,
      parsedDeviceInfo
    });
    
    // Create or update client record - simplified version first
    let clientResult;
    try {
      // Try full insert first
      clientResult = await db.query(
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
          parsedDeviceInfo.device_name || 'Unknown Device', 
          parsedDeviceInfo.device_type || 'desktop',
          parsedDeviceInfo.os || 'Unknown OS', 
          parsedDeviceInfo.browser || 'Unknown Browser',
          parsedDeviceInfo.user_agent || deviceInfo?.userAgent || 'Unknown',
          parsedDeviceInfo.platform || deviceInfo?.platform || 'Unknown',
          parsedDeviceInfo.language || deviceInfo?.language || 'en-US',
          parsedDeviceInfo.screen_resolution || `${deviceInfo?.screenWidth || 1920}x${deviceInfo?.screenHeight || 1080}`,
          parsedDeviceInfo.timezone || deviceInfo?.timezone || 'UTC',
          'CONNECTED', sessionDuration
        ]
      );
    } catch (clientError) {
      console.warn('Full client insert failed, trying simplified version:', clientError.message);
      // Fallback to basic client record
      clientResult = await db.query(
        `INSERT INTO clients (mac_address, ip_address, status, time_remaining, created_at, last_seen)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (mac_address) 
         DO UPDATE SET 
           ip_address = EXCLUDED.ip_address,
           status = EXCLUDED.status,
           time_remaining = EXCLUDED.time_remaining,
           last_seen = CURRENT_TIMESTAMP
         RETURNING id`,
        [detectedMac.toUpperCase(), clientIP, 'CONNECTED', sessionDuration]
      );
    }
    
    const clientId = clientResult.rows[0].id;
    console.log('Client record created with ID:', clientId);
    
    console.log('Step 5: Creating session record...');
    // Create session record
    const sessionResult = await db.query(
      `INSERT INTO sessions (client_id, mac_address, ip_address, duration, status, started_at)
       VALUES ($1, $2, $3, $4, 'ACTIVE', CURRENT_TIMESTAMP)
       RETURNING id`,
      [clientId, detectedMac.toUpperCase(), clientIP, sessionDuration]
    );
    console.log('Session record created with ID:', sessionResult.rows[0].id);
    
    console.log('Step 6: Creating transaction record...');
    // Create transaction record
    await db.query(
      `INSERT INTO transactions (client_id, session_id, amount, coins_used, payment_method, status, created_at)
       VALUES ($1, $2, $3, $4, 'COIN', 'COMPLETED', CURRENT_TIMESTAMP)`,
      [clientId, sessionResult.rows[0].id, sessionCost, coinsInserted || 0]
    );
    console.log('Transaction record created successfully');
    
    console.log('Step 7: Authenticating client...');
    // Try network authentication but don't fail if it doesn't work
    try {
      console.log('Attempting NetworkManager authentication...');
      const authResult = await networkManager.authenticateClient(detectedMac, clientIP, sessionDuration);
      if (!authResult.success) {
        console.warn('NetworkManager auth failed:', authResult.error);
      } else {
        console.log(`NetworkManager authenticated client ${detectedMac} for ${sessionDuration} seconds`);
      }
    } catch (networkError) {
      console.warn('NetworkManager authentication error (non-critical):', networkError.message);
    }
    
    // Try allow script as backup
    try {
      console.log('Running backup allow script...');
      await execAsync(`sudo ${__dirname}/../../scripts/pisowifi-allow-client ${detectedMac}`);
      console.log('Allow script executed successfully');
    } catch (scriptError) {
      console.warn('Allow script failed (non-critical):', scriptError.message);
    }
    
    console.log('Authentication step completed (with fallbacks)');
    
    console.log('Step 8: Logging connection...');
    // Log the connection
    await db.query(
      'INSERT INTO system_logs (level, message, category, metadata) VALUES ($1, $2, $3, $4)',
      ['INFO', `Client connected: ${detectedMac}`, 'portal', 
       JSON.stringify({ ip: clientIP, duration, coins: coinsInserted })]
    );
    console.log('Connection logged successfully');
    
    console.log('Step 9: Sending success response...');
    res.json({
      success: true,
      message: 'Connection successful! You now have internet access.',
      session_id: sessionResult.rows[0].id,
      client_id: clientId,
      mac_address: detectedMac,
      ip_address: clientIP,
      duration: sessionDuration,
      amount_paid: sessionCost,
      coins_used: coinsInserted || 0,
      expires_at: new Date(Date.now() + (sessionDuration * 1000))
    });
    console.log('=== CONNECT REQUEST SUCCESS ===');
    
  } catch (error) {
    console.error('Connect error details:', {
      message: error.message,
      stack: error.stack,
      requestBody: req.body
    });
    res.status(500).json({ 
      success: false,
      error: 'Connection failed: ' + error.message 
    });
  }
});

// Test coin detection endpoint
router.post('/test-coin', async (req, res) => {
  try {
    console.log('Test coin detection triggered');
    
    // Emit coin detection event via socket.io
    const { io } = require('../app');
    io.emit('coin-detected', { 
      timestamp: new Date().toISOString(),
      value: 5.00,
      source: 'test' 
    });
    
    res.json({ 
      success: true, 
      message: 'Test coin detection sent' 
    });
  } catch (error) {
    console.error('Test coin error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Test failed' 
    });
  }
});

// Debug endpoint to check portal authentication state
router.get('/debug-auth', async (req, res) => {
  try {
    let clientIP = req.headers['x-forwarded-for'] || 
                   req.headers['x-real-ip'] ||
                   req.connection.remoteAddress || 
                   req.socket.remoteAddress ||
                   (req.connection.socket ? req.connection.socket.remoteAddress : null);

    // Clean IPv6-mapped IPv4 addresses
    if (clientIP && clientIP.startsWith('::ffff:')) {
      clientIP = clientIP.substring(7);
    }
    
    // Remove port if present
    if (clientIP && clientIP.includes(':') && !clientIP.includes('::')) {
      clientIP = clientIP.split(':')[0];
    }

    console.log(`[DEBUG AUTH] Portal debug auth check from IP: ${clientIP}`);
    
    // Try to detect MAC address
    let detectedMac = null;
    try {
      const { stdout: arpOutput } = await execAsync(`arp -n ${clientIP} 2>/dev/null || echo ""`);
      if (arpOutput) {
        const arpMatch = arpOutput.match(/([0-9a-fA-F]{2}[:-]){5}([0-9a-fA-F]{2})/);
        if (arpMatch) {
          detectedMac = arpMatch[0].toUpperCase();
        }
      }
    } catch (error) {
      console.warn('[DEBUG AUTH] MAC detection failed:', error.message);
    }

    console.log(`[DEBUG AUTH] Detected MAC: ${detectedMac}`);

    let authState = {
      client_ip: clientIP,
      detected_mac: detectedMac,
      authenticated: false,
      client_info: null,
      database_query_result: null
    };

    if (detectedMac) {
      try {
        const authCheck = await db.query(
          'SELECT * FROM clients WHERE mac_address = $1 AND status = $2 AND time_remaining > 0',
          [detectedMac, 'CONNECTED']
        );
        
        authState.database_query_result = {
          rows_found: authCheck.rows.length,
          query_used: `SELECT * FROM clients WHERE mac_address = '${detectedMac}' AND status = 'CONNECTED' AND time_remaining > 0`,
          rows: authCheck.rows
        };
        
        if (authCheck.rows.length > 0) {
          authState.authenticated = true;
          authState.client_info = authCheck.rows[0];
        }
        
        console.log(`[DEBUG AUTH] Database check for ${detectedMac}: ${authCheck.rows.length} rows found`);
        authCheck.rows.forEach(client => {
          console.log(`[DEBUG AUTH] Found client: Status=${client.status}, TimeRemaining=${client.time_remaining}, LastSeen=${client.last_seen}`);
        });
        
      } catch (dbError) {
        console.warn('[DEBUG AUTH] Database check failed:', dbError.message);
        authState.database_error = dbError.message;
      }
    }
    
    res.json(authState);
  } catch (error) {
    console.error('[DEBUG AUTH] Portal debug auth error:', error);
    res.json({ error: error.message });
  }
});

// Session status endpoint for authenticated clients
router.get('/session-status', async (req, res) => {
  try {
    const clientIP = req.headers['x-forwarded-for'] || 
                     req.connection.remoteAddress || 
                     req.socket.remoteAddress ||
                     (req.connection.socket ? req.connection.socket.remoteAddress : null);
    
    // Try to get MAC address
    let detectedMac = null;
    try {
      const { stdout: arpOutput } = await execAsync(`arp -n ${clientIP} 2>/dev/null || echo ""`);
      if (arpOutput) {
        const arpMatch = arpOutput.match(/([0-9a-fA-F]{2}[:-]){5}([0-9a-fA-F]{2})/);
        if (arpMatch) {
          detectedMac = arpMatch[0].toUpperCase();
        }
      }
    } catch (error) {
      console.warn('MAC detection failed for session status:', error.message);
    }
    
    if (!detectedMac) {
      return res.json({ authenticated: false, time_remaining: 0 });
    }
    
    // Check client status in database
    const clientResult = await db.query(
      'SELECT * FROM clients WHERE mac_address = $1 AND status = $2 AND time_remaining > 0',
      [detectedMac, 'CONNECTED']
    );
    
    if (clientResult.rows.length > 0) {
      const client = clientResult.rows[0];
      res.json({
        authenticated: true,
        time_remaining: client.time_remaining,
        device_name: client.device_name,
        last_seen: client.last_seen
      });
    } else {
      res.json({ authenticated: false, time_remaining: 0 });
    }
  } catch (error) {
    console.error('Session status error:', error);
    res.json({ authenticated: false, time_remaining: 0 });
  }
});

module.exports = router;