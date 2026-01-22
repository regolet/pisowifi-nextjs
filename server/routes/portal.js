const express = require('express');
const router = express.Router();
const { exec } = require('child_process');
const { promisify } = require('util');
const crypto = require('crypto');
const UAParser = require('ua-parser-js');
const NetworkManager = require('../services/network-manager');
const db = require('../db/sqlite-adapter');
const { isValidIPv4, sanitizeMacAddress } = require('../utils/validators');

const execAsync = promisify(exec);
const networkManager = new NetworkManager();

// Generate a unique session token
function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Helper: get preferred network interface for neighbor table lookup
async function getNeighborInterface() {
  try {
    const result = await db.query('SELECT interface FROM network_settings WHERE id = 1');
    if (result.rows.length > 0 && result.rows[0].interface) {
      return result.rows[0].interface;
    }
  } catch (_) {
    // ignore
  }

  try {
    const result = await db.query('SELECT wifi_interface FROM network_config WHERE id = 1');
    if (result.rows.length > 0 && result.rows[0].wifi_interface) {
      return result.rows[0].wifi_interface;
    }
  } catch (_) {
    // ignore
  }

  return process.env.PISOWIFI_INTERFACE || 'wlan0';
}

// Helper function to find client by session token, IP, or MAC (with fallback)
async function findClientByIdentifiers(sessionToken, clientIP, detectedMac) {
  let client = null;

  // Priority 1: Try to find by MAC address (most reliable if available)
  if (detectedMac && detectedMac !== 'Unknown') {
    const macResult = await db.query(
      'SELECT * FROM clients WHERE mac_address = $1 AND status = $2 AND time_remaining > 0',
      [detectedMac, 'CONNECTED']
    );
    if (macResult.rows.length > 0) {
      client = macResult.rows[0];
      console.log(`[SESSION] Found client by MAC: ${detectedMac}`);
    }
  }

  // Priority 2: Try to find by session token (handles random MAC)
  if (!client && sessionToken) {
    const tokenResult = await db.query(
      'SELECT * FROM clients WHERE session_token = $1 AND status = $2 AND time_remaining > 0',
      [sessionToken, 'CONNECTED']
    );
    if (tokenResult.rows.length > 0) {
      client = tokenResult.rows[0];
      console.log(`[SESSION] Found client by session token (random MAC fallback)`);
      // Update MAC address if we have a new one
      if (detectedMac && detectedMac !== 'Unknown' && detectedMac !== client.mac_address) {
        console.log(`[SESSION] Updating MAC from ${client.mac_address} to ${detectedMac}`);
        await db.query(
          'UPDATE clients SET mac_address = $1, last_seen = CURRENT_TIMESTAMP WHERE id = $2',
          [detectedMac, client.id]
        );
        client.mac_address = detectedMac;
      }
    }
  }

  // Priority 3: Try to find by IP address (least reliable but useful backup)
  if (!client && clientIP) {
    const ipResult = await db.query(
      'SELECT * FROM clients WHERE ip_address = $1 AND status = $2 AND time_remaining > 0 ORDER BY last_seen DESC LIMIT 1',
      [clientIP, 'CONNECTED']
    );
    if (ipResult.rows.length > 0) {
      client = ipResult.rows[0];
      console.log(`[SESSION] Found client by IP fallback: ${clientIP}`);
      // Update MAC if available
      if (detectedMac && detectedMac !== 'Unknown' && detectedMac !== client.mac_address) {
        console.log(`[SESSION] Updating MAC from ${client.mac_address} to ${detectedMac}`);
        await db.query(
          'UPDATE clients SET mac_address = $1, last_seen = CURRENT_TIMESTAMP WHERE id = $2',
          [detectedMac, client.id]
        );
        client.mac_address = detectedMac;
      }
    }
  }

  return client;
}

// Helper function to find coin queues by multiple identifiers
async function findCoinQueuesByIdentifiers(sessionToken, clientIP, clientMac) {
  const result = await db.query(`
    SELECT 
      COALESCE(SUM(cq.coin_count), 0) as total_coins,
      COALESCE(SUM(cq.total_value), 0.00) as total_value
    FROM coin_queues cq
    WHERE cq.status = 'queued'
    AND (cq.session_token = $1 OR cq.client_ip = $2 OR cq.client_mac = $3)
  `, [sessionToken, clientIP, clientMac]);
  
  return result.rows[0];
}

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

    // SECURITY: Validate IP format to prevent command injection
    if (clientIP && !isValidIPv4(clientIP)) {
      console.warn(`Invalid IP format detected: ${clientIP?.substring(0, 20)}`);
      clientIP = null; // Treat as invalid
    }

    console.log(`Portal access from cleaned IP: ${clientIP}`);

    // Try to detect MAC address from multiple sources
    let detectedMac = null;
    let clientInfo = null;

    try {
      // SECURITY: Only run ARP if IP is valid
      if (clientIP && isValidIPv4(clientIP)) {
        // First try ARP table for Ethernet interface
        const { stdout: arpOutput } = await execAsync(`arp -n ${clientIP} 2>/dev/null || echo ""`);
        if (arpOutput) {
          const arpMatch = arpOutput.match(/([0-9a-fA-F]{2}[:-]){5}([0-9a-fA-F]{2})/);
          if (arpMatch) {
            detectedMac = arpMatch[0].toUpperCase();
            console.log(`Detected MAC from ARP: ${detectedMac} for IP: ${clientIP}`);
          }
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
        const neighborInterface = await getNeighborInterface();
        const { stdout: neighborOutput } = await execAsync(`ip neighbor show dev ${neighborInterface} 2>/dev/null || echo ""`);
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

    // Check if client is already authenticated using multi-identifier lookup
    let isAuthenticated = false;
    
    // Get or create session token from cookie
    let sessionToken = req.cookies?.pisowifi_session || null;
    
    console.log(`[DEBUG PORTAL] Checking auth for MAC: ${detectedMac || 'Unknown'}, Token: ${sessionToken ? 'present' : 'none'}, IP: ${clientIP}`);
    
    try {
      // Use the new multi-identifier lookup
      clientInfo = await findClientByIdentifiers(sessionToken, clientIP, detectedMac);
      
      if (clientInfo) {
        isAuthenticated = true;
        console.log(`[DEBUG PORTAL] Client authenticated: MAC=${clientInfo.mac_address}, TimeRemaining=${clientInfo.time_remaining}`);
        
        // Update the session token in cookie if client has one
        if (clientInfo.session_token && !sessionToken) {
          res.cookie('pisowifi_session', clientInfo.session_token, {
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
            httpOnly: true,
            sameSite: 'lax'
          });
          sessionToken = clientInfo.session_token;
        }
      } else {
        console.log(`[DEBUG PORTAL] Client NOT authenticated`);
      }
    } catch (dbError) {
      console.warn('Database auth check failed:', dbError.message);
    }
    
    // Generate a new session token for the portal page if none exists
    if (!sessionToken) {
      sessionToken = generateSessionToken();
      res.cookie('pisowifi_session', sessionToken, {
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        httpOnly: true,
        sameSite: 'lax'
      });
      console.log(`[SESSION] Generated new session token for client`);
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
      portal_subtitle: 'Insert coins for internet access',
      banner_image_url: '',
      coin_insert_audio_url: '',
      coin_success_audio_url: '',
      coin_background_audio_url: ''
    };

    try {
      const settingsResult = await db.query('SELECT coin_timeout, portal_title, portal_subtitle, banner_image_url, coin_insert_audio_url, coin_success_audio_url, coin_background_audio_url FROM portal_settings LIMIT 1');
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
      sessionToken: sessionToken,
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

    const { coinsInserted, duration, rateId, macAddress, deviceInfo, sessionToken: bodyToken } = req.body;
    console.log('Extracted request data:', { coinsInserted, duration, rateId, macAddress, deviceInfo });
    
    // Get session token from cookie or body
    let sessionToken = req.cookies?.pisowifi_session || bodyToken || null;
    
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
          // SECURITY: Validate clientIP before using in shell command to prevent command injection
          if (!clientIP || !isValidIPv4(clientIP)) {
            throw new Error('Invalid or missing client IP');
          }
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
      sessionToken,
      sessionDuration,
      parsedDeviceInfo
    });
    
    // Generate session token if not present
    if (!sessionToken) {
      sessionToken = generateSessionToken();
      res.cookie('pisowifi_session', sessionToken, {
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        httpOnly: true,
        sameSite: 'lax'
      });
      console.log('[SESSION] Generated new session token for connect');
    }

    // Create or update client record - simplified version first
    let clientResult;
    try {
      // Try full insert first with session_token
      clientResult = await db.query(
        `INSERT INTO clients (
          mac_address, ip_address, session_token, device_name, device_type, os, browser, 
          user_agent, platform, language, screen_resolution, timezone,
          status, time_remaining, created_at, last_seen
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (mac_address) 
        DO UPDATE SET 
          ip_address = EXCLUDED.ip_address,
          session_token = COALESCE(EXCLUDED.session_token, clients.session_token),
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
          detectedMac.toUpperCase(), clientIP, sessionToken,
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
      // Fallback to basic client record with session_token
      clientResult = await db.query(
        `INSERT INTO clients (mac_address, ip_address, session_token, status, time_remaining, created_at, last_seen)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (mac_address) 
         DO UPDATE SET 
           ip_address = EXCLUDED.ip_address,
           session_token = COALESCE(EXCLUDED.session_token, clients.session_token),
           status = EXCLUDED.status,
           time_remaining = EXCLUDED.time_remaining,
           last_seen = CURRENT_TIMESTAMP
         RETURNING id`,
        [detectedMac.toUpperCase(), clientIP, sessionToken, 'CONNECTED', sessionDuration]
      );
    }

    const clientId = clientResult.rows[0].id;
    console.log('Client record created with ID:', clientId);
    // Apply per-client bandwidth defaults from network_config
    console.log('Step 4.5: Applying per-client bandwidth defaults...');
    try {
      const networkConfig = await db.query('SELECT * FROM network_config WHERE id = 1');
      if (networkConfig.rows.length > 0) {
        const config = networkConfig.rows[0];
        if (config.per_client_bandwidth_enabled) {
          const downloadLimit = config.per_client_download_limit || 0;
          const uploadLimit = config.per_client_upload_limit || 0;
          await db.query(
            'UPDATE clients SET download_limit = $1, upload_limit = $2 WHERE id = $3',
            [downloadLimit, uploadLimit, clientId]
          );
          console.log(`Applied bandwidth limits to client ${clientId}: Download=${downloadLimit}kbps, Upload=${uploadLimit}kbps`);
        }
      }
    } catch (bwError) {
      console.warn('Failed to apply per-client bandwidth defaults:', bwError.message);
    }
    console.log('Step 5: Creating session record...');
    // Create session record with session_token
    const sessionResult = await db.query(
      `INSERT INTO sessions (client_id, mac_address, ip_address, session_token, duration, status, started_at)
       VALUES ($1, $2, $3, $4, $5, 'ACTIVE', CURRENT_TIMESTAMP)
       RETURNING id`,
      [clientId, detectedMac.toUpperCase(), clientIP, sessionToken, sessionDuration]
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
      // SECURITY: Validate MAC address before shell execution
      const { isValidMacAddress, sanitizeMacAddress } = require('../utils/validators');
      if (isValidMacAddress(detectedMac)) {
        const safeMac = sanitizeMacAddress(detectedMac);
        await execAsync(`sudo ${__dirname}/../../scripts/pisowifi-allow-client ${safeMac}`);
        console.log('Allow script executed successfully');
      } else {
        console.warn('Invalid MAC format, skipping allow script');
      }
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

// Test coin detection endpoint - DEVELOPMENT ONLY
router.post('/test-coin', async (req, res) => {
  // Block in production
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }
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

// Debug endpoint to check portal authentication state - DEVELOPMENT ONLY
router.get('/debug-auth', async (req, res) => {
  // Block in production
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }
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
      // SECURITY: Validate clientIP before using in shell command to prevent command injection
      if (clientIP && isValidIPv4(clientIP)) {
        const { stdout: arpOutput } = await execAsync(`arp -n ${clientIP} 2>/dev/null || echo ""`);
        if (arpOutput) {
          const arpMatch = arpOutput.match(/([0-9a-fA-F]{2}[:-]){5}([0-9a-fA-F]{2})/);
          if (arpMatch) {
            detectedMac = arpMatch[0].toUpperCase();
          }
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
      // SECURITY: Validate clientIP before using in shell command to prevent command injection
      if (clientIP && isValidIPv4(clientIP)) {
        const { stdout: arpOutput } = await execAsync(`arp -n ${clientIP} 2>/dev/null || echo ""`);
        if (arpOutput) {
          const arpMatch = arpOutput.match(/([0-9a-fA-F]{2}[:-]){5}([0-9a-fA-F]{2})/);
          if (arpMatch) {
            detectedMac = arpMatch[0].toUpperCase();
          }
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

// Captive portal diagnostic test page
router.get('/test', async (req, res) => {
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

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>PISOWifi Captive Test</title>
  </head>
  <body>
    <h1>PISOWifi Captive Test</h1>
    <p><strong>Client IP:</strong> ${clientIP || 'unknown'}</p>
    <p><strong>Server Host:</strong> ${req.headers.host || 'unknown'}</p>
    <p>This endpoint is for diagnostics only.</p>
  </body>
</html>`);
  } catch (error) {
    console.error('Captive test page error:', error);
    res.status(500).send('Test page error: ' + error.message);
  }
});

// Client pause/resume endpoint (for self-service)
router.post('/pause-resume', async (req, res) => {
  try {
    const { sessionToken, mac_address } = req.body;

    if (!sessionToken && !mac_address) {
      return res.status(400).json({ error: 'Session token or MAC address required' });
    }

    // Find client by session token or MAC
    let client = null;
    if (sessionToken) {
      const result = await db.query('SELECT * FROM clients WHERE session_token = $1', [sessionToken]);
      if (result.rows.length > 0) {
        client = result.rows[0];
      }
    } else if (mac_address) {
      const result = await db.query('SELECT * FROM clients WHERE mac_address = $1', [mac_address]);
      if (result.rows.length > 0) {
        client = result.rows[0];
      }
    }

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Toggle status between CONNECTED and PAUSED
    const newStatus = client.status === 'PAUSED' ? 'CONNECTED' : 'PAUSED';

    // Update status
    await db.query('UPDATE clients SET status = $1, last_seen = CURRENT_TIMESTAMP WHERE id = $2', [newStatus, client.id]);

    // Apply or remove network restrictions
    if (newStatus === 'PAUSED') {
      await networkManager.deauthenticateClient(client.mac_address);
    } else {
      await networkManager.authenticateClient(client.mac_address, client.ip_address, client.time_remaining);
    }

    res.json({ 
      success: true, 
      status: newStatus,
      message: newStatus === 'PAUSED' ? 'Session paused' : 'Session resumed'
    });

  } catch (error) {
    console.error('Pause/resume error:', error);
    res.status(500).json({ error: 'Failed to pause/resume session' });
  }
});

module.exports = router;