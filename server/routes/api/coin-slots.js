const express = require('express');
const router = express.Router();
const { exec } = require('child_process');
const { promisify } = require('util');
const db = require('../../db/sqlite-adapter');
const { authenticateAPI } = require('../../middleware/security');
const { coinAbuseProtection } = require('../../middleware/coin-abuse-protection');
const { isValidIPv4, isValidMacAddress, sanitizeMacAddress, isValidSlotNumber, isValidCoinValue, isValidInteger } = require('../../utils/validators');

const execAsync = promisify(exec);

// Helper function to release expired coin slots (SQLite compatible)
async function releaseExpiredCoinSlots() {
  try {
    // Use direct SQL update for SQLite
    await db.query(`
      UPDATE coin_slots 
      SET status = 'available',
          claimed_by_client_id = NULL,
          claimed_by_ip = NULL,
          claimed_by_mac = NULL,
          claimed_by_session_token = NULL,
          claimed_at = NULL,
          expires_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE status = 'claimed' 
      AND expires_at IS NOT NULL
      AND expires_at < datetime('now')
    `);
  } catch (e) {
    console.warn('Failed to release expired coin slots:', e.message);
  }
}

// Reset all coin slots (admin only)
router.post('/reset-all', authenticateAPI, async (req, res) => {
  try {
    await db.query(`
      UPDATE coin_slots 
      SET status = 'available',
          claimed_by_client_id = NULL,
          claimed_by_ip = NULL,
          claimed_by_mac = NULL,
          claimed_by_session_token = NULL,
          claimed_at = NULL,
          expires_at = NULL,
          updated_at = CURRENT_TIMESTAMP
    `);
    console.log('All coin slots reset to available');
    res.json({ success: true, message: 'All coin slots reset to available' });
  } catch (error) {
    console.error('Reset coin slots error:', error);
    res.status(500).json({ success: false, error: 'Failed to reset coin slots' });
  }
});

// Check if client has an active claimed slot (no JWT auth - portal uses session token)
router.get('/my-slot', async (req, res) => {
  try {
    const { clientIp, clientMac, sessionToken } = req.query;

    if (!sessionToken) {
      return res.status(400).json({
        success: false,
        error: 'Session token required'
      });
    }

    if (clientIp && !isValidIPv4(clientIp)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid client IP address'
      });
    }

    // Allow "Unknown" MAC address for clients where MAC cannot be detected
    if (clientMac && clientMac !== 'Unknown' && !isValidMacAddress(clientMac)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid client MAC address'
      });
    }

    const safeClientMac = clientMac ? sanitizeMacAddress(clientMac) : undefined;

    if (!clientIp && !clientMac && !sessionToken) {
      return res.status(400).json({
        success: false,
        error: 'Client IP, MAC, or session token required'
      });
    }

    // Release expired slots first
    await releaseExpiredCoinSlots();

    // Find any slot claimed by this client
    const result = await db.query(`
      SELECT * FROM coin_slots 
      WHERE status = 'claimed' 
      AND (claimed_by_ip = $1 OR claimed_by_mac = $2 OR claimed_by_session_token = $3)
      AND expires_at > datetime('now')
      LIMIT 1
    `, [clientIp, safeClientMac, sessionToken]);

    if (result.rows.length > 0) {
      // Get queued coins for this client
      const queueResult = await db.query(`
        SELECT 
          COALESCE(SUM(coin_count), 0) as total_coins,
          COALESCE(SUM(total_value), 0) as total_value
        FROM coin_queues 
        WHERE status = 'queued'
        AND (client_ip = $1 OR client_mac = $2 OR session_token = $3)
      `, [clientIp, safeClientMac, sessionToken]);

      res.json({
        success: true,
        hasActiveSlot: true,
        slot: result.rows[0],
        queue: queueResult.rows[0] || { total_coins: 0, total_value: 0 }
      });
    } else {
      res.json({
        success: true,
        hasActiveSlot: false,
        slot: null,
        queue: null
      });
    }
  } catch (error) {
    console.error('Get my slot error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check slot status'
    });
  }
});

// Get all coin slots status
router.get('/slots', authenticateAPI, async (req, res) => {
  try {
    // Release expired slots first
    await releaseExpiredCoinSlots();

    // Get all slots
    const slotsResult = await db.query(`
      SELECT * FROM coin_slots ORDER BY slot_number
    `);

    // Get all queued coins for these slots
    const queuesResult = await db.query(`
      SELECT * FROM coin_queues WHERE status = 'queued' ORDER BY created_at
    `);

    // Build a map of slot_id -> queued coins
    const queueMap = {};
    for (const queue of queuesResult.rows) {
      if (!queueMap[queue.slot_id]) {
        queueMap[queue.slot_id] = [];
      }
      queueMap[queue.slot_id].push({
        id: queue.id,
        coin_value: queue.coin_value,
        coin_count: queue.coin_count,
        total_value: queue.total_value,
        created_at: queue.created_at
      });
    }

    // Add queued_coins to each slot
    const slots = slotsResult.rows.map(slot => ({
      ...slot,
      queued_coins: queueMap[slot.id] || []
    }));

    res.json({
      success: true,
      slots: slots
    });
  } catch (error) {
    console.error('Get coin slots error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get coin slots'
    });
  }
});

// Claim a coin slot (no JWT auth - portal users authenticate via session token in body)
router.post('/slots/:slotNumber/claim', coinAbuseProtection, async (req, res) => {
  try {
    const { slotNumber } = req.params;
    const { clientId, clientIp, clientMac, sessionToken, timeoutMinutes = 5 } = req.body;

    if (!sessionToken) {
      return res.status(400).json({ success: false, error: 'Session token required' });
    }

    if (!isValidSlotNumber(slotNumber)) {
      return res.status(400).json({ success: false, error: 'Invalid slot number (1-10)' });
    }

    if (clientIp && !isValidIPv4(clientIp)) {
      return res.status(400).json({ success: false, error: 'Invalid client IP address' });
    }

    // Allow 'Unknown' MAC address for clients where MAC cannot be detected
    if (clientMac && clientMac !== 'Unknown' && !isValidMacAddress(clientMac)) {
      return res.status(400).json({ success: false, error: 'Invalid client MAC address' });
    }

    const safeClientMac = clientMac ? (clientMac === 'Unknown' ? 'Unknown' : sanitizeMacAddress(clientMac)) : 'Unknown';

    console.log(`Attempting to claim slot ${slotNumber} for client ${clientIp} (${req.rateLimitInfo?.remaining || '?'} attempts remaining)`);

    // Release expired slots first
    await releaseExpiredCoinSlots();

    // Calculate expiration time and convert to ISO string for SQLite
    const expiresAt = new Date(Date.now() + (timeoutMinutes * 60 * 1000)).toISOString();
    
    // Handle undefined clientId - use null for SQLite
    const safeClientId = clientId || null;

    const result = await db.query(`
      UPDATE coin_slots 
      SET status = 'claimed',
          claimed_by_client_id = $1,
          claimed_by_ip = $2,
          claimed_by_mac = $3,
          claimed_by_session_token = $4,
          claimed_at = CURRENT_TIMESTAMP,
          expires_at = $5
      WHERE slot_number = $6 
      AND status = 'available'
      RETURNING *
    `, [safeClientId, clientIp, safeClientMac, sessionToken, expiresAt, slotNumber]);

    if (result.rows.length === 0) {
      // Check if slot exists or is already claimed
      const slotCheck = await db.query(
        'SELECT * FROM coin_slots WHERE slot_number = $1',
        [slotNumber]
      );

      if (slotCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Coin slot not found'
        });
      } else {
        return res.status(409).json({
          success: false,
          error: 'Coin slot is already claimed by another client'
        });
      }
    }

    // Emit real-time update
    const { io } = require('../../app');
    io.emit('coin-slot-claimed', {
      slot: result.rows[0],
      clientIp,
      clientMac
    });

    console.log(`Slot ${slotNumber} claimed successfully by ${clientIp}`);

    res.json({
      success: true,
      message: 'Coin slot claimed successfully',
      slot: result.rows[0]
    });
  } catch (error) {
    console.error('Claim coin slot error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to claim coin slot'
    });
  }
});

// Release a coin slot (no auth required - portal users can release their own slots)
router.post('/slots/:slotNumber/release', async (req, res) => {
  try {
    const { slotNumber } = req.params;
    const { clientIp, clientMac, sessionToken, preserveQueues = false } = req.body;

    if (!sessionToken) {
      return res.status(400).json({ success: false, error: 'Session token required' });
    }

    if (!isValidSlotNumber(slotNumber)) {
      return res.status(400).json({ success: false, error: 'Invalid slot number (1-10)' });
    }

    if (clientIp && !isValidIPv4(clientIp)) {
      return res.status(400).json({ success: false, error: 'Invalid client IP address' });
    }

    // Allow 'Unknown' MAC address for clients where MAC cannot be detected
    if (clientMac && clientMac !== 'Unknown' && !isValidMacAddress(clientMac)) {
      return res.status(400).json({ success: false, error: 'Invalid client MAC address' });
    }

    const safeClientMac = clientMac ? (clientMac === 'Unknown' ? 'Unknown' : sanitizeMacAddress(clientMac)) : 'Unknown';

    console.log(`Releasing slot ${slotNumber} for client ${clientIp} (MAC: ${clientMac})${preserveQueues ? ' (preserving queues)' : ''}`);

    // Begin transaction to handle slot release and queue preservation
    await db.query('BEGIN');

    try {
      // Get the slot ID before releasing - more lenient matching
      // Check by slot number first, then verify client match (IP, MAC, or just slot number if claimed)
      let slotInfo = await db.query(
        `SELECT id, claimed_by_ip, claimed_by_mac FROM coin_slots 
         WHERE slot_number = $1 
         AND status = 'claimed'
         AND (claimed_by_ip = $2 OR claimed_by_mac = $3 OR claimed_by_session_token = $4 OR $3 = 'Unknown')`,
        [slotNumber, clientIp, safeClientMac, sessionToken]
      );

      // If not found with strict match, try just by slot number and IP
      if (slotInfo.rows.length === 0) {
        slotInfo = await db.query(
          `SELECT id, claimed_by_ip, claimed_by_mac FROM coin_slots 
           WHERE slot_number = $1 
           AND status = 'claimed'
           AND claimed_by_ip = $2`,
          [slotNumber, clientIp]
        );
      }

      // If still not found, try just by slot number (for cleanup)
      if (slotInfo.rows.length === 0) {
        slotInfo = await db.query(
          `SELECT id, claimed_by_ip, claimed_by_mac FROM coin_slots 
           WHERE slot_number = $1 
           AND status = 'claimed'`,
          [slotNumber]
        );
        
        if (slotInfo.rows.length > 0) {
          console.log(`Slot ${slotNumber} found but claimed by different client (IP: ${slotInfo.rows[0].claimed_by_ip}, MAC: ${slotInfo.rows[0].claimed_by_mac}) - releasing anyway`);
        }
      }

      if (slotInfo.rows.length === 0) {
        await db.query('ROLLBACK');
        console.log(`Slot ${slotNumber} not found or not claimed - nothing to release`);
        // Return success anyway - slot is effectively released
        return res.json({
          success: true,
          message: 'Coin slot already released or not claimed'
        });
      }

      const slotId = slotInfo.rows[0].id;

      // If preserveQueues is true, update queue records to store client info directly
      // and disconnect them from the slot
      if (preserveQueues) {
        const preservedQueues = await db.query(`
          UPDATE coin_queues 
          SET slot_id = NULL,
              client_ip = COALESCE(client_ip, $1),
              client_mac = COALESCE(client_mac, $2)
          WHERE slot_id = $3 
          AND status = 'queued'
          AND (client_ip = $1 OR client_mac = $2 OR session_token = $4)
          RETURNING *
        `, [clientIp, safeClientMac, slotId, sessionToken]);

        console.log(`Preserved ${preservedQueues.rows.length} queued coins for client ${clientMac || clientIp}`);
      }

      // Release the slot
      const result = await db.query(`
        UPDATE coin_slots 
        SET status = 'available',
            claimed_by_client_id = NULL,
            claimed_by_ip = NULL,
            claimed_by_mac = NULL,
        claimed_by_session_token = NULL,
            claimed_at = NULL,
            expires_at = NULL
        WHERE slot_number = $1 
        RETURNING *
      `, [slotNumber]);

      await db.query('COMMIT');

      // Emit real-time update
      const { io } = require('../../app');
      io.emit('coin-slot-released', {
        slot: result.rows[0],
        clientIp,
        clientMac: safeClientMac,
        preserveQueues
      });

      console.log(`Slot ${slotNumber} released successfully`);

      res.json({
        success: true,
        message: `Coin slot released successfully${preserveQueues ? ' with queues preserved' : ''}`,
        slot: result.rows[0],
        preserveQueues
      });

    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('Release coin slot error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to release coin slot'
    });
  }
});

// Add coin to queue (no JWT auth - portal/ESP32 can add coins)
router.post('/slots/:slotNumber/add-coin', async (req, res) => {
  try {
    const { slotNumber } = req.params;
    const { clientId, clientIp, clientMac, sessionToken, coinValue, coinCount = 1 } = req.body;

    if (!sessionToken) {
      return res.status(400).json({ success: false, error: 'Session token required' });
    }

    if (!isValidSlotNumber(slotNumber)) {
      return res.status(400).json({ success: false, error: 'Invalid slot number (1-10)' });
    }

    if (clientIp && !isValidIPv4(clientIp)) {
      return res.status(400).json({ success: false, error: 'Invalid client IP address' });
    }

    // Allow 'Unknown' MAC address for clients where MAC cannot be detected
    if (clientMac && clientMac !== 'Unknown' && !isValidMacAddress(clientMac)) {
      return res.status(400).json({ success: false, error: 'Invalid client MAC address' });
    }

    const safeClientMac = clientMac ? (clientMac === 'Unknown' ? 'Unknown' : sanitizeMacAddress(clientMac)) : null;

    console.log(`Adding ${coinCount} coins of ₱${coinValue} to slot ${slotNumber} for client ${clientIp}`);

    // Validate input parameters
    if (!clientIp && !clientMac && !sessionToken) {
      return res.status(400).json({
        success: false,
        error: 'Client IP, MAC address, or session token required'
      });
    }

    if (!isValidCoinValue(coinValue)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid coin value'
      });
    }

    if (!isValidInteger(coinCount, 1, 1000)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid coin count'
      });
    }

    // Verify slot is claimed by this client
    const slotResult = await db.query(`
      SELECT id FROM coin_slots 
      WHERE slot_number = $1 
      AND status = 'claimed' 
      AND (claimed_by_ip = $2 OR claimed_by_mac = $3 OR claimed_by_session_token = $4)
    `, [slotNumber, clientIp, safeClientMac, sessionToken]);

    if (slotResult.rows.length === 0) {
      console.log(`Slot ${slotNumber} not found or not claimed by ${clientIp}/${clientMac}`);
      return res.status(403).json({
        success: false,
        error: 'Coin slot not claimed by this client'
      });
    }

    const slotId = slotResult.rows[0].id;
    const totalValue = parseFloat(coinValue) * parseInt(coinCount);

    console.log(`Slot ID: ${slotId}, Total Value: ₱${totalValue}`);

    // Begin transaction to handle coin addition and queue re-association
    await db.query('BEGIN');

    let reAssociated, queueResult;

    try {
      console.log('Starting transaction for coin addition...');

      // Re-associate any preserved queues (slot_id = NULL) with this slot
      console.log('Checking for preserved queues...');
      reAssociated = await db.query(`
        UPDATE coin_queues 
        SET slot_id = $1
        WHERE slot_id IS NULL 
        AND status = 'queued'
        AND (client_ip = $2 OR client_mac = $3 OR session_token = $4)
        RETURNING *
      `, [slotId, clientIp, safeClientMac, sessionToken]);

      if (reAssociated.rows.length > 0) {
        console.log(`Re-associated ${reAssociated.rows.length} preserved queues with slot ${slotNumber}`);
      } else {
        console.log('No preserved queues found to re-associate');
      }

      // Add new coin to queue with session_token
      console.log('Inserting new coin into queue...');
      queueResult = await db.query(`
        INSERT INTO coin_queues (
          slot_id, client_id, client_ip, client_mac, session_token,
          coin_value, coin_count, total_value, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'queued')
        RETURNING *
      `, [slotId, clientId, clientIp, safeClientMac, sessionToken, coinValue, coinCount, totalValue]);

      console.log('New coin inserted successfully:', queueResult.rows[0]);

      await db.query('COMMIT');
      console.log('Transaction committed successfully');

      // Get total queued amount for client (using multi-identifier lookup)
      const totalResult = await db.query(`
        SELECT 
          COALESCE(SUM(cq.coin_count), 0)::INTEGER as total_coins,
          COALESCE(SUM(cq.total_value), 0.00)::DECIMAL(10,2) as total_value,
          COUNT(cq.id)::INTEGER as queue_count
        FROM coin_queues cq
        WHERE cq.status = 'queued'
        AND (cq.client_ip = $1 OR cq.client_mac = $2 OR cq.session_token = $3)
      `, [clientIp, safeClientMac, sessionToken]);

      const queuedTotal = totalResult.rows[0];

      // Emit real-time update
      const { io } = require('../../app');
      io.emit('coin-added', {
        queue: queueResult.rows[0],
        total: queuedTotal,
        slotNumber,
        clientIp,
        clientMac: safeClientMac,
        reAssociated: reAssociated.rows.length > 0
      });

      console.log(`Coin added successfully. Client total: ₱${queuedTotal.total_value}`);

      res.json({
        success: true,
        message: 'Coin added to queue successfully' + (reAssociated.rows.length > 0 ? ' (restored previous coins)' : ''),
        queue: queueResult.rows[0],
        total: queuedTotal,
        reAssociated: reAssociated.rows.length
      });

    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Add coin error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add coin to queue: ' + error.message
    });
  }
});

// Get client's queued coins (no JWT auth - portal uses this)
router.get('/queues/client', async (req, res) => {
  try {
    const { clientIp, clientMac, sessionToken, includePreserved = false } = req.query;

    if (!sessionToken) {
      return res.status(400).json({ success: false, error: 'Session token required' });
    }

    if (clientIp && !isValidIPv4(clientIp)) {
      return res.status(400).json({ success: false, error: 'Invalid client IP address' });
    }

    // Allow 'Unknown' MAC address for clients where MAC cannot be detected
    if (clientMac && clientMac !== 'Unknown' && !isValidMacAddress(clientMac)) {
      return res.status(400).json({ success: false, error: 'Invalid client MAC address' });
    }

    const safeClientMac = clientMac ? (clientMac === 'Unknown' ? 'Unknown' : sanitizeMacAddress(clientMac)) : undefined;

    if (!clientIp && !clientMac && !sessionToken) {
      return res.status(400).json({
        success: false,
        error: 'Client IP, MAC address, or session token required'
      });
    }

    // Get queued coins for client (including preserved ones if requested)
    // Uses multi-identifier lookup for random MAC address support
    let queueQuery, queryParams;

    if (includePreserved === 'true') {
      // Include both slot-associated and preserved (slot_id = NULL) queues
      queueQuery = `
        SELECT 
          cq.*,
          cs.slot_number
        FROM coin_queues cq
        LEFT JOIN coin_slots cs ON cq.slot_id = cs.id
        WHERE cq.status = 'queued'
        AND (cq.client_ip = $1 OR cq.client_mac = $2 OR cq.session_token = $3)
        ORDER BY cq.created_at
      `;
    } else {
      // Only get queues associated with active slots
      queueQuery = `
        SELECT 
          cq.*,
          cs.slot_number
        FROM coin_queues cq
        JOIN coin_slots cs ON cq.slot_id = cs.id
        WHERE cq.status = 'queued'
        AND (cq.client_ip = $1 OR cq.client_mac = $2 OR cq.session_token = $3)
        ORDER BY cq.created_at
      `;
    }

    const queueResult = await db.query(queueQuery, [clientIp, safeClientMac, sessionToken]);

    // Get total using a custom query that includes preserved queues
    const totalResult = await db.query(`
      SELECT 
        COALESCE(SUM(cq.coin_count), 0)::INTEGER as total_coins,
        COALESCE(SUM(cq.total_value), 0.00)::DECIMAL(10,2) as total_value,
        COUNT(cq.id)::INTEGER as queue_count
      FROM coin_queues cq
      WHERE cq.status = 'queued'
      AND (cq.client_ip = $1 OR cq.client_mac = $2 OR cq.session_token = $3)
      ${includePreserved === 'true' ? '' : 'AND cq.slot_id IS NOT NULL'}
    `, [clientIp, safeClientMac, sessionToken]);

    const total = totalResult.rows[0];

    // Check if any queues are preserved (not associated with a slot)
    const hasPreservedQueues = queueResult.rows.some(queue => queue.slot_id === null);

    res.json({
      success: true,
      queues: queueResult.rows,
      total: total,
      preserved: hasPreservedQueues && includePreserved === 'true'
    });
  } catch (error) {
    console.error('Get client queues error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get client queues'
    });
  }
});

// Redeem all queued coins for client (no JWT auth - portal users redeem their coins)
router.post('/queues/redeem', async (req, res) => {
  try {
    const { clientId, clientIp, clientMac, sessionToken } = req.body;

    if (!sessionToken) {
      return res.status(400).json({ success: false, error: 'Session token required' });
    }

    if (clientIp && !isValidIPv4(clientIp)) {
      return res.status(400).json({ success: false, error: 'Invalid client IP address' });
    }

    // Allow 'Unknown' MAC address for clients where MAC cannot be detected
    if (clientMac && clientMac !== 'Unknown' && !isValidMacAddress(clientMac)) {
      return res.status(400).json({ success: false, error: 'Invalid client MAC address' });
    }

    const safeClientMac = clientMac ? (clientMac === 'Unknown' ? 'Unknown' : sanitizeMacAddress(clientMac)) : undefined;

    console.log(`Redeeming queued coins for client ${clientIp} (session: ${sessionToken ? 'present' : 'none'})`);

    // Update all queued coins to redeemed status (using multi-identifier lookup)
    const result = await db.query(`
      UPDATE coin_queues 
      SET status = 'redeemed'
      WHERE status = 'queued'
      AND (client_ip = $1 OR client_mac = $2 OR session_token = $3)
      RETURNING *
    `, [clientIp, safeClientMac, sessionToken]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No queued coins found for this client'
      });
    }

    // Calculate totals
    const totalCoins = result.rows.reduce((sum, queue) => sum + queue.coin_count, 0);
    const totalValue = result.rows.reduce((sum, queue) => sum + parseFloat(queue.total_value), 0);

    // Release any claimed slots by this client (using multi-identifier lookup)
    await db.query(`
      UPDATE coin_slots 
      SET status = 'available',
          claimed_by_client_id = NULL,
          claimed_by_ip = NULL,
          claimed_by_mac = NULL,
          claimed_at = NULL,
          expires_at = NULL
      WHERE (claimed_by_ip = $1 OR claimed_by_mac = $2)
    `, [clientIp, safeClientMac]);

    // Emit real-time update
    const { io } = require('../../app');
    io.emit('coins-redeemed', {
      redeemedQueues: result.rows,
      totalCoins,
      totalValue,
      clientIp,
      clientMac: safeClientMac
    });

    console.log(`Redeemed ${totalCoins} coins worth ₱${totalValue.toFixed(2)}`);

    res.json({
      success: true,
      message: 'Coins redeemed successfully',
      redeemedQueues: result.rows,
      totalCoins,
      totalValue
    });
  } catch (error) {
    console.error('Redeem coins error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to redeem coins'
    });
  }
});

// Get all coin queues (admin function)
router.get('/queues', authenticateAPI, async (req, res) => {
  try {
    console.log('Fetching all coin queues');

    // Get all active queues with slot and client information
    const result = await db.query(`
      SELECT 
        cq.*,
        cs.slot_number,
        cs.claimed_by_ip,
        cs.claimed_by_mac,
        c.device_name as client_device_name,
        c.mac_address as client_mac
      FROM coin_queues cq
      LEFT JOIN coin_slots cs ON cq.slot_id = cs.id
      LEFT JOIN clients c ON cq.client_id = c.id
      WHERE cq.status = 'queued'
      ORDER BY cq.created_at DESC
    `);

    res.json({
      success: true,
      queues: result.rows
    });
  } catch (error) {
    console.error('Get coin queues error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get coin queues'
    });
  }
});

// Cleanup expired queues (admin function)
router.post('/cleanup', authenticateAPI, async (req, res) => {
  try {
    console.log('Cleaning up expired coin slots and queues');

    // Release expired slots
    await releaseExpiredCoinSlots();
    
    // Get count of released slots for response
    const releasedSlotsCount = await db.query(`
      SELECT COUNT(*) as count FROM coin_slots 
      WHERE status = 'available' 
      AND expires_at IS NULL
    `);

    // Expire old queues (older than 1 hour) - SQLite compatible
    const expiredQueues = await db.query(`
      UPDATE coin_queues 
      SET status = 'expired'
      WHERE status = 'queued'
      AND datetime(created_at) < datetime('now', '-1 hour')
    `);

    res.json({
      success: true,
      message: 'Cleanup completed',
      releasedSlots: releasedSlotsCount.rows[0]?.count || 0,
      expiredQueues: expiredQueues.rowCount || 0
    });
  } catch (error) {
    console.error('Cleanup error:', error);
    res.status(500).json({
      success: false,
      error: 'Cleanup failed'
    });
  }
});

module.exports = router;