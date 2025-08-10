const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://pisowifi_user:admin123@localhost:5432/pisowifi'
});

// Multer configuration for banner uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../../public/uploads/banners');
    // Create directory if it doesn't exist
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'banner-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 2 * 1024 * 1024 // 2MB limit
  },
  fileFilter: function (req, file, cb) {
    // Check file type
    const allowedTypes = /jpeg|jpg|png|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, and WebP images are allowed'));
    }
  }
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

// Banner Upload
router.post('/upload-banner', authenticateToken, upload.single('bannerImage'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }
    
    const filename = req.file.filename;
    const filepath = `/uploads/banners/${filename}`;
    const originalName = req.file.originalname;
    
    // TODO: Save banner info to database if you want to store banner metadata
    // For now, just return the file path
    
    res.json({
      success: true,
      message: 'Banner uploaded successfully',
      filename: filename,
      filepath: filepath,
      originalName: originalName
    });
    
  } catch (error) {
    console.error('Banner upload error:', error);
    res.status(500).json({ success: false, error: 'Upload failed' });
  }
});

// Get Banners
router.get('/banners', authenticateToken, (req, res) => {
  try {
    const bannerDir = path.join(__dirname, '../../public/uploads/banners');
    
    // Check if directory exists
    if (!fs.existsSync(bannerDir)) {
      return res.json({ success: true, banners: [] });
    }
    
    // Read banner files
    const files = fs.readdirSync(bannerDir);
    const banners = files
      .filter(file => /\.(jpg|jpeg|png|webp)$/i.test(file))
      .map(file => ({
        filename: file,
        filepath: `/uploads/banners/${file}`,
        size: fs.statSync(path.join(bannerDir, file)).size,
        created: fs.statSync(path.join(bannerDir, file)).mtime
      }));
    
    res.json({ success: true, banners });
  } catch (error) {
    console.error('Get banners error:', error);
    res.status(500).json({ success: false, error: 'Failed to get banners' });
  }
});

// Delete Banner
router.delete('/banners/:filename', authenticateToken, (req, res) => {
  try {
    const filename = req.params.filename;
    const filepath = path.join(__dirname, '../../public/uploads/banners', filename);
    
    // Check if file exists
    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ success: false, error: 'Banner not found' });
    }
    
    // Delete file
    fs.unlinkSync(filepath);
    
    res.json({ success: true, message: 'Banner deleted successfully' });
  } catch (error) {
    console.error('Delete banner error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete banner' });
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