const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://pisowifi_user:admin123@localhost:5432/pisowifi'
});

// Auth middleware
const authenticateToken = (req, res, next) => {
  const token = req.cookies['auth-token'];
  
  if (!token) {
    return res.redirect('/admin/login');
  }
  
  jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
    if (err) {
      return res.redirect('/admin/login');
    }
    req.user = user;
    next();
  });
};

// Login page
router.get('/login', (req, res) => {
  res.render('admin-login', { title: 'Admin Login', error: null });
});

// Login POST
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Find user
    const result = await pool.query('SELECT * FROM users WHERE username = $1 OR email = $1', [username]);
    if (result.rows.length === 0) {
      return res.render('admin-login', { title: 'Admin Login', error: 'Invalid credentials' });
    }
    
    const user = result.rows[0];
    
    // Check password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.render('admin-login', { title: 'Admin Login', error: 'Invalid credentials' });
    }
    
    // Create JWT token
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );
    
    // Set cookie and redirect
    res.cookie('auth-token', token, {
      httpOnly: true,
      secure: false,  // Always allow HTTP for local PISOWifi network
      maxAge: 24 * 60 * 60 * 1000
    });
    
    res.redirect('/admin');
  } catch (error) {
    console.error('Login error:', error);
    res.render('admin-login', { title: 'Admin Login', error: 'Login failed' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  res.clearCookie('auth-token');
  res.redirect('/admin/login');
});

// Dashboard (protected)
router.get('/', authenticateToken, async (req, res) => {
  try {
    // Get dashboard stats
    const clientsResult = await pool.query('SELECT COUNT(*) as count FROM clients');
    const sessionsResult = await pool.query('SELECT COUNT(*) as count FROM sessions WHERE status = $1', ['ACTIVE']);
    const revenueResult = await pool.query('SELECT SUM(amount) as total FROM transactions WHERE DATE(created_at) = CURRENT_DATE');
    
    const stats = {
      totalClients: clientsResult.rows[0].count,
      activeSessions: sessionsResult.rows[0].count,
      todayRevenue: revenueResult.rows[0].total || 0
    };
    
    res.render('admin-dashboard', { 
      title: 'Admin Dashboard',
      user: req.user,
      stats: stats,
      currentPage: 'dashboard'
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).render('error', { error: 'Dashboard load failed' });
  }
});

// Client Management
router.get('/clients', authenticateToken, (req, res) => {
  res.render('admin-clients', { 
    title: 'Client Management',
    user: req.user,
    currentPage: 'clients'
  });
});

// Network Settings
router.get('/network', authenticateToken, (req, res) => {
  res.render('admin-network', { 
    title: 'Network Settings',
    user: req.user,
    currentPage: 'network'
  });
});

// GPIO Settings
router.get('/gpio', authenticateToken, (req, res) => {
  res.render('admin-gpio', { 
    title: 'GPIO Settings',
    user: req.user,
    currentPage: 'gpio'
  });
});

// Portal Settings
router.get('/portal-settings', authenticateToken, async (req, res) => {
  try {
    // Get current portal settings from database
    const settingsResult = await pool.query('SELECT * FROM portal_settings LIMIT 1');
    const settings = settingsResult.rows[0] || {
      coin_timeout: 60,
      portal_title: 'PISOWifi Portal',
      portal_subtitle: 'Insert coins for internet access'
    };
    
    res.render('admin-portal-settings', { 
      title: 'Portal Settings',
      user: req.user,
      currentPage: 'portal-settings',
      settings: settings
    });
  } catch (error) {
    console.error('Portal settings error:', error);
    res.status(500).render('error', { error: 'Failed to load portal settings' });
  }
});

// Update Portal Settings
router.post('/portal-settings', authenticateToken, async (req, res) => {
  try {
    const { coin_timeout, portal_title, portal_subtitle } = req.body;
    
    // Create or update portal settings
    await pool.query(`
      INSERT INTO portal_settings (coin_timeout, portal_title, portal_subtitle, updated_at)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE SET
        coin_timeout = EXCLUDED.coin_timeout,
        portal_title = EXCLUDED.portal_title,
        portal_subtitle = EXCLUDED.portal_subtitle,
        updated_at = CURRENT_TIMESTAMP
    `, [coin_timeout, portal_title, portal_subtitle]);
    
    res.redirect('/admin/portal-settings?updated=true');
  } catch (error) {
    console.error('Portal settings update error:', error);
    res.redirect('/admin/portal-settings?error=true');
  }
});

// Coin Rates
router.get('/rates', authenticateToken, (req, res) => {
  res.render('admin-rates', { 
    title: 'Coin Rates Management',
    user: req.user,
    currentPage: 'rates'
  });
});

// Reports
router.get('/reports', authenticateToken, (req, res) => {
  res.render('admin-reports', { 
    title: 'Reports & Analytics',
    user: req.user,
    currentPage: 'reports'
  });
});

// Simple bypass for Orange Pi (temporary fix)
router.get('/bypass', (req, res) => {
  const token = jwt.sign(
    { userId: 1, username: 'admin', role: 'admin' }, 
    process.env.JWT_SECRET || 'your-secret-key',
    { expiresIn: '24h' }
  );
  res.cookie('auth-token', token, { 
    httpOnly: true, 
    secure: false, // Set to false for HTTP
    maxAge: 24 * 60 * 60 * 1000
  });
  res.redirect('/admin');
});

module.exports = router;