const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const db = require('../../db/sqlite-adapter');
const { authenticateAPI, apiLimiter } = require('../../middleware/security');
const { isValidIPv4, isValidInterfaceName } = require('../../utils/validators');

const execAsync = promisify(exec);

// Settings file paths
const NETWORK_CONFIG_PATH = '/etc/dnsmasq.d/pisowifi.conf';
const NGINX_CONFIG_PATH = '/etc/nginx/sites-available/portal';
const SETTINGS_FILE = path.join(process.cwd(), 'config', 'settings.json');

// Use centralized auth middleware
const authenticateToken = authenticateAPI;

// Get all settings
router.get('/', authenticateToken, async (req, res) => {
  try {
    // Get all settings from database
    const [networkResult, portalResult, gpioResult, systemResult, ratesResult] = await Promise.all([
      db.query('SELECT * FROM network_settings WHERE id = 1'),
      db.query('SELECT * FROM portal_settings WHERE id = 1'),
      db.query('SELECT * FROM gpio_settings WHERE id = 1'),
      db.query('SELECT * FROM system_settings WHERE id = 1'),
      db.query('SELECT * FROM rates ORDER BY duration')
    ]);

    const settings = {
      network: networkResult.rows[0] || {
        gateway_ip: '10.0.0.1',
        dhcp_start: '10.0.0.10',
        dhcp_end: '10.0.0.100',
        lease_time: '12h',
        interface: 'enx00e04c68276e',
        dns_server: '8.8.8.8'
      },
      portal: portalResult.rows[0] || {
        portal_title: 'PISOWifi Portal',
        portal_subtitle: 'Insert coins for internet access',
        coin_timeout: 300
      },
      gpio: gpioResult.rows[0] || {
        coin_pin: 3,
        coin_pin_mode: 'BCM',
        led_pin: 5,
        led_pin_mode: 'BCM',
        debounce_time: 200,
        pulse_width: 50,
        coin_value: 5.00,
        pulses_per_coin: 1,
        pulse_duration: 100
      },
      system: systemResult.rows[0] || {
        auto_restart: true,
        restart_time: '03:00',
        max_clients: 100,
        session_timeout: 7200,
        log_level: 'info'
      },
      rates: ratesResult.rows
    };

    res.json(settings);
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

// Update network settings
router.put('/network', authenticateToken, async (req, res) => {
  try {
    const { gateway_ip, dhcp_start, dhcp_end, lease_time, interface: iface } = req.body;

    // SECURITY: Validate all inputs before using in config
    if (!isValidIPv4(gateway_ip)) {
      return res.status(400).json({ error: 'Invalid gateway IP address' });
    }
    if (!isValidIPv4(dhcp_start)) {
      return res.status(400).json({ error: 'Invalid DHCP start IP address' });
    }
    if (!isValidIPv4(dhcp_end)) {
      return res.status(400).json({ error: 'Invalid DHCP end IP address' });
    }
    if (!isValidInterfaceName(iface)) {
      return res.status(400).json({ error: 'Invalid network interface name' });
    }

    // Update dnsmasq configuration
    const dnsmasqConfig = `
interface=${iface}
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

    // Save settings to database
    await db.query(`
      INSERT OR REPLACE INTO network_settings (id, gateway_ip, dhcp_start, dhcp_end, lease_time, interface, dns_server, updated_at) 
      VALUES (1, $1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
    `, [gateway_ip, dhcp_start, dhcp_end, lease_time, interface, req.body.dns_server || '8.8.8.8']);

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
    const { portal_title, portal_subtitle, coin_timeout } = req.body;

    // Save portal settings to database (reuse existing portal_settings table)
    await db.query(`
      INSERT OR REPLACE INTO portal_settings (id, portal_title, portal_subtitle, coin_timeout, updated_at) 
      VALUES (1, $1, $2, $3, CURRENT_TIMESTAMP)
    `, [portal_title || 'PISOWifi Portal', portal_subtitle || 'Insert coins for internet access', coin_timeout || 300]);

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
    const { coin_pin, coin_pin_mode, led_pin, led_pin_mode, debounce_time, pulse_width, coin_value, pulses_per_coin, pulse_duration } = req.body;

    // Save GPIO settings to database
    await db.query(`
      INSERT OR REPLACE INTO gpio_settings 
      (id, coin_pin, coin_pin_mode, led_pin, led_pin_mode, debounce_time, pulse_width, coin_value, pulses_per_coin, pulse_duration, updated_at) 
      VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
    `, [coin_pin, coin_pin_mode || 'BCM', led_pin, led_pin_mode || 'BCM', debounce_time, pulse_width, coin_value, pulses_per_coin, pulse_duration]);

    // Restart GPIO service with new settings
    try {
      await execAsync('pm2 restart pisowifi-gpio');
    } catch (err) {
      console.error('Failed to restart GPIO service:', err);
    }

    // Log action
    await db.query(
      'INSERT INTO system_logs (level, message, category, metadata) VALUES ($1, $2, $3, $4)',
      ['INFO', 'GPIO settings updated', 'admin', JSON.stringify({ admin: req.user.username, settings: req.body })]
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
    const { rates } = req.body;

    if (!rates || !Array.isArray(rates)) {
      return res.status(400).json({ error: 'Invalid rates data' });
    }

    // Clear existing rates if we're doing a full replacement
    await db.query('DELETE FROM rates');

    // Insert all rates
    for (const rate of rates) {
      try {
        await db.query(
          'INSERT INTO rates (name, duration, coins_required, price, is_active) VALUES (?, ?, ?, ?, ?)',
          [rate.name, rate.duration, rate.coins_required, parseFloat(rate.price), rate.is_active ? 1 : 0]
        );
      } catch (rateError) {
        console.error('Error inserting rate:', rate, rateError);
        throw new Error(`Failed to insert rate '${rate.name}': ${rateError.message}`);
      }
    }

    // Log action
    try {
      await db.query(
        'INSERT INTO system_logs (level, message, category, metadata) VALUES (?, ?, ?, ?)',
        ['INFO', 'Rate packages updated', 'admin', JSON.stringify({ admin: req.user.username, rateCount: rates.length })]
      );
    } catch (logError) {
      console.error('Warning: Could not log rate update:', logError);
      // Continue anyway
    }

    res.json({ success: true, message: 'Rates updated' });
  } catch (error) {
    console.error('Update rates error:', error);
    res.status(500).json({ error: error.message || 'Failed to update rates' });
  }
});

// Add system settings route
router.put('/system', authenticateToken, async (req, res) => {
  try {
    const { auto_restart, restart_time, max_clients, session_timeout, log_level } = req.body;

    // Save system settings to database
    await db.query(`
      INSERT OR REPLACE INTO system_settings 
      (id, auto_restart, restart_time, max_clients, session_timeout, log_level, updated_at) 
      VALUES (1, $1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
    `, [auto_restart ? 1 : 0, restart_time || '03:00', max_clients || 100, session_timeout || 7200, log_level || 'info']);

    // Log action
    await db.query(
      'INSERT INTO system_logs (level, message, category, metadata) VALUES ($1, $2, $3, $4)',
      ['INFO', 'System settings updated', 'admin', JSON.stringify({ admin: req.user.username, settings: req.body })]
    );

    res.json({ success: true, message: 'System settings updated' });
  } catch (error) {
    console.error('Update system settings error:', error);
    res.status(500).json({ error: 'Failed to update system settings' });
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

// All settings are now stored in SQLite database tables:
// - network_settings: DHCP, DNS, network configuration
// - portal_settings: Portal title, subtitle, coin timeout
// - gpio_settings: GPIO pins, coin detection settings
// - system_settings: System-wide configuration
// - rates: Coin rates and pricing

module.exports = router;