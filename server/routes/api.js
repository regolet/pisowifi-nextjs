const express = require('express');
const router = express.Router();

// Mount API sub-routes
router.use('/clients', require('./api/clients'));
router.use('/settings', require('./api/settings'));
router.use('/network', require('./api/network'));
router.use('/coin-slots', require('./api/coin-slots'));
router.use('/sensor-adjustments', require('./api/sensor-adjustments'));
router.use('/transactions', require('./api/transactions'));
router.use('/device', require('./api/device'));
router.use('/ttl', require('./api/ttl'));
router.use('/logs', require('./api/logs'));

// Keep existing general API routes
const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const db = require('../db/sqlite-adapter');
const { authenticateAPI } = require('../middleware/security');
const { isValidMacAddress, sanitizeMacAddress, isValidIPv4, isValidDuration } = require('../utils/validators');

const execAsync = promisify(exec);
const scriptsPath = path.join(__dirname, '../../scripts');

// Client authentication endpoint
router.post('/clients/authenticate', authenticateAPI, async (req, res) => {
  try {
    const { macAddress, ipAddress, sessionDuration } = req.body;

    if (!macAddress) {
      return res.status(400).json({ error: 'MAC address is required' });
    }

    // SECURITY: Validate MAC address format to prevent command injection
    if (!isValidMacAddress(macAddress)) {
      return res.status(400).json({ error: 'Invalid MAC address format' });
    }

    if (ipAddress && !isValidIPv4(ipAddress)) {
      return res.status(400).json({ error: 'Invalid IP address format' });
    }

    if (sessionDuration !== undefined && !isValidDuration(sessionDuration)) {
      return res.status(400).json({ error: 'Invalid session duration (1-86400 seconds)' });
    }

    // Find or create client
    let clientResult = await db.query('SELECT * FROM clients WHERE mac_address = $1', [macAddress]);
    let client;

    if (clientResult.rows.length === 0) {
      // Create new client
      const insertResult = await db.query(
        'INSERT INTO clients (mac_address, ip_address, status, time_remaining) VALUES ($1, $2, $3, $4) RETURNING *',
        [macAddress, ipAddress, 'CONNECTED', sessionDuration || 1800]
      );
      client = insertResult.rows[0];
    } else {
      // Update existing client
      const updateResult = await db.query(
        'UPDATE clients SET ip_address = $1, status = $2, time_remaining = $3, session_start = CURRENT_TIMESTAMP, last_seen = CURRENT_TIMESTAMP WHERE mac_address = $4 RETURNING *',
        [ipAddress, 'CONNECTED', sessionDuration || clientResult.rows[0].time_remaining, macAddress]
      );
      client = updateResult.rows[0];
    }

    // Create new session
    const sessionResult = await db.query(
      'INSERT INTO sessions (client_id, mac_address, ip_address, duration, status) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [client.id, macAddress, ipAddress || '', sessionDuration || 1800, 'ACTIVE']
    );
    const session = sessionResult.rows[0];

    // Allow client through iptables
    try {
      // SECURITY: MAC address already validated, sanitize again before shell execution
      const safeMac = sanitizeMacAddress(macAddress);
      await execAsync(`sudo ${scriptsPath}/pisowifi-allow-client ${safeMac}`);

      // Log successful authentication
      await db.query(
        'INSERT INTO system_logs (level, message, category, metadata) VALUES ($1, $2, $3, $4)',
        ['INFO', `Client authenticated: ${macAddress}`, 'network', JSON.stringify({ ipAddress, sessionId: session.id })]
      );

    } catch (iptablesError) {
      console.error('Failed to configure iptables:', iptablesError);

      await db.query(
        'INSERT INTO system_logs (level, message, category, metadata) VALUES ($1, $2, $3, $4)',
        ['ERROR', `Failed to authenticate client in iptables: ${macAddress}`, 'network', JSON.stringify({ error: iptablesError.message })]
      );
    }

    res.json({
      success: true,
      client: {
        id: client.id,
        macAddress: client.mac_address,
        status: client.status,
        timeRemaining: client.time_remaining,
        sessionId: session.id
      }
    });

  } catch (error) {
    console.error('Client authentication error:', error);

    await db.query(
      'INSERT INTO system_logs (level, message, category) VALUES ($1, $2, $3)',
      ['ERROR', `Client authentication failed: ${error.message}`, 'network']
    );

    res.status(500).json({ error: 'Authentication failed' });
  }
});

// Client disconnect endpoint
router.post('/clients/disconnect', authenticateAPI, async (req, res) => {
  try {
    const { macAddress } = req.body;

    if (!macAddress) {
      return res.status(400).json({ error: 'MAC address is required' });
    }

    // SECURITY: Validate MAC address format to prevent command injection
    if (!isValidMacAddress(macAddress)) {
      return res.status(400).json({ error: 'Invalid MAC address format' });
    }

    // Update client status
    await db.query('UPDATE clients SET status = $1 WHERE mac_address = $2', ['DISCONNECTED', macAddress]);

    // Block client in iptables
    try {
      // SECURITY: MAC address already validated, sanitize again before shell execution
      const safeMac = sanitizeMacAddress(macAddress);
      await execAsync(`sudo ${scriptsPath}/pisowifi-block-client ${safeMac}`);
    } catch (iptablesError) {
      console.error('Failed to block client:', iptablesError);
    }

    res.json({ success: true, message: 'Client disconnected' });

  } catch (error) {
    console.error('Client disconnect error:', error);
    res.status(500).json({ error: 'Disconnect failed' });
  }
});

// Get clients
router.get('/clients', authenticateAPI, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM clients ORDER BY last_seen DESC');
    res.json(result.rows);
  } catch (error) {
    console.error('Get clients error:', error);
    res.status(500).json({ error: 'Failed to get clients' });
  }
});

// Get rates (public endpoint for portal)
router.get('/rates', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM rates WHERE is_active = true ORDER BY duration');
    res.json(result.rows);
  } catch (error) {
    console.error('Get rates error:', error);
    res.status(500).json({ error: 'Failed to get rates' });
  }
});

// Get all rates (admin endpoint)
router.get('/rates/all', authenticateAPI, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM rates ORDER BY duration');
    res.json(result.rows);
  } catch (error) {
    console.error('Get all rates error:', error);
    res.status(500).json({ error: 'Failed to get rates' });
  }
});

module.exports = router;