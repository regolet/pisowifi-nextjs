const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://pisowifi_user:pisowifi123@localhost:5432/pisowifi'
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
    const { rateId, macAddress } = req.body;
    
    // Get rate details
    const rateResult = await pool.query('SELECT * FROM rates WHERE id = $1', [rateId]);
    if (rateResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid rate selected' });
    }
    
    const rate = rateResult.rows[0];
    
    res.json({
      success: true,
      message: `Please insert ${rate.coins_required} coin(s) for ${rate.name}`,
      rate: rate
    });
  } catch (error) {
    console.error('Connect error:', error);
    res.status(500).json({ error: 'Connection failed' });
  }
});

module.exports = router;