const express = require('express');
const router = express.Router();
const db = require('../../db/sqlite-adapter');
const { authenticateAPI } = require('../../middleware/security');

// Get all adjustments
router.get('/', authenticateAPI, async (req, res) => {
  try {
    console.log('🔍 Fetching sensor adjustments from database...');
    const result = await db.query('SELECT * FROM coin_sensor_adjustments ORDER BY pulse_count ASC');
    console.log('✅ Sensor adjustments fetched successfully:', result);
    res.json({ success: true, data: result.rows || [] });
  } catch (error) {
    console.error('❌ Failed to fetch sensor adjustments:', error);
    console.error('Error details:', error.message, error.stack);
    res.status(500).json({ success: false, error: error.message || 'Database error' });
  }
});

// Add new adjustment
router.post('/', authenticateAPI, async (req, res) => {
  const { pulse_count, actual_value, note } = req.body;
  
  if (!pulse_count || !actual_value) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }

  try {
    await db.query(`
      INSERT INTO coin_sensor_adjustments (pulse_count, actual_value, note)
      VALUES ($1, $2, $3)
    `, [parseInt(pulse_count), parseFloat(actual_value), note || 'User defined']);
    
    // Notify GPIO bridge to reload (if possible, or it'll poll)
    // For now we just save to DB.
    
    res.json({ success: true, message: 'Adjustment added successfully' });
  } catch (error) {
    if (error.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ success: false, error: 'Adjustment for this pulse count already exists' });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update adjustment
router.put('/:id', authenticateAPI, async (req, res) => {
  const { id } = req.params;
  const { pulse_count, actual_value, note, is_active } = req.body;
  
  try {
    await db.query(`
      UPDATE coin_sensor_adjustments 
      SET pulse_count = $1, actual_value = $2, note = $3, is_active = $4
      WHERE id = $5
    `, [pulse_count, actual_value, note, is_active ? 1 : 0, id]);
    
    res.json({ success: true, message: 'Adjustment updated successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete adjustment
router.delete('/:id', authenticateAPI, async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM coin_sensor_adjustments WHERE id = $1', [id]);
    res.json({ success: true, message: 'Adjustment deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
