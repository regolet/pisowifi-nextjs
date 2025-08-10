const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { exec } = require('child_process');
const { promisify } = require('util');
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

// Get all clients with sessions
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        c.*,
        s.id as session_id,
        s.duration as session_duration,
        s.status as session_status,
        s.started_at as session_started
      FROM clients c
      LEFT JOIN sessions s ON c.id = s.client_id AND s.status = 'ACTIVE'
      ORDER BY c.last_seen DESC
    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Get clients error:', error);
    res.status(500).json({ error: 'Failed to get clients' });
  }
});

// Get connected clients (real-time from ARP table)
router.get('/connected', authenticateToken, async (req, res) => {
  try {
    // Get ARP table entries
    const { stdout } = await execAsync('arp -n | grep 192.168.100');
    const lines = stdout.trim().split('\n');
    
    const connectedDevices = [];
    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length >= 3) {
        const ip = parts[0];
        const mac = parts[2];
        if (mac !== '(incomplete)' && mac !== '<incomplete>') {
          // Check if client exists in database
          const clientResult = await pool.query(
            'SELECT * FROM clients WHERE mac_address = $1',
            [mac.toUpperCase()]
          );
          
          connectedDevices.push({
            ip_address: ip,
            mac_address: mac.toUpperCase(),
            status: 'CONNECTED',
            in_database: clientResult.rows.length > 0,
            client: clientResult.rows[0] || null
          });
        }
      }
    }
    
    res.json(connectedDevices);
  } catch (error) {
    console.error('Get connected clients error:', error);
    res.status(500).json({ error: 'Failed to get connected clients' });
  }
});

// Authenticate client (allow internet)
router.post('/:id/authenticate', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { duration } = req.body;
    
    // Get client
    const clientResult = await pool.query('SELECT * FROM clients WHERE id = $1', [id]);
    if (clientResult.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    const client = clientResult.rows[0];
    
    // Update client status
    await pool.query(
      'UPDATE clients SET status = $1, time_remaining = $2, session_start = CURRENT_TIMESTAMP WHERE id = $3',
      ['CONNECTED', duration || 3600, id]
    );
    
    // Create session
    await pool.query(
      'INSERT INTO sessions (client_id, mac_address, ip_address, duration, status) VALUES ($1, $2, $3, $4, $5)',
      [id, client.mac_address, client.ip_address, duration || 3600, 'ACTIVE']
    );
    
    // Allow internet access via iptables
    try {
      await execAsync(`sudo scripts/pisowifi-allow-client ${client.mac_address}`);
    } catch (err) {
      console.error('iptables error:', err);
    }
    
    // Log action
    await pool.query(
      'INSERT INTO system_logs (level, message, category, metadata) VALUES ($1, $2, $3, $4)',
      ['INFO', `Client ${client.mac_address} authenticated by admin`, 'admin', JSON.stringify({ admin: req.user.username })]
    );
    
    res.json({ success: true, message: 'Client authenticated' });
  } catch (error) {
    console.error('Authenticate client error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// Disconnect client (block internet)
router.post('/:id/disconnect', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get client
    const clientResult = await pool.query('SELECT * FROM clients WHERE id = $1', [id]);
    if (clientResult.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    const client = clientResult.rows[0];
    
    // Update client status
    await pool.query(
      'UPDATE clients SET status = $1, time_remaining = 0 WHERE id = $2',
      ['DISCONNECTED', id]
    );
    
    // End active sessions
    await pool.query(
      'UPDATE sessions SET status = $1, ended_at = CURRENT_TIMESTAMP WHERE client_id = $2 AND status = $3',
      ['ENDED', id, 'ACTIVE']
    );
    
    // Block internet access via iptables
    try {
      await execAsync(`sudo scripts/pisowifi-block-client ${client.mac_address}`);
    } catch (err) {
      console.error('iptables error:', err);
    }
    
    // Log action
    await pool.query(
      'INSERT INTO system_logs (level, message, category, metadata) VALUES ($1, $2, $3, $4)',
      ['INFO', `Client ${client.mac_address} disconnected by admin`, 'admin', JSON.stringify({ admin: req.user.username })]
    );
    
    res.json({ success: true, message: 'Client disconnected' });
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

module.exports = router;