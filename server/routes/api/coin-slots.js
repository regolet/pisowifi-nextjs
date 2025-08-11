const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://pisowifi_user:admin123@localhost:5432/pisowifi'
});

// Get all coin slots status
router.get('/slots', async (req, res) => {
  try {
    // Release expired slots first
    await pool.query('SELECT release_expired_coin_slots()');
    
    // Get all slots with queue information
    const result = await pool.query(`
      SELECT 
        cs.*,
        COALESCE(
          json_agg(
            json_build_object(
              'id', cq.id,
              'coin_value', cq.coin_value,
              'coin_count', cq.coin_count,
              'total_value', cq.total_value,
              'created_at', cq.created_at
            ) ORDER BY cq.created_at
          ) FILTER (WHERE cq.id IS NOT NULL), 
          '[]'::json
        ) as queued_coins
      FROM coin_slots cs
      LEFT JOIN coin_queues cq ON cs.id = cq.slot_id AND cq.status = 'queued'
      GROUP BY cs.id
      ORDER BY cs.slot_number
    `);
    
    res.json({
      success: true,
      slots: result.rows
    });
  } catch (error) {
    console.error('Get coin slots error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get coin slots'
    });
  }
});

// Claim a coin slot
router.post('/slots/:slotNumber/claim', async (req, res) => {
  try {
    const { slotNumber } = req.params;
    const { clientId, clientIp, clientMac, timeoutMinutes = 5 } = req.body;
    
    console.log(`Attempting to claim slot ${slotNumber} for client ${clientIp}`);
    
    // Release expired slots first
    await pool.query('SELECT release_expired_coin_slots()');
    
    // Try to claim the slot
    const expiresAt = new Date(Date.now() + (timeoutMinutes * 60 * 1000));
    
    const result = await pool.query(`
      UPDATE coin_slots 
      SET status = 'claimed',
          claimed_by_client_id = $1,
          claimed_by_ip = $2,
          claimed_by_mac = $3,
          claimed_at = CURRENT_TIMESTAMP,
          expires_at = $4
      WHERE slot_number = $5 
      AND status = 'available'
      RETURNING *
    `, [clientId, clientIp, clientMac, expiresAt, slotNumber]);
    
    if (result.rows.length === 0) {
      // Check if slot exists or is already claimed
      const slotCheck = await pool.query(
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

// Release a coin slot
router.post('/slots/:slotNumber/release', async (req, res) => {
  try {
    const { slotNumber } = req.params;
    const { clientIp, clientMac } = req.body;
    
    console.log(`Releasing slot ${slotNumber} for client ${clientIp}`);
    
    const result = await pool.query(`
      UPDATE coin_slots 
      SET status = 'available',
          claimed_by_client_id = NULL,
          claimed_by_ip = NULL,
          claimed_by_mac = NULL,
          claimed_at = NULL,
          expires_at = NULL
      WHERE slot_number = $1 
      AND (claimed_by_ip = $2 OR claimed_by_mac = $3)
      RETURNING *
    `, [slotNumber, clientIp, clientMac]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Coin slot not found or not claimed by this client'
      });
    }
    
    // Emit real-time update
    const { io } = require('../../app');
    io.emit('coin-slot-released', {
      slot: result.rows[0],
      clientIp,
      clientMac
    });
    
    console.log(`Slot ${slotNumber} released successfully`);
    
    res.json({
      success: true,
      message: 'Coin slot released successfully',
      slot: result.rows[0]
    });
  } catch (error) {
    console.error('Release coin slot error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to release coin slot'
    });
  }
});

// Add coin to queue
router.post('/slots/:slotNumber/add-coin', async (req, res) => {
  try {
    const { slotNumber } = req.params;
    const { clientId, clientIp, clientMac, coinValue, coinCount = 1 } = req.body;
    
    console.log(`Adding ${coinCount} coins of ₱${coinValue} to slot ${slotNumber}`);
    
    // Verify slot is claimed by this client
    const slotResult = await pool.query(`
      SELECT id FROM coin_slots 
      WHERE slot_number = $1 
      AND status = 'claimed' 
      AND (claimed_by_ip = $2 OR claimed_by_mac = $3)
    `, [slotNumber, clientIp, clientMac]);
    
    if (slotResult.rows.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'Coin slot not claimed by this client'
      });
    }
    
    const slotId = slotResult.rows[0].id;
    const totalValue = parseFloat(coinValue) * parseInt(coinCount);
    
    // Add coin to queue
    const queueResult = await pool.query(`
      INSERT INTO coin_queues (
        slot_id, client_id, client_ip, client_mac, 
        coin_value, coin_count, total_value, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued')
      RETURNING *
    `, [slotId, clientId, clientIp, clientMac, coinValue, coinCount, totalValue]);
    
    // Get total queued amount for client
    const totalResult = await pool.query(`
      SELECT * FROM get_client_queued_total($1, $2)
    `, [clientIp, clientMac]);
    
    const queuedTotal = totalResult.rows[0];
    
    // Emit real-time update
    const { io } = require('../../app');
    io.emit('coin-added', {
      queue: queueResult.rows[0],
      total: queuedTotal,
      slotNumber,
      clientIp,
      clientMac
    });
    
    console.log(`Coin added successfully. Client total: ₱${queuedTotal.total_value}`);
    
    res.json({
      success: true,
      message: 'Coin added to queue successfully',
      queue: queueResult.rows[0],
      total: queuedTotal
    });
  } catch (error) {
    console.error('Add coin error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add coin to queue'
    });
  }
});

// Get client's queued coins
router.get('/queues/client', async (req, res) => {
  try {
    const { clientIp, clientMac } = req.query;
    
    if (!clientIp && !clientMac) {
      return res.status(400).json({
        success: false,
        error: 'Client IP or MAC address required'
      });
    }
    
    // Get queued coins for client
    const queueResult = await pool.query(`
      SELECT 
        cq.*,
        cs.slot_number
      FROM coin_queues cq
      JOIN coin_slots cs ON cq.slot_id = cs.id
      WHERE cq.status = 'queued'
      AND (cq.client_ip = $1 OR cq.client_mac = $2)
      ORDER BY cq.created_at
    `, [clientIp, clientMac]);
    
    // Get total
    const totalResult = await pool.query(`
      SELECT * FROM get_client_queued_total($1, $2)
    `, [clientIp, clientMac]);
    
    const total = totalResult.rows[0];
    
    res.json({
      success: true,
      queues: queueResult.rows,
      total: total
    });
  } catch (error) {
    console.error('Get client queues error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get client queues'
    });
  }
});

// Redeem all queued coins for client
router.post('/queues/redeem', async (req, res) => {
  try {
    const { clientId, clientIp, clientMac } = req.body;
    
    console.log(`Redeeming queued coins for client ${clientIp}`);
    
    // Update all queued coins to redeemed status
    const result = await pool.query(`
      UPDATE coin_queues 
      SET status = 'redeemed'
      WHERE status = 'queued'
      AND (client_ip = $1 OR client_mac = $2)
      RETURNING *
    `, [clientIp, clientMac]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No queued coins found for this client'
      });
    }
    
    // Calculate totals
    const totalCoins = result.rows.reduce((sum, queue) => sum + queue.coin_count, 0);
    const totalValue = result.rows.reduce((sum, queue) => sum + parseFloat(queue.total_value), 0);
    
    // Release any claimed slots by this client
    await pool.query(`
      UPDATE coin_slots 
      SET status = 'available',
          claimed_by_client_id = NULL,
          claimed_by_ip = NULL,
          claimed_by_mac = NULL,
          claimed_at = NULL,
          expires_at = NULL
      WHERE (claimed_by_ip = $1 OR claimed_by_mac = $2)
    `, [clientIp, clientMac]);
    
    // Emit real-time update
    const { io } = require('../../app');
    io.emit('coins-redeemed', {
      redeemedQueues: result.rows,
      totalCoins,
      totalValue,
      clientIp,
      clientMac
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

// Cleanup expired queues (admin function)
router.post('/cleanup', async (req, res) => {
  try {
    console.log('Cleaning up expired coin slots and queues');
    
    // Release expired slots
    const releasedSlots = await pool.query('SELECT release_expired_coin_slots()');
    
    // Expire old queues (older than 1 hour)
    const expiredQueues = await pool.query(`
      UPDATE coin_queues 
      SET status = 'expired'
      WHERE status = 'queued'
      AND created_at < NOW() - INTERVAL '1 hour'
      RETURNING id
    `);
    
    res.json({
      success: true,
      message: 'Cleanup completed',
      releasedSlots: releasedSlots.rows[0].release_expired_coin_slots,
      expiredQueues: expiredQueues.rows.length
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