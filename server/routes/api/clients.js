const express = require('express');
const router = express.Router();
const { exec } = require('child_process');
const { promisify } = require('util');
const UAParser = require('ua-parser-js');
const jwt = require('jsonwebtoken');
const NetworkManager = require('../../services/network-manager');
const db = require('../../db/sqlite-adapter');

const execAsync = promisify(exec);
const networkManager = new NetworkManager();

// Auth middleware
const authenticateToken = (req, res, next) => {
  const token = req.cookies['auth-token'] || req.headers['authorization']?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Get all clients with sessions and real-time data (temporarily unprotected for testing)
router.get('/', async (req, res) => {
  try {
    // Get clients from database
    const dbClients = await db.query(
      `SELECT 
        c.*,
        s.id as session_id,
        s.duration as session_duration,
        s.status as session_status,
        s.started_at as session_started,
        s.time_used as session_time_used
      FROM clients c
      LEFT JOIN sessions s ON c.id = s.client_id AND s.status = 'ACTIVE'
      ORDER BY c.last_seen DESC`
    );
    
    console.log(`[DEBUG] Found ${dbClients.rows.length} clients in database`);
    dbClients.rows.forEach(client => {
      console.log(`[DEBUG] Client: MAC=${client.mac_address}, Status=${client.status}, TimeRemaining=${client.time_remaining}, SessionStatus=${client.session_status}`);
    });
    
    // Get real-time connected clients from network
    const connectedClients = await networkManager.getConnectedClients();
    
    // Merge database clients with real-time network data
    const mergedClients = dbClients.rows.map(client => {
      const networkClient = connectedClients.find(nc => nc.mac_address === client.mac_address);
      
      const merged = {
        ...client,
        // Update online status based on network data
        online: !!networkClient,
        network_info: networkClient || null,
        // Use time_remaining directly from database (it's already being decremented by the countdown system)
        time_remaining: client.time_remaining || 0,
        // Keep original session status
        session_status: client.session_status
      };
      
      // Additional debug logging for authenticated clients
      if (client.status === 'CONNECTED' && client.time_remaining > 0) {
        console.log(`[DEBUG] AUTHENTICATED Client found: MAC=${client.mac_address}, Status=${client.status}, TimeRemaining=${client.time_remaining}, Online=${!!networkClient}, SessionStatus=${client.session_status}`);
      }
      
      return merged;
    });
    
    // Add any network clients not in database as unauthenticated
    connectedClients.forEach(networkClient => {
      const existsInDb = mergedClients.find(mc => mc.mac_address === networkClient.mac_address);
      if (!existsInDb) {
        mergedClients.push({
          id: null,
          mac_address: networkClient.mac_address,
          ip_address: networkClient.ip_address,
          device_name: networkClient.hostname || 'Unknown Device',
          device_type: 'unknown',
          status: 'UNAUTHENTICATED',
          time_remaining: 0,
          online: true,
          network_info: networkClient,
          last_seen: new Date(),
          session_id: null,
          session_status: null
        });
      }
    });
    
    res.json(mergedClients);
  } catch (error) {
    console.error('Get clients error:', error);
    // Fallback to mock data if database fails
    const mockClients = [
      {
        id: 1,
        mac_address: 'AA:BB:CC:DD:EE:01',
        ip_address: '192.168.100.10',
        device_name: 'iPhone 13',
        device_type: 'mobile',
        os: 'iOS 16.2',
        browser: 'Safari 16.2',
        status: 'CONNECTED',
        time_remaining: 1800,
        online: true,
        last_seen: new Date()
      }
    ];
    res.json(mockClients);
  }
});

// Get unauthenticated clients 
router.get('/unauthenticated', authenticateToken, async (req, res) => {
  try {
    // Get all connected clients from network
    const connectedClients = await networkManager.getConnectedClients();
    
    // Filter for unauthenticated clients only
    const unauthenticatedClients = [];
    
    for (const networkClient of connectedClients) {
      try {
        // Check if client is authenticated in database
        const dbResult = await db.query(
          'SELECT * FROM clients WHERE mac_address = $1 AND status = $2 AND time_remaining > 0',
          [networkClient.mac_address.toUpperCase(), 'CONNECTED']
        );
        
        // If not authenticated or not in database, add to unauthenticated list
        if (dbResult.rows.length === 0) {
          unauthenticatedClients.push({
            ip_address: networkClient.ip_address,
            mac_address: networkClient.mac_address,
            hostname: networkClient.hostname || 'Unknown',
            vendor: await getMacVendor(networkClient.mac_address),
            device_info: networkClient.hostname || 'Unknown device',
            first_seen: new Date(),
            status: 'UNAUTHENTICATED',
            authenticated: false
          });
        }
      } catch (dbError) {
        // If database check fails, assume unauthenticated
        unauthenticatedClients.push({
          ip_address: networkClient.ip_address,
          mac_address: networkClient.mac_address,
          hostname: networkClient.hostname || 'Unknown',
          vendor: await getMacVendor(networkClient.mac_address),
          device_info: 'Unknown device',
          first_seen: new Date(),
          status: 'UNAUTHENTICATED',
          authenticated: false
        });
      }
    }
    
    console.log(`Found ${unauthenticatedClients.length} unauthenticated clients`);
    res.json(unauthenticatedClients);
  } catch (error) {
    console.error('Get unauthenticated clients error:', error);
    // Fallback to empty array
    res.json([]);
  }
});

// Get connected clients from network interfaces
router.get('/connected', authenticateToken, async (req, res) => {
  try {
    // Get real-time connected clients from NetworkManager
    const connectedClients = await networkManager.getConnectedClients();
    
    // Enrich with database information
    const enrichedClients = [];
    
    for (const networkClient of connectedClients) {
      try {
        // Look up client in database
        const dbResult = await db.query(
          'SELECT * FROM clients WHERE mac_address = $1',
          [networkClient.mac_address.toUpperCase()]
        );
        
        const dbClient = dbResult.rows[0];
        
        enrichedClients.push({
          ...networkClient,
          in_database: !!dbClient,
          client: dbClient || null,
          status: dbClient?.status || 'UNAUTHENTICATED',
          authenticated: dbClient?.status === 'CONNECTED' && dbClient?.time_remaining > 0,
          device_name: dbClient?.device_name || networkClient.hostname || 'Unknown Device',
          device_type: dbClient?.device_type || 'unknown',
          os: dbClient?.os || 'Unknown',
          browser: dbClient?.browser || 'Unknown',
          vendor: await getMacVendor(networkClient.mac_address),
          time_remaining: dbClient?.time_remaining || 0,
          last_seen: dbClient?.last_seen || new Date()
        });
      } catch (dbError) {
        // If database lookup fails, still include the network client
        enrichedClients.push({
          ...networkClient,
          in_database: false,
          client: null,
          status: 'UNAUTHENTICATED',
          authenticated: false,
          device_name: networkClient.hostname || 'Unknown Device',
          vendor: await getMacVendor(networkClient.mac_address)
        });
      }
    }
    
    console.log(`Found ${enrichedClients.length} connected clients`);
    res.json(enrichedClients);
  } catch (error) {
    console.error('Get connected clients error:', error);
    // Fallback: try direct ARP/neighbor table lookup
    try {
      const { stdout: arpOutput } = await execAsync('ip neighbor show | grep -E "192\\.168\\.(1|100)\\.[0-9]+"');
      const arpLines = arpOutput.split('\n').filter(line => line.trim());
      
      const fallbackClients = arpLines.map(line => {
        const parts = line.split(' ');
        return {
          ip_address: parts[0],
          mac_address: parts[4] || 'unknown',
          status: 'CONNECTED',
          in_database: false,
          client: null,
          vendor: 'Unknown',
          device_name: 'Unknown Device'
        };
      });
      
      res.json(fallbackClients);
    } catch (fallbackError) {
      res.status(500).json({ error: 'Failed to get connected clients' });
    }
  }
});

// Authenticate client (allow internet)
router.post('/:id/authenticate', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { duration } = req.body;
    
    // Get client from database
    const clientResult = await db.query('SELECT * FROM clients WHERE id = $1', [id]);
    if (clientResult.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    const client = clientResult.rows[0];
    const authDuration = duration || 3600; // Default 1 hour
    
    console.log(`Authenticating client ${client.mac_address} for ${authDuration} seconds`);
    
    // Update client status in database
    await db.query(
      'UPDATE clients SET status = $1, time_remaining = $2, last_seen = CURRENT_TIMESTAMP WHERE id = $3',
      ['CONNECTED', authDuration, id]
    );
    
    // Create new session
    const sessionResult = await db.query(
      `INSERT INTO sessions (client_id, mac_address, ip_address, duration, status, started_at)
       VALUES ($1, $2, $3, $4, 'ACTIVE', CURRENT_TIMESTAMP)
       RETURNING id`,
      [id, client.mac_address, client.ip_address, authDuration]
    );
    
    // Authenticate client using NetworkManager
    const authResult = await networkManager.authenticateClient(client.mac_address, client.ip_address, authDuration);
    
    if (authResult.success) {
      // Also run the allow script
      try {
        await execAsync(`sudo ${__dirname}/../../../scripts/pisowifi-allow-client ${client.mac_address}`);
      } catch (scriptError) {
        console.warn('Allow script failed:', scriptError.message);
      }
    } else {
      // If NetworkManager auth failed, revert database changes
      await db.query('UPDATE clients SET status = $1 WHERE id = $2', ['DISCONNECTED', id]);
      await db.query('UPDATE sessions SET status = $1 WHERE id = $2', ['FAILED', sessionResult.rows[0].id]);
      throw new Error(authResult.error);
    }
    
    // Log the action
    await db.query(
      'INSERT INTO system_logs (level, message, category, metadata) VALUES ($1, $2, $3, $4)',
      ['INFO', `Client manually authenticated: ${client.mac_address}`, 'admin',
       JSON.stringify({ admin: req.user?.username, duration: authDuration, client_id: id })]
    );
    
    res.json({ 
      success: true, 
      message: 'Client authenticated successfully',
      session_id: sessionResult.rows[0].id,
      expires_at: new Date(Date.now() + authDuration * 1000)
    });
  } catch (error) {
    console.error('Authenticate client error:', error);
    res.status(500).json({ error: 'Authentication failed: ' + error.message });
  }
});

// Disconnect client (block internet)
router.post('/:id/disconnect', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get client from database
    const clientResult = await db.query('SELECT * FROM clients WHERE id = $1', [id]);
    if (clientResult.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    const client = clientResult.rows[0];
    console.log(`Disconnecting client ${client.mac_address}`);
    
    // Update client status
    await db.query(
      'UPDATE clients SET status = $1, time_remaining = 0 WHERE id = $2',
      ['DISCONNECTED', id]
    );
    
    // End active sessions
    await db.query(
      'UPDATE sessions SET status = $1, ended_at = CURRENT_TIMESTAMP WHERE client_id = $2 AND status = $3',
      ['ENDED', id, 'ACTIVE']
    );
    
    // Deauthenticate client using NetworkManager
    const deauthResult = await networkManager.deauthenticateClient(client.mac_address);
    
    if (deauthResult.success) {
      // Also run the block script
      try {
        await execAsync(`sudo ${__dirname}/../../../scripts/pisowifi-block-client ${client.mac_address}`);
      } catch (scriptError) {
        console.warn('Block script failed:', scriptError.message);
      }
    }
    
    // Log the action
    await db.query(
      'INSERT INTO system_logs (level, message, category, metadata) VALUES ($1, $2, $3, $4)',
      ['INFO', `Client manually disconnected: ${client.mac_address}`, 'admin',
       JSON.stringify({ admin: req.user?.username, client_id: id })]
    );
    
    res.json({ success: true, message: 'Client disconnected successfully' });
  } catch (error) {
    console.error('Disconnect client error:', error);
    res.status(500).json({ error: 'Disconnect failed: ' + error.message });
  }
});

// Pause/Resume client
router.post('/:id/pause', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const clientResult = await db.query('SELECT * FROM clients WHERE id = $1', [id]);
    if (clientResult.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    const client = clientResult.rows[0];
    const newStatus = client.status === 'PAUSED' ? 'CONNECTED' : 'PAUSED';
    
    // Update status
    await db.query('UPDATE clients SET status = $1 WHERE id = $2', [newStatus, id]);
    
    // Apply or remove iptables rule
    if (newStatus === 'PAUSED') {
      await networkManager.deauthenticateClient(client.mac_address);
      await execAsync(`sudo ${__dirname}/../../../scripts/pisowifi-block-client ${client.mac_address}`);
    } else {
      await networkManager.authenticateClient(client.mac_address, client.ip_address, client.time_remaining);
      await execAsync(`sudo ${__dirname}/../../../scripts/pisowifi-allow-client ${client.mac_address}`);
    }
    
    res.json({ success: true, status: newStatus });
  } catch (error) {
    console.error('Pause client error:', error);
    res.status(500).json({ error: 'Failed to pause/resume client' });
  }
});

// Delete client
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get client first
    const clientResult = await db.query('SELECT * FROM clients WHERE id = $1', [id]);
    if (clientResult.rows.length > 0) {
      const client = clientResult.rows[0];
      // Block client before deletion
      try {
        await networkManager.deauthenticateClient(client.mac_address);
        await execAsync(`sudo ${__dirname}/../../../scripts/pisowifi-block-client ${client.mac_address}`);
      } catch (err) {
        console.error('iptables error:', err);
      }
    }
    
    // Delete client and related records
    await db.query('DELETE FROM sessions WHERE client_id = $1', [id]);
    await db.query('DELETE FROM transactions WHERE client_id = $1', [id]);
    await db.query('DELETE FROM clients WHERE id = $1', [id]);
    
    res.json({ success: true, message: 'Client deleted' });
  } catch (error) {
    console.error('Delete client error:', error);
    res.status(500).json({ error: 'Failed to delete client' });
  }
});

// Get client device information from User-Agent
router.post('/device-info', async (req, res) => {
  try {
    const { userAgent, macAddress } = req.body;
    
    if (!userAgent || !macAddress) {
      return res.status(400).json({ error: 'User agent and MAC address required' });
    }
    
    const parser = new UAParser(userAgent);
    const result = parser.getResult();
    
    // Update client in database if exists
    try {
      await db.query(
        `UPDATE clients SET 
         device_name = $1, device_type = $2, os = $3, browser = $4, user_agent = $5, last_seen = CURRENT_TIMESTAMP 
         WHERE mac_address = $6`,
        [
          result.device.model || result.device.vendor || 'Unknown Device',
          result.device.type || 'desktop',
          `${result.os.name || 'Unknown'} ${result.os.version || ''}`.trim(),
          `${result.browser.name || 'Unknown'} ${result.browser.version || ''}`.trim(),
          userAgent,
          macAddress.toUpperCase()
        ]
      );
      console.log(`Device info updated for MAC: ${macAddress}`);
    } catch (dbError) {
      console.warn('Failed to update device info in database:', dbError.message);
    }
    
    res.json({
      success: true,
      deviceInfo: {
        device: result.device,
        os: result.os,
        browser: result.browser,
        engine: result.engine
      }
    });
  } catch (error) {
    console.error('Device info error:', error);
    res.status(500).json({ error: 'Failed to update device info' });
  }
});

// Get client connection history
router.get('/:id/history', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await db.query(
      `SELECT 
        s.id,
        s.started_at,
        s.ended_at,
        s.duration,
        s.status,
        t.amount,
        t.coins_used,
        t.payment_method
      FROM sessions s
      LEFT JOIN transactions t ON s.id = t.session_id
      WHERE s.client_id = $1
      ORDER BY s.started_at DESC
      LIMIT 50`,
      [id]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Get client history error:', error);
    res.status(500).json({ error: 'Failed to get client history' });
  }
});

// Get client usage analytics
router.get('/:id/analytics', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get basic stats
    const statsResult = await db.query(
      `SELECT 
        COUNT(s.id) as total_sessions,
        SUM(s.duration) as total_time,
        AVG(s.duration) as avg_session_time,
        SUM(t.amount) as total_spent,
        COUNT(DISTINCT DATE(s.started_at)) as days_active,
        MAX(s.started_at) as last_session
      FROM sessions s
      LEFT JOIN transactions t ON s.id = t.session_id
      WHERE s.client_id = $1`,
      [id]
    );
    
    // Get usage by hour of day
    const hourlyResult = await db.query(
      `SELECT 
        strftime('%H', started_at) as hour,
        COUNT(*) as sessions,
        SUM(duration) as total_duration
      FROM sessions
      WHERE client_id = $1
      GROUP BY strftime('%H', started_at)
      ORDER BY hour`,
      [id]
    );
    
    // Get usage by day of week
    const weeklyResult = await db.query(
      `SELECT 
        strftime('%w', started_at) as day_of_week,
        COUNT(*) as sessions,
        SUM(duration) as total_duration
      FROM sessions
      WHERE client_id = $1
      GROUP BY strftime('%w', started_at)
      ORDER BY day_of_week`,
      [id]
    );
    
    res.json({
      stats: statsResult.rows[0],
      hourlyUsage: hourlyResult.rows,
      weeklyUsage: weeklyResult.rows
    });
  } catch (error) {
    console.error('Get client analytics error:', error);
    res.status(500).json({ error: 'Failed to get client analytics' });
  }
});

// Auto cleanup inactive clients
router.post('/cleanup', authenticateToken, async (req, res) => {
  try {
    const { olderThanDays = 30, inactiveOnly = true } = req.body;
    
    let query = `
      DELETE FROM clients 
      WHERE last_seen < datetime('now', '-${olderThanDays} days')
    `;
    
    if (inactiveOnly) {
      query += ` AND status NOT IN ('CONNECTED', 'PAUSED')`;
    }
    
    const result = await db.query(query);
    
    // Log cleanup action
    await db.query(
      'INSERT INTO system_logs (level, message, category, metadata) VALUES ($1, $2, $3, $4)',
      ['INFO', `Cleaned up ${result.rowCount} inactive clients`, 'system', 
       JSON.stringify({ days: olderThanDays, admin: req.user.username })]
    );
    
    res.json({ 
      success: true, 
      deleted: result.rowCount,
      message: `Cleaned up ${result.rowCount} inactive clients`
    });
  } catch (error) {
    console.error('Cleanup clients error:', error);
    res.status(500).json({ error: 'Failed to cleanup clients' });
  }
});

// Add client to whitelist
router.post('/:id/whitelist', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    
    // Get client
    const clientResult = await db.query('SELECT * FROM clients WHERE id = $1', [id]);
    if (clientResult.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    const client = clientResult.rows[0];
    
    // Add to whitelist
    await db.query(
      `INSERT INTO whitelisted_clients (mac_address, ip_address, reason, added_by, created_at) 
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
       ON CONFLICT (mac_address) DO UPDATE SET 
       reason = EXCLUDED.reason, 
       added_by = EXCLUDED.added_by,
       updated_at = CURRENT_TIMESTAMP`,
      [client.mac_address, client.ip_address, reason || 'Admin whitelisted', req.user.username]
    );
    
    // Update client status
    await db.query(
      'UPDATE clients SET is_whitelisted = true WHERE id = $1',
      [id]
    );
    
    // Allow internet access permanently
    try {
      await execAsync(`sudo ${__dirname}/../../../scripts/pisowifi-whitelist-client ${client.mac_address}`);
    } catch (err) {
      console.error('Whitelist iptables error:', err);
    }
    
    res.json({ success: true, message: 'Client added to whitelist' });
  } catch (error) {
    console.error('Whitelist client error:', error);
    res.status(500).json({ error: 'Failed to whitelist client' });
  }
});

// Block client permanently
router.post('/:id/block', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    
    // Get client
    const clientResult = await db.query('SELECT * FROM clients WHERE id = $1', [id]);
    if (clientResult.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    const client = clientResult.rows[0];
    
    // Add to blocklist
    await db.query(
      `INSERT INTO blocked_clients (mac_address, ip_address, reason, blocked_by, created_at) 
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
       ON CONFLICT (mac_address) DO UPDATE SET 
       reason = EXCLUDED.reason, 
       blocked_by = EXCLUDED.blocked_by,
       updated_at = CURRENT_TIMESTAMP`,
      [client.mac_address, client.ip_address, reason || 'Admin blocked', req.user.username]
    );
    
    // Update client status
    await db.query(
      'UPDATE clients SET status = $1, is_blocked = true WHERE id = $2',
      ['BLOCKED', id]
    );
    
    // Block internet access permanently
    try {
      await execAsync(`sudo ${__dirname}/../../../scripts/pisowifi-block-client ${client.mac_address} permanent`);
    } catch (err) {
      console.error('Block iptables error:', err);
    }
    
    res.json({ success: true, message: 'Client blocked permanently' });
  } catch (error) {
    console.error('Block client error:', error);
    res.status(500).json({ error: 'Failed to block client' });
  }
});

// Debug endpoint to check database state (unprotected for testing)
router.get('/debug-db', async (req, res) => {
  try {
    console.log('[DEBUG DB] Checking all clients in database...');
    
    // Get all clients
    const allClients = await db.query('SELECT * FROM clients ORDER BY last_seen DESC');
    console.log(`[DEBUG DB] Found ${allClients.rows.length} total clients in database`);
    
    // Get authenticated clients (status = CONNECTED and time_remaining > 0)
    const authClients = await db.query(
      'SELECT * FROM clients WHERE status = $1 AND time_remaining > 0 ORDER BY last_seen DESC',
      ['CONNECTED']
    );
    console.log(`[DEBUG DB] Found ${authClients.rows.length} authenticated clients`);
    
    // Get active sessions
    const activeSessions = await db.query(
      'SELECT * FROM sessions WHERE status = $1 ORDER BY started_at DESC',
      ['ACTIVE']
    );
    console.log(`[DEBUG DB] Found ${activeSessions.rows.length} active sessions`);
    
    // Log detailed info for each client
    allClients.rows.forEach(client => {
      console.log(`[DEBUG DB] Client ${client.mac_address}: Status=${client.status}, TimeRemaining=${client.time_remaining}, LastSeen=${client.last_seen}`);
    });
    
    authClients.rows.forEach(client => {
      console.log(`[DEBUG DB] AUTH Client ${client.mac_address}: Status=${client.status}, TimeRemaining=${client.time_remaining}, LastSeen=${client.last_seen}`);
    });
    
    activeSessions.rows.forEach(session => {
      console.log(`[DEBUG DB] SESSION: ClientID=${session.client_id}, MAC=${session.mac_address}, Status=${session.status}, Started=${session.started_at}`);
    });
    
    res.json({
      total_clients: allClients.rows.length,
      authenticated_clients: authClients.rows.length,
      active_sessions: activeSessions.rows.length,
      all_clients: allClients.rows,
      authenticated_clients_data: authClients.rows,
      active_sessions_data: activeSessions.rows
    });
  } catch (error) {
    console.error('[DEBUG DB] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to get MAC vendor
async function getMacVendor(macAddress) {
  try {
    // Extract first 3 octets for OUI lookup
    const oui = macAddress.replace(/[:-]/g, '').substring(0, 6).toUpperCase();
    
    // Extended vendor mapping for common devices
    const vendorMap = {
      // Raspberry Pi Foundation
      'B827EB': 'Raspberry Pi Foundation',
      'DCA632': 'Raspberry Pi Foundation',
      'E45F01': 'Raspberry Pi Foundation',
      // Apple
      '001451': 'Apple',
      '00219B': 'Apple',
      '3C0754': 'Apple',
      '7C:11:BE': 'Apple',
      '8C:85:90': 'Apple',
      // Samsung
      '00505A': 'Samsung Electronics',
      '001632': 'Samsung Electronics',
      '78D6F0': 'Samsung Electronics',
      // Google/Android
      '001A11': 'Google',
      'DA:A1:19': 'Google',
      // Intel (common in laptops)
      '001122': 'Intel Corporation',
      '7C:7A:91': 'Intel Corporation',
      // Realtek (common in network cards)
      '1C:BF:CE': 'Realtek Semiconductor',
      '00:E0:4C': 'Realtek Semiconductor',
      // Huawei
      '00DB70': 'Huawei Technologies',
      '70:72:3C': 'Huawei Technologies'
    };
    
    return vendorMap[oui] || vendorMap[macAddress.substring(0, 8).toUpperCase()] || 'Unknown Vendor';
  } catch (error) {
    return 'Unknown Vendor';
  }
}

module.exports = router;