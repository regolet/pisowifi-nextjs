const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db/sqlite-adapter');
const {
  getJWTSecret,
  authenticateAdmin,
  loginLimiter,
  getSecureCookieOptions,
  getAdminCookieOptions
} = require('../middleware/security');
const { isValidUsername, sanitizeForLogging } = require('../utils/validators');

// Use centralized auth middleware
const authenticateToken = authenticateAdmin;

// Storage for portal media uploads
const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const safeName = file.fieldname + '-' + Date.now() + ext;
    cb(null, safeName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'banner_image') {
      // Allow common image types
      return (/image\/(png|jpe?g|gif|webp)$/i).test(file.mimetype) ? cb(null, true) : cb(new Error('Invalid image type'));
    }
    if (file.fieldname.endsWith('_audio')) {
      // Allow common audio types
      return (/audio\/(mpeg|mp3|wav|ogg)$/i).test(file.mimetype) ? cb(null, true) : cb(new Error('Invalid audio type'));
    }
    cb(new Error('Unsupported file field'));
  }
});

// Login page
router.get('/login', (req, res) => {
  res.render('admin-login', { 
    title: 'Admin Login', 
    error: null,
    message: req.query.message || null
  });
});

// Login POST - with rate limiting
router.post('/login', loginLimiter.middleware(), async (req, res) => {
  try {
    const { username, password } = req.body;

    // Input validation
    if (!username || !password) {
      return res.render('admin-login', { title: 'Admin Login', error: 'Username and password required' });
    }

    // Log login attempt (sanitized)
    console.log(`Login attempt for user: ${sanitizeForLogging(username)}`);

    // Find user
    const result = await db.query('SELECT * FROM users WHERE username = $1 OR email = $1', [username]);
    if (result.rows.length === 0) {
      return res.render('admin-login', { title: 'Admin Login', error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    // Check password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.render('admin-login', { title: 'Admin Login', error: 'Invalid credentials' });
    }

    // Create JWT token with secure secret
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      getJWTSecret(),
      { expiresIn: '2h' } // Reduced from 24h for security
    );

    // Set cookie with secure options
    res.cookie('auth-token', token, getSecureCookieOptions());

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
    const clientsResult = await db.query('SELECT COUNT(*) as count FROM clients');
    const sessionsResult = await db.query('SELECT COUNT(*) as count FROM sessions WHERE status = $1', ['ACTIVE']);
    const revenueResult = await db.query('SELECT SUM(amount) as total FROM transactions WHERE date(created_at) = date()');

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

// Sales History / Transactions
router.get('/transactions', authenticateToken, (req, res) => {
  res.render('admin-transactions', {
    title: 'Sales History',
    user: req.user,
    currentPage: 'transactions'
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
    const settingsResult = await db.query('SELECT * FROM portal_settings LIMIT 1');
    const settings = settingsResult.rows[0] || {
      coin_timeout: 60,
      portal_title: 'PISOWifi Portal',
      portal_subtitle: 'Insert coins for internet access',
      banner_image_url: '',
      coin_insert_audio_url: '',
      coin_success_audio_url: '',
      coin_background_audio_url: ''
    };

    res.render('admin-portal-settings', {
      title: 'Portal Settings',
      user: req.user,
      currentPage: 'portal-settings',
      settings: settings,
      query: req.query
    });
  } catch (error) {
    console.error('Portal settings error:', error);
    res.status(500).render('error', { error: 'Failed to load portal settings' });
  }
});

// Update Portal Settings
router.post('/portal-settings', authenticateToken, upload.fields([
  { name: 'banner_image', maxCount: 1 },
  { name: 'coin_insert_audio', maxCount: 1 },
  { name: 'coin_success_audio', maxCount: 1 },
  { name: 'coin_background_audio', maxCount: 1 }
]), async (req, res) => {
  try {
    const { 
      coin_timeout, portal_title, portal_subtitle, reset_password, 
      auto_pause_on_disconnect, coin_abuse_protection, 
      coin_attempt_limit, coin_attempt_window, coin_block_duration 
    } = req.body;
    let bannerUrl = req.body.banner_image_url;
    let coinInsertAudio = req.body.coin_insert_audio_url;
    let coinSuccessAudio = req.body.coin_success_audio_url;
    let coinBgAudio = req.body.coin_background_audio_url;

    // Handle uploaded files
    if (req.files) {
      if (req.files['banner_image'] && req.files['banner_image'][0]) {
        bannerUrl = '/uploads/' + path.basename(req.files['banner_image'][0].path);
      }
      if (req.files['coin_insert_audio'] && req.files['coin_insert_audio'][0]) {
        coinInsertAudio = '/uploads/' + path.basename(req.files['coin_insert_audio'][0].path);
      }
      if (req.files['coin_success_audio'] && req.files['coin_success_audio'][0]) {
        coinSuccessAudio = '/uploads/' + path.basename(req.files['coin_success_audio'][0].path);
      }
      if (req.files['coin_background_audio'] && req.files['coin_background_audio'][0]) {
        coinBgAudio = '/uploads/' + path.basename(req.files['coin_background_audio'][0].path);
      }
    }

    // Convert checkboxes to boolean (checkbox value is '1' if checked, undefined if not)
    const autoPause = auto_pause_on_disconnect === '1' ? 1 : 0;
    const abuseProtection = coin_abuse_protection === '1' ? 1 : 0;

    // Create or update portal settings
    await db.query(`
      INSERT OR REPLACE INTO portal_settings (
        id, coin_timeout, portal_title, portal_subtitle,
        banner_image_url, coin_insert_audio_url, coin_success_audio_url, coin_background_audio_url,
        auto_pause_on_disconnect, coin_abuse_protection, coin_attempt_limit, coin_attempt_window, coin_block_duration,
        updated_at)
      VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)
    `, [
      coin_timeout, portal_title, portal_subtitle, 
      bannerUrl, coinInsertAudio, coinSuccessAudio, coinBgAudio, 
      autoPause, abuseProtection, 
      coin_attempt_limit || 10, coin_attempt_window || 60, coin_block_duration || 300
    ]);

    res.redirect('/admin/portal-settings?updated=true');
  } catch (error) {
    console.error('Portal settings update error:', error);
    res.redirect('/admin/portal-settings?error=true');
  }
});




// Coin Slots & Queues
router.get('/coin-slots', authenticateToken, (req, res) => {
  res.render('admin-coin-slots', {
    title: 'Coin Slots & Queues',
    user: req.user,
    currentPage: 'coin-slots'
  });
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

// Device Information
router.get('/device', authenticateToken, (req, res) => {
  res.render('admin-device', {
    title: 'Device Information',
    user: req.user,
    currentPage: 'device'
  });
});

// Admin Settings Page
router.get('/settings', authenticateToken, async (req, res) => {
  try {
    const settingsResult = await db.query('SELECT * FROM portal_settings WHERE id = 1');
    const settings = settingsResult.rows.length > 0 ? settingsResult.rows[0] : {};
    
    res.render('admin-settings', {
      title: 'Settings',
      user: req.user,
      currentPage: 'settings',
      settings: settings,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (error) {
    console.error('Settings page error:', error);
    res.render('admin-settings', {
      title: 'Settings',
      user: req.user,
      currentPage: 'settings',
      settings: {},
      error: 'Failed to load settings'
    });
  }
});

// Admin Settings - Change Password & Update Portal Settings
router.post('/settings', authenticateToken, async (req, res) => {
  try {
    const { 
      current_password, new_password, confirm_password,
      auto_pause_on_disconnect, coin_abuse_protection,
      coin_attempt_limit, coin_attempt_window, coin_block_duration
    } = req.body;
    
    let isPasswordChange = current_password || new_password || confirm_password;
    let isSettingsChange = auto_pause_on_disconnect !== undefined || coin_abuse_protection !== undefined;

    // If no changes made
    if (!isPasswordChange && !isSettingsChange) {
      const settingsResult = await db.query('SELECT * FROM portal_settings WHERE id = 1');
      const settings = settingsResult.rows.length > 0 ? settingsResult.rows[0] : {};
      return res.render('admin-settings', {
        title: 'Settings',
        user: req.user,
        currentPage: 'settings',
        settings: settings,
        error: 'No changes made'
      });
    }

    // Handle password change if fields are provided
    if (isPasswordChange) {
      // Validate all password fields are filled if changing password
      if (!current_password || !new_password || !confirm_password) {
        const settingsResult = await db.query('SELECT * FROM portal_settings WHERE id = 1');
        const settings = settingsResult.rows.length > 0 ? settingsResult.rows[0] : {};
        return res.render('admin-settings', {
          title: 'Settings',
          user: req.user,
          currentPage: 'settings',
          settings: settings,
          error: 'All password fields are required'
        });
      }

      // Validate password length
      if (new_password.length < 6) {
        const settingsResult = await db.query('SELECT * FROM portal_settings WHERE id = 1');
        const settings = settingsResult.rows.length > 0 ? settingsResult.rows[0] : {};
        return res.render('admin-settings', {
          title: 'Settings',
          user: req.user,
          currentPage: 'settings',
          settings: settings,
          error: 'New password must be at least 6 characters'
        });
      }

      // Validate passwords match
      if (new_password !== confirm_password) {
        const settingsResult = await db.query('SELECT * FROM portal_settings WHERE id = 1');
        const settings = settingsResult.rows.length > 0 ? settingsResult.rows[0] : {};
        return res.render('admin-settings', {
          title: 'Settings',
          user: req.user,
          currentPage: 'settings',
          settings: settings,
          error: 'New passwords do not match'
        });
      }

      // Get current user from database
      const userResult = await db.query('SELECT * FROM users WHERE id = $1', [req.user.userId]);
      if (userResult.rows.length === 0) {
        return res.render('admin-settings', {
          title: 'Settings',
          user: req.user,
          currentPage: 'settings',
          settings: {},
          error: 'User not found'
        });
      }

      const dbUser = userResult.rows[0];

      // Verify current password
      const validPassword = await bcrypt.compare(current_password, dbUser.password);
      if (!validPassword) {
        const settingsResult = await db.query('SELECT * FROM portal_settings WHERE id = 1');
        const settings = settingsResult.rows.length > 0 ? settingsResult.rows[0] : {};
        return res.render('admin-settings', {
          title: 'Settings',
          user: req.user,
          currentPage: 'settings',
          settings: settings,
          error: 'Current password is incorrect'
        });
      }

      // Hash new password and update
      const hashedPassword = await bcrypt.hash(new_password, 10);
      await db.query('UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', 
        [hashedPassword, req.user.userId]);

      console.log(`Password changed for user: ${req.user.username}`);

      // Clear auth cookie and redirect to login
      res.clearCookie('auth-token');
      return res.redirect('/admin/login?message=Password changed successfully. Please log in with your new password.');
    }

    // Handle portal settings update (auto-pause and coin abuse)
    if (isSettingsChange) {
      const autoPause = auto_pause_on_disconnect === '1' ? 1 : 0;
      const abuseProtection = coin_abuse_protection === '1' ? 1 : 0;

      await db.query(`
        INSERT OR REPLACE INTO portal_settings (
          id, auto_pause_on_disconnect, coin_abuse_protection, 
          coin_attempt_limit, coin_attempt_window, coin_block_duration,
          updated_at)
        VALUES (1, $1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
      `, [
        autoPause, abuseProtection,
        coin_attempt_limit || 10, coin_attempt_window || 60, coin_block_duration || 300
      ]);

      return res.redirect('/admin/settings?success=Settings updated successfully');
    }

  } catch (error) {
    console.error('Settings update error:', error);
    const settingsResult = await db.query('SELECT * FROM portal_settings WHERE id = 1');
    const settings = settingsResult.rows.length > 0 ? settingsResult.rows[0] : {};
    res.render('admin-settings', {
      title: 'Settings',
      user: req.user,
      currentPage: 'settings',
      settings: settings,
      error: 'Failed to update settings'
    });
  }
});

module.exports = router;