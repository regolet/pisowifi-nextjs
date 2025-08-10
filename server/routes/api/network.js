const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { exec } = require('child_process');
const { promisify } = require('util');
const jwt = require('jsonwebtoken');
const fs = require('fs').promises;

const execAsync = promisify(exec);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://pisowifi_user:admin123@localhost:5432/pisowifi'
});

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

// Get network configuration
router.get('/config', authenticateToken, async (req, res) => {
  try {
    // Get network configuration from database
    const result = await pool.query(
      'SELECT * FROM network_config WHERE id = 1'
    );
    
    let config = {};
    if (result.rows.length > 0) {
      config = result.rows[0];
    } else {
      // Default configuration
      config = {
        dhcp_enabled: true,
        dhcp_range_start: '192.168.100.10',
        dhcp_range_end: '192.168.100.200',
        subnet_mask: '255.255.255.0',
        gateway: '192.168.100.1',
        dns_primary: '8.8.8.8',
        dns_secondary: '8.8.4.4',
        lease_time: 3600,
        wifi_interface: 'wlan0',
        ethernet_interface: 'eth0'
      };
    }
    
    res.json(config);
  } catch (error) {
    console.error('Get network config error:', error);
    res.status(500).json({ error: 'Failed to get network configuration' });
  }
});

// Update network configuration
router.put('/config', authenticateToken, async (req, res) => {
  try {
    const {
      dhcp_enabled,
      dhcp_range_start,
      dhcp_range_end,
      subnet_mask,
      gateway,
      dns_primary,
      dns_secondary,
      lease_time,
      wifi_interface,
      ethernet_interface
    } = req.body;
    
    // Update database
    await pool.query(
      `INSERT INTO network_config (
        id, dhcp_enabled, dhcp_range_start, dhcp_range_end, 
        subnet_mask, gateway, dns_primary, dns_secondary, 
        lease_time, wifi_interface, ethernet_interface, updated_at
      ) VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE SET
        dhcp_enabled = EXCLUDED.dhcp_enabled,
        dhcp_range_start = EXCLUDED.dhcp_range_start,
        dhcp_range_end = EXCLUDED.dhcp_range_end,
        subnet_mask = EXCLUDED.subnet_mask,
        gateway = EXCLUDED.gateway,
        dns_primary = EXCLUDED.dns_primary,
        dns_secondary = EXCLUDED.dns_secondary,
        lease_time = EXCLUDED.lease_time,
        wifi_interface = EXCLUDED.wifi_interface,
        ethernet_interface = EXCLUDED.ethernet_interface,
        updated_at = CURRENT_TIMESTAMP`,
      [
        dhcp_enabled, dhcp_range_start, dhcp_range_end,
        subnet_mask, gateway, dns_primary, dns_secondary,
        lease_time, wifi_interface, ethernet_interface
      ]
    );
    
    // Apply configuration
    await applyNetworkConfig({
      dhcp_enabled,
      dhcp_range_start,
      dhcp_range_end,
      subnet_mask,
      gateway,
      dns_primary,
      dns_secondary,
      lease_time,
      wifi_interface,
      ethernet_interface
    });
    
    // Log action
    await pool.query(
      'INSERT INTO system_logs (level, message, category, metadata) VALUES ($1, $2, $3, $4)',
      ['INFO', 'Network configuration updated', 'network', 
       JSON.stringify({ admin: req.user.username })]
    );
    
    res.json({ success: true, message: 'Network configuration updated' });
  } catch (error) {
    console.error('Update network config error:', error);
    res.status(500).json({ error: 'Failed to update network configuration' });
  }
});

// Get DHCP leases
router.get('/dhcp-leases', authenticateToken, async (req, res) => {
  try {
    // Read DHCP leases file
    const leases = await getDHCPLeases();
    res.json(leases);
  } catch (error) {
    console.error('Get DHCP leases error:', error);
    res.status(500).json({ error: 'Failed to get DHCP leases' });
  }
});

// Get network interfaces status
router.get('/interfaces', authenticateToken, async (req, res) => {
  try {
    const interfaces = await getNetworkInterfaces();
    res.json(interfaces);
  } catch (error) {
    console.error('Get network interfaces error:', error);
    res.status(500).json({ error: 'Failed to get network interfaces' });
  }
});

// Get network traffic statistics
router.get('/traffic', authenticateToken, async (req, res) => {
  try {
    const traffic = await getNetworkTraffic();
    res.json(traffic);
  } catch (error) {
    console.error('Get network traffic error:', error);
    res.status(500).json({ error: 'Failed to get network traffic' });
  }
});

// Restart network services
router.post('/restart-services', authenticateToken, async (req, res) => {
  try {
    const { services } = req.body; // ['dnsmasq', 'hostapd', 'nginx']
    
    const results = {};
    for (const service of services) {
      try {
        await execAsync(`sudo systemctl restart ${service}`);
        results[service] = 'success';
      } catch (error) {
        results[service] = `failed: ${error.message}`;
      }
    }
    
    // Log action
    await pool.query(
      'INSERT INTO system_logs (level, message, category, metadata) VALUES ($1, $2, $3, $4)',
      ['INFO', `Network services restarted: ${services.join(', ')}`, 'network',
       JSON.stringify({ admin: req.user.username, results })]
    );
    
    res.json({ success: true, results });
  } catch (error) {
    console.error('Restart services error:', error);
    res.status(500).json({ error: 'Failed to restart services' });
  }
});

// Configure bandwidth limiting
router.post('/bandwidth-limit', authenticateToken, async (req, res) => {
  try {
    const { clientId, uploadLimit, downloadLimit } = req.body;
    
    // Get client MAC address
    const clientResult = await pool.query('SELECT * FROM clients WHERE id = $1', [clientId]);
    if (clientResult.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    const client = clientResult.rows[0];
    
    // Apply bandwidth limiting using tc (traffic control)
    await applyBandwidthLimit(client.ip_address, uploadLimit, downloadLimit);
    
    // Update client record
    await pool.query(
      'UPDATE clients SET upload_limit = $1, download_limit = $2 WHERE id = $3',
      [uploadLimit, downloadLimit, clientId]
    );
    
    res.json({ success: true, message: 'Bandwidth limits applied' });
  } catch (error) {
    console.error('Bandwidth limit error:', error);
    res.status(500).json({ error: 'Failed to apply bandwidth limits' });
  }
});

// Get bandwidth monitoring for all clients
router.get('/bandwidth-monitor', authenticateToken, async (req, res) => {
  try {
    const bandwidthData = await getBandwidthMonitoring();
    res.json(bandwidthData);
  } catch (error) {
    console.error('Bandwidth monitor error:', error);
    res.status(500).json({ error: 'Failed to get bandwidth monitoring data' });
  }
});

// Helper functions
async function applyNetworkConfig(config) {
  try {
    // Generate dnsmasq configuration
    const dnsmasqConfig = `
# PISOWifi DHCP Configuration
interface=${config.wifi_interface}
dhcp-range=${config.dhcp_range_start},${config.dhcp_range_end},${config.subnet_mask},${config.lease_time}s
dhcp-option=3,${config.gateway}
dhcp-option=6,${config.dns_primary},${config.dns_secondary}
server=${config.dns_primary}
server=${config.dns_secondary}
log-dhcp
`;
    
    await fs.writeFile('/tmp/dnsmasq.conf.new', dnsmasqConfig);
    
    // Backup current config and apply new one
    await execAsync('sudo cp /etc/dnsmasq.conf /etc/dnsmasq.conf.backup');
    await execAsync('sudo cp /tmp/dnsmasq.conf.new /etc/dnsmasq.conf');
    
    // Restart dnsmasq if enabled
    if (config.dhcp_enabled) {
      await execAsync('sudo systemctl restart dnsmasq');
    }
    
  } catch (error) {
    console.error('Apply network config error:', error);
    throw error;
  }
}

async function getDHCPLeases() {
  try {
    const { stdout } = await execAsync('cat /var/lib/dhcp/dhcpd.leases | tail -50');
    // Parse DHCP leases format and return structured data
    // This is a simplified version
    return {
      leases: [],
      total: 0,
      active: 0
    };
  } catch (error) {
    return { leases: [], total: 0, active: 0 };
  }
}

async function getNetworkInterfaces() {
  try {
    const { stdout } = await execAsync('ip addr show');
    const interfaces = [];
    
    // Parse ip addr output
    const lines = stdout.split('\n');
    let currentInterface = null;
    
    for (const line of lines) {
      if (line.match(/^\d+:/)) {
        const match = line.match(/^\d+: ([^:]+):/);
        if (match) {
          if (currentInterface) interfaces.push(currentInterface);
          currentInterface = {
            name: match[1],
            status: line.includes('UP') ? 'up' : 'down',
            addresses: []
          };
        }
      } else if (line.includes('inet ') && currentInterface) {
        const match = line.match(/inet ([^/]+)/);
        if (match) {
          currentInterface.addresses.push(match[1]);
        }
      }
    }
    
    if (currentInterface) interfaces.push(currentInterface);
    
    return interfaces;
  } catch (error) {
    return [];
  }
}

async function getNetworkTraffic() {
  try {
    const { stdout } = await execAsync('cat /proc/net/dev');
    const lines = stdout.split('\n');
    const traffic = {};
    
    for (const line of lines) {
      if (line.includes(':')) {
        const parts = line.trim().split(/\s+/);
        const interface = parts[0].replace(':', '');
        if (interface !== 'lo') {
          traffic[interface] = {
            rx_bytes: parseInt(parts[1]) || 0,
            tx_bytes: parseInt(parts[9]) || 0,
            rx_packets: parseInt(parts[2]) || 0,
            tx_packets: parseInt(parts[10]) || 0
          };
        }
      }
    }
    
    return traffic;
  } catch (error) {
    return {};
  }
}

async function applyBandwidthLimit(ipAddress, uploadLimit, downloadLimit) {
  try {
    // Use tc (traffic control) to limit bandwidth
    // This is a simplified implementation
    await execAsync(`sudo tc qdisc add dev wlan0 root handle 1: htb default 30`);
    await execAsync(`sudo tc class add dev wlan0 parent 1: classid 1:1 htb rate ${downloadLimit}kbit`);
    await execAsync(`sudo tc filter add dev wlan0 protocol ip parent 1:0 prio 1 u32 match ip dst ${ipAddress}/32 flowid 1:1`);
  } catch (error) {
    console.error('Apply bandwidth limit error:', error);
  }
}

async function getBandwidthMonitoring() {
  try {
    // Get bandwidth usage per client
    const clients = await pool.query('SELECT * FROM clients WHERE status = $1', ['CONNECTED']);
    const monitoring = [];
    
    for (const client of clients.rows) {
      try {
        // This would normally use iptables or netstat to get real-time data
        // For now, we'll return mock data
        monitoring.push({
          client_id: client.id,
          mac_address: client.mac_address,
          ip_address: client.ip_address,
          upload_bytes: Math.floor(Math.random() * 1000000),
          download_bytes: Math.floor(Math.random() * 5000000),
          upload_rate: Math.floor(Math.random() * 100) + 'kbps',
          download_rate: Math.floor(Math.random() * 500) + 'kbps'
        });
      } catch (error) {
        continue;
      }
    }
    
    return monitoring;
  } catch (error) {
    return [];
  }
}

module.exports = router;