const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://pisowifi_user:pisowifi123@localhost:5432/pisowifi'
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
      secure: process.env.NODE_ENV === 'production',
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
      stats: stats
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
    user: req.user
  });
});

// Network Settings
router.get('/network', authenticateToken, (req, res) => {
  res.render('admin-network', { 
    title: 'Network Settings',
    user: req.user
  });
});

// GPIO Settings
router.get('/gpio', authenticateToken, (req, res) => {
  res.render('admin-gpio', { 
    title: 'GPIO Settings',
    user: req.user
  });
});

// Portal Settings
router.get('/portal', authenticateToken, (req, res) => {
  res.render('admin-portal', { 
    title: 'Portal Settings',
    user: req.user
  });
});

// Reports
router.get('/reports', authenticateToken, (req, res) => {
  res.render('admin-reports', { 
    title: 'Reports & Analytics',
    user: req.user
  });
});

module.exports = router;