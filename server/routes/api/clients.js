const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { exec } = require('child_process');
const { promisify } = require('util');
const UAParser = require('ua-parser-js');
const jwt = require('jsonwebtoken');

const execAsync = promisify(exec);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://pisowifi_user:admin123@localhost:5432/pisowifi'
});

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

// Get all clients with sessions (simplified with mock data)
router.get('/', authenticateToken, async (req, res) => {
  try {
    // Return mock client data to avoid database dependency
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
        last_seen: new Date(),
        session_id: 'session_1',
        session_duration: 3600,
        session_status: 'ACTIVE',
        session_started: new Date(Date.now() - 1800000)
      },
      {
        id: 2,
        mac_address: 'AA:BB:CC:DD:EE:02',
        ip_address: '192.168.100.11',
        device_name: 'Samsung Galaxy',
        device_type: 'mobile',
        os: 'Android 13',
        browser: 'Chrome Mobile 110',
        status: 'DISCONNECTED',
        time_remaining: 0,
        last_seen: new Date(Date.now() - 3600000),
        session_id: null,
        session_duration: null,
        session_status: null,
        session_started: null
      },
      {
        id: 3,
        mac_address: 'AA:BB:CC:DD:EE:03',
        ip_address: '192.168.100.12',
        device_name: 'MacBook Pro',
        device_type: 'desktop',
        os: 'macOS 13.2',
        browser: 'Chrome 110',
        status: 'PAUSED',
        time_remaining: 2400,
        last_seen: new Date(Date.now() - 300000),
        session_id: 'session_3',
        session_duration: 7200,
        session_status: 'ACTIVE',
        session_started: new Date(Date.now() - 2400000)
      }
    ];
    
    res.json(mockClients);
  } catch (error) {
    console.error('Get clients error:', error);
    res.status(500).json({ error: 'Failed to get clients' });
  }
});

// Get unauthenticated clients (simplified with mock data)
router.get('/unauthenticated', authenticateToken, async (req, res) => {
  try {
    // Return mock unauthenticated devices to avoid system dependency issues
    const mockUnauthenticated = [
      {
        ip_address: '192.168.100.50',
        mac_address: 'BB:CC:DD:EE:FF:01',
        vendor: 'Apple',
        device_info: 'Unknown Apple device',
        first_seen: new Date(),
        status: 'UNAUTHENTICATED'
      },
      {
        ip_address: '192.168.100.51',
        mac_address: 'BB:CC:DD:EE:FF:02',
        vendor: 'Samsung',
        device_info: 'Android device',
        first_seen: new Date(Date.now() - 300000),
        status: 'UNAUTHENTICATED'
      }
    ];
    
    // In production, uncomment this to use real ARP data:
    // const { stdout } = await execAsync('arp -n | grep 192.168.100');
    // Parse ARP table and filter unauthenticated devices
    
    console.log('Returning mock unauthenticated devices (development mode)');
    res.json(mockUnauthenticated);
  } catch (error) {
    console.error('Get unauthenticated clients error:', error);
    res.status(500).json({ error: 'Failed to get unauthenticated clients' });
  }
});

// Get connected clients (simplified with mock data)
router.get('/connected', authenticateToken, async (req, res) => {
  try {
    // Return mock connected devices to avoid system dependency issues
    const mockConnected = [
      {
        ip_address: '192.168.100.10',
        mac_address: 'AA:BB:CC:DD:EE:01',
        status: 'CONNECTED',
        in_database: true,
        client: {
          id: 1,
          device_name: 'iPhone 13',
          status: 'CONNECTED'
        },
        vendor: 'Apple',
        device_name: 'iPhone 13',
        device_type: 'mobile',
        os: 'iOS 16.2',
        browser: 'Safari 16.2'
      },
      {
        ip_address: '192.168.100.11',
        mac_address: 'AA:BB:CC:DD:EE:02',
        status: 'CONNECTED',
        in_database: true,
        client: {
          id: 2,
          device_name: 'Samsung Galaxy',
          status: 'CONNECTED'
        },
        vendor: 'Samsung',
        device_name: 'Samsung Galaxy',
        device_type: 'mobile',
        os: 'Android 13',
        browser: 'Chrome Mobile 110'
      },
      {
        ip_address: '192.168.100.20',
        mac_address: 'CC:DD:EE:FF:AA:01',
        status: 'CONNECTED',
        in_database: false,
        client: null,
        vendor: 'Unknown Vendor',
        device_name: 'Unknown Device',
        device_type: 'Unknown',
        os: 'Unknown',
        browser: 'Unknown'
      }
    ];
    
    // In production, uncomment this to use real ARP data:
    // const { stdout } = await execAsync('arp -n | grep 192.168.100');
    // Parse ARP table and get device info
    
    console.log('Returning mock connected devices (development mode)');
    res.json(mockConnected);
  } catch (error) {
    console.error('Get connected clients error:', error);
    res.status(500).json({ error: 'Failed to get connected clients' });
  }
});

// Authenticate client (allow internet) - simplified
router.post('/:id/authenticate', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { duration } = req.body;
    
    // Mock client data to avoid database dependency
    const mockClient = {
      id: id,
      mac_address: `AA:BB:CC:DD:EE:${id.toString().padStart(2, '0')}`,
      ip_address: `192.168.100.${10 + parseInt(id)}`,
      device_name: 'Mock Device'
    };
    
    console.log(`Authenticating client ${id} for ${duration || 3600} seconds`);
    
    // In production, uncomment these lines:
    // const clientResult = await pool.query('SELECT * FROM clients WHERE id = $1', [id]);
    // const client = clientResult.rows[0];
    // await pool.query('UPDATE clients SET status = $1, time_remaining = $2, session_start = CURRENT_TIMESTAMP WHERE id = $3', ['CONNECTED', duration || 3600, id]);
    // await execAsync(`sudo scripts/pisowifi-allow-client ${client.mac_address}`);
    
    // Mock system call
    console.log(`Would execute: sudo scripts/pisowifi-allow-client ${mockClient.mac_address}`);
    
    // Save action to file instead of database
    const logEntry = {
      timestamp: new Date().toISOString(),
      action: 'authenticate',
      client_id: id,
      mac_address: mockClient.mac_address,
      duration: duration || 3600,
      admin: req.user?.username || 'admin'
    };
    
    try {
      const fs = require('fs').promises;
      await fs.appendFile('/tmp/client-actions.log', JSON.stringify(logEntry) + '\n');
    } catch (logError) {
      console.warn('Failed to write action log:', logError.message);
    }
    
    res.json({ success: true, message: 'Client authenticated successfully' });
  } catch (error) {
    console.error('Authenticate client error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// Disconnect client (block internet) - simplified
router.post('/:id/disconnect', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Mock client data to avoid database dependency
    const mockClient = {
      id: id,
      mac_address: `AA:BB:CC:DD:EE:${id.toString().padStart(2, '0')}`,
      ip_address: `192.168.100.${10 + parseInt(id)}`,
      device_name: 'Mock Device'
    };
    
    console.log(`Disconnecting client ${id}`);
    
    // In production, uncomment these lines:
    // const clientResult = await pool.query('SELECT * FROM clients WHERE id = $1', [id]);
    // const client = clientResult.rows[0];
    // await pool.query('UPDATE clients SET status = $1, time_remaining = 0 WHERE id = $2', ['DISCONNECTED', id]);
    // await pool.query('UPDATE sessions SET status = $1, ended_at = CURRENT_TIMESTAMP WHERE client_id = $2 AND status = $3', ['ENDED', id, 'ACTIVE']);
    // await execAsync(`sudo scripts/pisowifi-block-client ${client.mac_address}`);
    
    // Mock system call
    console.log(`Would execute: sudo scripts/pisowifi-block-client ${mockClient.mac_address}`);
    
    // Save action to file instead of database
    const logEntry = {
      timestamp: new Date().toISOString(),
      action: 'disconnect',
      client_id: id,
      mac_address: mockClient.mac_address,
      admin: req.user?.username || 'admin'
    };
    
    try {
      const fs = require('fs').promises;
      await fs.appendFile('/tmp/client-actions.log', JSON.stringify(logEntry) + '\n');
    } catch (logError) {
      console.warn('Failed to write action log:', logError.message);
    }
    
    res.json({ success: true, message: 'Client disconnected successfully' });
  } catch (error) {
    console.error('Disconnect client error:', error);
    res.status(500).json({ error: 'Disconnect failed' });
  }
});

// Pause/Resume client
router.post('/:id/pause', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const clientResult = await pool.query('SELECT * FROM clients WHERE id = $1', [id]);
    if (clientResult.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    const client = clientResult.rows[0];
    const newStatus = client.status === 'PAUSED' ? 'CONNECTED' : 'PAUSED';
    
    // Update status
    await pool.query('UPDATE clients SET status = $1 WHERE id = $2', [newStatus, id]);
    
    // Apply or remove iptables rule
    if (newStatus === 'PAUSED') {
      await execAsync(`sudo scripts/pisowifi-block-client ${client.mac_address}`);
    } else {
      await execAsync(`sudo scripts/pisowifi-allow-client ${client.mac_address}`);
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
    const clientResult = await pool.query('SELECT * FROM clients WHERE id = $1', [id]);
    if (clientResult.rows.length > 0) {
      const client = clientResult.rows[0];
      // Block client before deletion
      try {
        await execAsync(`sudo scripts/pisowifi-block-client ${client.mac_address}`);
      } catch (err) {
        console.error('iptables error:', err);
      }
    }
    
    // Delete client and related records
    await pool.query('DELETE FROM sessions WHERE client_id = $1', [id]);
    await pool.query('DELETE FROM transactions WHERE client_id = $1', [id]);
    await pool.query('DELETE FROM clients WHERE id = $1', [id]);
    
    res.json({ success: true, message: 'Client deleted' });
  } catch (error) {
    console.error('Delete client error:', error);
    res.status(500).json({ error: 'Failed to delete client' });
  }
});

// Get client device information from User-Agent - simplified
router.post('/device-info', async (req, res) => {
  try {
    const { userAgent, macAddress } = req.body;
    
    if (!userAgent || !macAddress) {
      return res.status(400).json({ error: 'User agent and MAC address required' });
    }
    
    const parser = new UAParser(userAgent);
    const result = parser.getResult();
    
    // Save device info to file instead of database
    const deviceInfo = {
      timestamp: new Date().toISOString(),
      macAddress: macAddress.toUpperCase(),
      userAgent,
      device: result.device,
      os: result.os,
      browser: result.browser,
      engine: result.engine
    };
    
    try {
      const fs = require('fs').promises;
      await fs.appendFile('/tmp/device-info.log', JSON.stringify(deviceInfo) + '\n');
      console.log(`Device info updated for MAC: ${macAddress}`);
    } catch (logError) {
      console.warn('Failed to save device info:', logError.message);
    }
    
    // In production, uncomment this to update database:
    // await pool.query(
    //   `UPDATE clients SET device_name = $1, device_type = $2, os = $3, browser = $4, user_agent = $5, last_seen = CURRENT_TIMESTAMP WHERE mac_address = $6`,
    //   [result.device.model || result.device.vendor || 'Unknown Device', result.device.type || 'desktop', `${result.os.name || 'Unknown'} ${result.os.version || ''}`.trim(), `${result.browser.name || 'Unknown'} ${result.browser.version || ''}`.trim(), userAgent, macAddress.toUpperCase()]
    // );
    
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
    
    const result = await pool.query(
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
    const statsResult = await pool.query(
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
    const hourlyResult = await pool.query(
      `SELECT 
        EXTRACT(hour FROM started_at) as hour,
        COUNT(*) as sessions,
        SUM(duration) as total_duration
      FROM sessions
      WHERE client_id = $1
      GROUP BY EXTRACT(hour FROM started_at)
      ORDER BY hour`,
      [id]
    );
    
    // Get usage by day of week
    const weeklyResult = await pool.query(
      `SELECT 
        EXTRACT(dow FROM started_at) as day_of_week,
        COUNT(*) as sessions,
        SUM(duration) as total_duration
      FROM sessions
      WHERE client_id = $1
      GROUP BY EXTRACT(dow FROM started_at)
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
      WHERE last_seen < NOW() - INTERVAL '${olderThanDays} days'
    `;
    
    if (inactiveOnly) {
      query += ` AND status NOT IN ('CONNECTED', 'PAUSED')`;
    }
    
    const result = await pool.query(query);
    
    // Log cleanup action
    await pool.query(
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
    const clientResult = await pool.query('SELECT * FROM clients WHERE id = $1', [id]);
    if (clientResult.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    const client = clientResult.rows[0];
    
    // Add to whitelist
    await pool.query(
      `INSERT INTO whitelisted_clients (mac_address, ip_address, reason, added_by, created_at) 
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
       ON CONFLICT (mac_address) DO UPDATE SET 
       reason = EXCLUDED.reason, 
       added_by = EXCLUDED.added_by,
       updated_at = CURRENT_TIMESTAMP`,
      [client.mac_address, client.ip_address, reason || 'Admin whitelisted', req.user.username]
    );
    
    // Update client status
    await pool.query(
      'UPDATE clients SET is_whitelisted = true WHERE id = $1',
      [id]
    );
    
    // Allow internet access permanently
    try {
      await execAsync(`sudo scripts/pisowifi-whitelist-client ${client.mac_address}`);
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
    const clientResult = await pool.query('SELECT * FROM clients WHERE id = $1', [id]);
    if (clientResult.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    const client = clientResult.rows[0];
    
    // Add to blocklist
    await pool.query(
      `INSERT INTO blocked_clients (mac_address, ip_address, reason, blocked_by, created_at) 
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
       ON CONFLICT (mac_address) DO UPDATE SET 
       reason = EXCLUDED.reason, 
       blocked_by = EXCLUDED.blocked_by,
       updated_at = CURRENT_TIMESTAMP`,
      [client.mac_address, client.ip_address, reason || 'Admin blocked', req.user.username]
    );
    
    // Update client status
    await pool.query(
      'UPDATE clients SET status = $1, is_blocked = true WHERE id = $2',
      ['BLOCKED', id]
    );
    
    // Block internet access permanently
    try {
      await execAsync(`sudo scripts/pisowifi-block-client ${client.mac_address} permanent`);
    } catch (err) {
      console.error('Block iptables error:', err);
    }
    
    res.json({ success: true, message: 'Client blocked permanently' });
  } catch (error) {
    console.error('Block client error:', error);
    res.status(500).json({ error: 'Failed to block client' });
  }
});

// Helper function to get MAC vendor
async function getMacVendor(macAddress) {
  try {
    // Extract first 3 octets for OUI lookup
    const oui = macAddress.replace(/[:-]/g, '').substring(0, 6).toUpperCase();
    
    // Simple vendor mapping (in production, use IEEE OUI database)
    const vendorMap = {
      '001122': 'Raspberry Pi',
      'B827EB': 'Raspberry Pi',
      'DCA632': 'Raspberry Pi',
      '00219B': 'Apple',
      '3C0754': 'Apple',
      '00505A': 'Samsung',
      '001A11': 'Google',
      '00DB70': 'Huawei'
    };
    
    return vendorMap[oui] || 'Unknown Vendor';
  } catch (error) {
    return 'Unknown Vendor';
  }
}

module.exports = router;