const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const jwt = require('jsonwebtoken');
const { exec } = require('child_process');
const { promisify } = require('util');
const db = require('../../db/sqlite-adapter');

const execAsync = promisify(exec);

// Settings file paths
const NETWORK_CONFIG_PATH = '/etc/dnsmasq.d/pisowifi.conf';
const NGINX_CONFIG_PATH = '/etc/nginx/sites-available/portal';
const SETTINGS_FILE = path.join(process.cwd(), 'config', 'settings.json');

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

// Get all settings
router.get('/', authenticateToken, async (req, res) => {
  try {
    // Load settings from file or create default
    let settings = {
      network: {
        gateway_ip: '192.168.100.1',
        dhcp_start: '192.168.100.10',
        dhcp_end: '192.168.100.100',
        lease_time: '12h',
        interface: 'enx00e04c68276e',
        dns_server: '8.8.8.8'
      },
      portal: {
        title: 'PISOWifi Portal',
        subtitle: 'Insert coins for internet access',
        logo_url: '/images/logo.png',
        background: 'gradient',
        primary_color: '#3B82F6',
        coin_slot_enabled: true,
        test_mode: true
      },
      gpio: {
        coin_pin: 3,
        coin_pin_mode: 'BCM',
        led_pin: 5,
        led_pin_mode: 'BCM',
        debounce_time: 200,
        pulse_width: 50
      },
      rates: [],
      system: {
        auto_restart: true,
        restart_time: '03:00',
        max_clients: 100,
        session_timeout: 7200,
        log_level: 'info'
      }
    };
    
    try {
      const fileContent = await fs.readFile(SETTINGS_FILE, 'utf-8');
      settings = { ...settings, ...JSON.parse(fileContent) };
    } catch (err) {
      // Settings file doesn't exist, use defaults
    }
    
    // Get rates from database
    const ratesResult = await db.query('SELECT * FROM rates ORDER BY duration');
    settings.rates = ratesResult.rows;
    
    res.json(settings);
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

// Update network settings
router.put('/network', authenticateToken, async (req, res) => {
  try {
    const { gateway_ip, dhcp_start, dhcp_end, lease_time, interface } = req.body;
    
    // Update dnsmasq configuration
    const dnsmasqConfig = `
interface=${interface}
dhcp-range=${dhcp_start},${dhcp_end},${lease_time}
dhcp-option=3,${gateway_ip}
dhcp-option=6,${gateway_ip}
address=/#/${gateway_ip}
domain-needed
bogus-priv
no-resolv
log-queries
log-dhcp
`;
    
    // Write config (requires sudo)
    await fs.writeFile('/tmp/pisowifi.conf', dnsmasqConfig);
    await execAsync('sudo cp /tmp/pisowifi.conf /etc/dnsmasq.d/pisowifi.conf');
    
    // Update nginx redirect
    const nginxConfig = `
server {
    listen 80;
    server_name _;
    
    location / {
        return 302 http://${gateway_ip}:3000/portal;
    }
    
    location = /generate_204 {
        return 302 http://${gateway_ip}:3000/portal;
    }
    
    location = /connecttest.txt {
        return 302 http://${gateway_ip}:3000/portal;
    }
}
`;
    
    await fs.writeFile('/tmp/nginx-portal', nginxConfig);
    await execAsync('sudo cp /tmp/nginx-portal /etc/nginx/sites-available/portal');
    
    // Restart services
    await execAsync('sudo systemctl restart dnsmasq');
    await execAsync('sudo systemctl restart nginx');
    
    // Save settings
    await saveSettings({ network: req.body });
    
    // Log action
    await db.query(
      'INSERT INTO system_logs (level, message, category, metadata) VALUES ($1, $2, $3, $4)',
      ['INFO', 'Network settings updated', 'admin', JSON.stringify({ admin: req.user.username, settings: req.body })]
    );
    
    res.json({ success: true, message: 'Network settings updated' });
  } catch (error) {
    console.error('Update network settings error:', error);
    res.status(500).json({ error: 'Failed to update network settings' });
  }
});

// Update portal settings
router.put('/portal', authenticateToken, async (req, res) => {
  try {
    const settings = req.body;
    
    // Save portal settings
    await saveSettings({ portal: settings });
    
    // Log action
    await db.query(
      'INSERT INTO system_logs (level, message, category, metadata) VALUES ($1, $2, $3, $4)',
      ['INFO', 'Portal settings updated', 'admin', JSON.stringify({ admin: req.user.username })]
    );
    
    res.json({ success: true, message: 'Portal settings updated' });
  } catch (error) {
    console.error('Update portal settings error:', error);
    res.status(500).json({ error: 'Failed to update portal settings' });
  }
});

// Update GPIO settings
router.put('/gpio', authenticateToken, async (req, res) => {
  try {
    const settings = req.body;
    
    // Save GPIO settings
    await saveSettings({ gpio: settings });
    
    // Restart GPIO service with new settings
    try {
      await execAsync('pm2 restart pisowifi-gpio');
    } catch (err) {
      console.error('Failed to restart GPIO service:', err);
    }
    
    // Log action
    await db.query(
      'INSERT INTO system_logs (level, message, category, metadata) VALUES ($1, $2, $3, $4)',
      ['INFO', 'GPIO settings updated', 'admin', JSON.stringify({ admin: req.user.username, settings })]
    );
    
    res.json({ success: true, message: 'GPIO settings updated' });
  } catch (error) {
    console.error('Update GPIO settings error:', error);
    res.status(500).json({ error: 'Failed to update GPIO settings' });
  }
});

// Update rates
router.put('/rates', authenticateToken, async (req, res) => {
  try {
    const { rates, coinSettings } = req.body;
    
    // Clear existing rates if we're doing a full replacement
    await db.query('DELETE FROM rates WHERE 1=1');
    
    // Insert all rates
    for (const rate of rates) {
      await db.query(
        'INSERT INTO rates (name, duration, coins_required, price, is_active) VALUES ($1, $2, $3, $4, $5)',
        [rate.name, rate.duration, rate.coins_required, rate.price, rate.is_active]
      );
    }
    
    // Save coin settings if provided
    if (coinSettings) {
      await saveSettings({ coin: coinSettings });
    }
    
    // Log action
    await db.query(
      'INSERT INTO system_logs (level, message, category, metadata) VALUES ($1, $2, $3, $4)',
      ['INFO', 'Rate packages updated', 'admin', JSON.stringify({ admin: req.user.username, rateCount: rates.length })]
    );
    
    res.json({ success: true, message: 'Rates updated' });
  } catch (error) {
    console.error('Update rates error:', error);
    res.status(500).json({ error: 'Failed to update rates' });
  }
});

// Update coin settings
router.put('/coin', authenticateToken, async (req, res) => {
  try {
    const coinSettings = req.body;
    
    // Validate coin settings
    if (coinSettings.coin_value < 0.01 || coinSettings.coin_value > 1000) {
      return res.status(400).json({ error: 'Invalid coin value' });
    }
    
    if (coinSettings.pulses_per_coin < 1 || coinSettings.pulses_per_coin > 10) {
      return res.status(400).json({ error: 'Invalid pulse count' });
    }
    
    if (coinSettings.pulse_duration < 10 || coinSettings.pulse_duration > 2000) {
      return res.status(400).json({ error: 'Invalid pulse duration' });
    }
    
    // Save coin settings
    await saveSettings({ coin: coinSettings });
    
    // Log action
    await db.query(
      'INSERT INTO system_logs (level, message, category, metadata) VALUES ($1, $2, $3, $4)',
      ['INFO', 'Coin settings updated', 'admin', JSON.stringify({ admin: req.user.username, settings: coinSettings })]
    );
    
    res.json({ success: true, message: 'Coin settings updated' });
  } catch (error) {
    console.error('Update coin settings error:', error);
    res.status(500).json({ error: 'Failed to update coin settings' });
  }
});

// Test GPIO coin detection
router.post('/gpio/test-coin', authenticateToken, async (req, res) => {
  try {
    // Trigger test coin event
    const response = await fetch('http://localhost:3001/test-coin', {
      method: 'POST'
    });
    
    const result = await response.json();
    
    res.json({ success: true, message: 'Test coin triggered', result });
  } catch (error) {
    console.error('Test coin error:', error);
    res.status(500).json({ error: 'Failed to trigger test coin' });
  }
});

// Helper function to save settings
async function saveSettings(updates) {
  try {
    // Ensure config directory exists
    await fs.mkdir(path.join(process.cwd(), 'config'), { recursive: true });
    
    // Read existing settings
    let settings = {};
    try {
      const fileContent = await fs.readFile(SETTINGS_FILE, 'utf-8');
      settings = JSON.parse(fileContent);
    } catch (err) {
      // File doesn't exist
    }
    
    // Merge updates
    settings = { ...settings, ...updates };
    
    // Save to file
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch (error) {
    console.error('Save settings error:', error);
    throw error;
  }
}

module.exports = router;