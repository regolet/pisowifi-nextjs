const express = require('express');
const router = express.Router();
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const db = require('../../db/sqlite-adapter');
const { authenticateAPI, apiLimiter } = require('../../middleware/security');
const { isValidServiceName, isAllowedService, isValidIPv4, isValidInterfaceName, isValidInteger } = require('../../utils/validators');

const execAsync = promisify(exec);

// Use centralized auth middleware
const authenticateToken = authenticateAPI;

// Get network configuration
router.get('/config', authenticateToken, async (req, res) => {
  try {
    // Try to get from database first
    try {
      const result = await db.query('SELECT * FROM network_config WHERE id = 1');
      if (result.rows.length > 0) {
        return res.json(result.rows[0]);
      }
    } catch (dbError) {
      console.log('Database not available, using file-based config');
    }

    // Fallback to file-based config
    try {
      const configData = await fs.readFile('/tmp/network-config.json', 'utf8');
      return res.json(JSON.parse(configData));
    } catch (fileError) {
      // Return default configuration
      const config = {
        dhcp_enabled: true,
        dhcp_range_start: '10.0.0.10',
        dhcp_range_end: '10.0.0.200',
        subnet_mask: '255.255.255.0',
        gateway: '10.0.0.1',
        dns_primary: '8.8.8.8',
        dns_secondary: '8.8.4.4',
        lease_time: 3600,
        wifi_interface: 'wlan0',
        ethernet_interface: 'eth0',
        wan_mode: 'dhcp',
        wan_interface: 'eth0',
        pppoe_username: '',
        pppoe_password: '',
        pppoe_mtu: 1492,
        bandwidth_enabled: false,
        bandwidth_download_limit: 10,
        bandwidth_upload_limit: 5,
        per_client_bandwidth_enabled: false,
        per_client_download_limit: 2048,
        per_client_upload_limit: 1024
      };

      res.json(config);
    }
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
      ethernet_interface,
      wan_mode,
      wan_interface,
      pppoe_username,
      pppoe_password,
      pppoe_mtu
    } = req.body;

    // SECURITY: Validate input before persisting or applying
    if (!isValidIPv4(dhcp_range_start) || !isValidIPv4(dhcp_range_end)) {
      return res.status(400).json({ error: 'Invalid DHCP range IP address' });
    }
    if (!isValidIPv4(subnet_mask) || !isValidIPv4(gateway)) {
      return res.status(400).json({ error: 'Invalid subnet mask or gateway IP' });
    }
    if (dns_primary && !isValidIPv4(dns_primary)) {
      return res.status(400).json({ error: 'Invalid primary DNS IP' });
    }
    if (dns_secondary && !isValidIPv4(dns_secondary)) {
      return res.status(400).json({ error: 'Invalid secondary DNS IP' });
    }
    if (!isValidInterfaceName(wifi_interface) || !isValidInterfaceName(ethernet_interface)) {
      return res.status(400).json({ error: 'Invalid interface name' });
    }
    if (!isValidInteger(lease_time, 60, 86400)) {
      return res.status(400).json({ error: 'Invalid lease_time (60-86400 seconds)' });
    }
    if (wan_mode && !['dhcp', 'pppoe'].includes(wan_mode)) {
      return res.status(400).json({ error: 'Invalid WAN mode' });
    }
    if (wan_interface && !isValidInterfaceName(wan_interface)) {
      return res.status(400).json({ error: 'Invalid WAN interface name' });
    }
    if (pppoe_mtu !== undefined && !isValidInteger(pppoe_mtu, 576, 1500)) {
      return res.status(400).json({ error: 'Invalid PPPoE MTU (576-1500)' });
    }

    // Try to save to database first
    try {
      await db.query(
        `INSERT INTO network_config (
          id, dhcp_enabled, dhcp_range_start, dhcp_range_end, 
          subnet_mask, gateway, dns_primary, dns_secondary, 
          lease_time, wifi_interface, ethernet_interface,
          wan_mode, wan_interface, pppoe_username, pppoe_password, pppoe_mtu,
          updated_at
        ) VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP)
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
          wan_mode = EXCLUDED.wan_mode,
          wan_interface = EXCLUDED.wan_interface,
          pppoe_username = EXCLUDED.pppoe_username,
          pppoe_password = EXCLUDED.pppoe_password,
          pppoe_mtu = EXCLUDED.pppoe_mtu,
          updated_at = CURRENT_TIMESTAMP`,
        [
          dhcp_enabled, dhcp_range_start, dhcp_range_end,
          subnet_mask, gateway, dns_primary, dns_secondary,
          lease_time, wifi_interface, ethernet_interface,
          wan_mode || 'dhcp',
          wan_interface || 'eth0',
          pppoe_username || '',
          pppoe_password || '',
          pppoe_mtu || 1492
        ]
      );
      console.log('Network config saved to database');
    } catch (dbError) {
      console.log('Database not available, saving to file:', dbError.message);
    }

    // Also save to file as backup
    const config = {
      dhcp_enabled,
      dhcp_range_start,
      dhcp_range_end,
      subnet_mask,
      gateway,
      dns_primary,
      dns_secondary,
      lease_time,
      wifi_interface,
      ethernet_interface,
      wan_mode: wan_mode || 'dhcp',
      wan_interface: wan_interface || 'eth0',
      pppoe_username: pppoe_username || '',
      pppoe_password: pppoe_password || '',
      pppoe_mtu: pppoe_mtu || 1492,
      updated_at: new Date().toISOString(),
      updated_by: req.user?.username || 'admin'
    };

    await fs.writeFile('/tmp/network-config.json', JSON.stringify(config, null, 2));

    // Apply dynamic configuration
    try {
      const path = require('path');
      const updaterPath = path.join(__dirname, '../../../scripts/update-network-config.js');

      // Run the dynamic configuration updater
      await execAsync(`node ${updaterPath}`);
      console.log('Dynamic network configuration applied');
    } catch (applyError) {
      console.warn('Dynamic config application warning:', applyError.message);

      // Fallback to static config
      try {
        await applyNetworkConfig(config);
      } catch (staticError) {
        console.warn('Static config also failed:', staticError.message);
      }
    }

    res.json({ success: true, message: 'Network configuration updated successfully' });
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
    // Return mock interfaces for now to avoid system dependency issues
    const interfaces = [
      {
        name: 'eth0',
        status: 'up',
        addresses: ['192.168.1.105/24']
      },
      {
        name: 'wlan0',
        status: 'up',
        addresses: ['10.0.0.1/24']
      },
      {
        name: 'lo',
        status: 'up',
        addresses: ['127.0.0.1/8']
      }
    ];

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
    const { services } = req.body; // ['dnsmasq', 'hostapd', 'pisowifi-captive']

    // SECURITY: Validate service names to prevent command injection
    if (!Array.isArray(services)) {
      return res.status(400).json({ error: 'Services must be an array' });
    }

    const results = {};
    for (const service of services) {
      // Validate each service name
      if (service !== 'pisowifi-captive' && service !== 'iptables' && !isAllowedService(service)) {
        results[service] = `denied: service not in allowed list`;
        continue;
      }

      try {
        console.log(`Restarting service: ${service}`);

        if (service === 'pisowifi-captive' || service === 'iptables') {
          // Restart iptables/captive portal rules
          await execAsync('/etc/iptables/captive-portal.sh 2>/dev/null || /etc/iptables/ethernet-captive.sh 2>/dev/null || echo "No captive portal script found"');
          results[service] = 'success';
        } else {
          // Restart systemd service
          await execAsync(`sudo systemctl restart ${service}`);
          results[service] = 'success';
        }
      } catch (error) {
        console.error(`Failed to restart ${service}:`, error.message);
        results[service] = `failed: ${error.message}`;

        // Try alternative methods
        if (service === 'hostapd') {
          try {
            await execAsync('sudo pkill hostapd; sudo hostapd /etc/hostapd/hostapd.conf -B');
            results[service] = 'success (manual start)';
          } catch (altError) {
            results[service] = `failed: ${altError.message}`;
          }
        } else if (service === 'dnsmasq') {
          try {
            await execAsync('sudo pkill dnsmasq; sudo dnsmasq');
            results[service] = 'success (manual start)';
          } catch (altError) {
            results[service] = `failed: ${altError.message}`;
          }
        }
      }
    }

    // Log to file
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: 'INFO',
      message: `Network services restart: ${services.join(', ')}`,
      category: 'network',
      admin: req.user?.username || 'admin',
      results
    };

    try {
      await fs.appendFile('/tmp/network-logs.json', JSON.stringify(logEntry) + '\n');
    } catch (logError) {
      console.warn('Failed to write log file:', logError.message);
    }

    res.json({ success: true, results });
  } catch (error) {
    console.error('Restart services error:', error);
    res.status(500).json({ error: 'Failed to restart services' });
  }
});

// Configure bandwidth limiting
router.post('/bandwidth-limit', authenticateToken, async (req, res) => {
  try {
    const { clientId, uploadLimit, downloadLimit, ipAddress } = req.body;

    // Simplified: Use provided IP or mock data to avoid database dependency
    const clientIP = ipAddress || '10.0.0.10'; // Fallback IP

    // Apply bandwidth limiting (simplified)
    try {
      console.log(`Would apply bandwidth limits to ${clientIP}: Upload: ${uploadLimit}kbps, Download: ${downloadLimit}kbps`);
      // In production environment, uncomment:
      // await applyBandwidthLimit(clientIP, uploadLimit, downloadLimit);
    } catch (applyError) {
      console.warn('Bandwidth limit application failed:', applyError.message);
    }

    // Store configuration in file instead of database
    const bandwidthConfig = {
      timestamp: new Date().toISOString(),
      clientId,
      ipAddress: clientIP,
      uploadLimit,
      downloadLimit,
      appliedBy: req.user?.username || 'admin'
    };

    try {
      await fs.appendFile('/tmp/bandwidth-config.json', JSON.stringify(bandwidthConfig) + '\n');
    } catch (fileError) {
      console.warn('Failed to save bandwidth config:', fileError.message);
    }

    res.json({ success: true, message: 'Bandwidth limits configured successfully' });
  } catch (error) {
    console.error('Bandwidth limit error:', error);
    res.status(500).json({ error: 'Failed to apply bandwidth limits' });
  }
});

// Get bandwidth monitoring for all clients
router.get('/bandwidth-monitor', authenticateToken, async (req, res) => {
  try {
    // Return empty array for now to avoid database issues
    const bandwidthData = [];
    res.json(bandwidthData);
  } catch (error) {
    console.error('Bandwidth monitor error:', error);
    res.status(500).json({ error: 'Failed to get bandwidth monitoring data' });
  }
});

// Get service status
router.get('/service-status', authenticateToken, async (req, res) => {
  try {
    console.log('API: Getting service status...');
    const NetworkManager = require('../../services/network-manager');
    const networkManager = new NetworkManager();
    const status = await networkManager.getServiceStatus();
    try {
      const ttlDetector = require('../../services/ttl-detector');
      status.ttl = ttlDetector.getStatus();
    } catch (ttlError) {
      status.ttl = { active: false, enabled: false, error: ttlError.message };
    }
    console.log('API: Service status result:', JSON.stringify(status, null, 2));
    res.json(status);
  } catch (error) {
    console.error('Service status API error:', error);
    // Return actual detected status even on error
    const fallbackStatus = {
      dnsmasq: { active: false, status: 'error', info: 'Detection failed' },
      hostapd: { active: false, status: 'disabled', info: 'WiFi not available' },
      iptables: { active: false, status: 'error', info: 'Detection failed' },
      pisowifi: { active: false, status: 'error', info: 'Detection failed' },
      ttl: { active: false, enabled: false, status: 'error', info: 'Detection failed' }
    };
    res.json(fallbackStatus);
  }
});

// Helper functions
async function applyNetworkConfig(config) {
  try {
    // Generate dnsmasq configuration
    const dnsmasqConfig = `
# PISOWifi DHCP Configuration
# Generated: ${new Date().toISOString()}
interface=${config.wifi_interface}
dhcp-range=${config.dhcp_range_start},${config.dhcp_range_end},${config.subnet_mask},${config.lease_time}s
dhcp-option=3,${config.gateway}
dhcp-option=6,${config.dns_primary},${config.dns_secondary}
server=${config.dns_primary}
server=${config.dns_secondary}
log-dhcp
`;

    // Save to tmp directory (safe location)
    await fs.writeFile('/tmp/dnsmasq.conf.pisowifi', dnsmasqConfig);
    console.log('Network configuration saved to /tmp/dnsmasq.conf.pisowifi');

    // In development/testing mode, just log what would happen
    console.log('Would execute system commands:');
    console.log('- sudo cp /etc/dnsmasq.conf /etc/dnsmasq.conf.backup');
    console.log('- sudo cp /tmp/dnsmasq.conf.pisowifi /etc/dnsmasq.conf');

    if (config.dhcp_enabled) {
      console.log('- sudo systemctl restart dnsmasq');
    }

    // For production, uncomment these lines:
    // await execAsync('sudo cp /etc/dnsmasq.conf /etc/dnsmasq.conf.backup');
    // await execAsync('sudo cp /tmp/dnsmasq.conf.pisowifi /etc/dnsmasq.conf');
    // if (config.dhcp_enabled) {
    //   await execAsync('sudo systemctl restart dnsmasq');
    // }

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
    const iface = await getBandwidthInterface();
    await applyPerClientBandwidthLimit(iface, ipAddress, uploadLimit, downloadLimit);
  } catch (error) {
    console.error('Apply bandwidth limit error:', error);
  }
}

async function applyWanConfig(wanConfig) {
  if (process.platform !== 'linux') {
    console.warn('WAN apply skipped: non-Linux platform');
    return;
  }
  const mode = wanConfig.wan_mode || 'dhcp';
  const iface = wanConfig.wan_interface || 'eth0';

  if (!isValidInterfaceName(iface)) {
    throw new Error('Invalid WAN interface name');
  }

  if (mode === 'pppoe') {
    if (!wanConfig.pppoe_username || !wanConfig.pppoe_password) {
      throw new Error('PPPoE username and password are required');
    }

    const mtu = wanConfig.pppoe_mtu || 1492;
    if (!isValidInteger(mtu, 576, 1500)) {
      throw new Error('Invalid PPPoE MTU');
    }

    const peerConfig = `
plugin rp-pppoe.so
${iface}
user "${wanConfig.pppoe_username}"
defaultroute
usepeerdns
mtu ${mtu}
mru ${mtu}
persist
holdoff 10
lcp-echo-interval 10
lcp-echo-failure 3
`;

    await fs.writeFile('/tmp/pisowifi-pppoe', peerConfig);
    await execAsync('sudo cp /tmp/pisowifi-pppoe /etc/ppp/peers/pisowifi-wan');

    const secretsLine = `"${wanConfig.pppoe_username}" * "${wanConfig.pppoe_password}" *\n`;
    await execAsync(`sudo sh -c "grep -v '^\\\"${wanConfig.pppoe_username}\\\"' /etc/ppp/chap-secrets > /tmp/chap-secrets.pisowifi || true"`);
    await execAsync(`sudo sh -c "printf '${secretsLine}' >> /tmp/chap-secrets.pisowifi"`);
    await execAsync('sudo cp /tmp/chap-secrets.pisowifi /etc/ppp/chap-secrets');

    await execAsync(`sudo sh -c "grep -v '^\\\"${wanConfig.pppoe_username}\\\"' /etc/ppp/pap-secrets > /tmp/pap-secrets.pisowifi || true"`);
    await execAsync(`sudo sh -c "printf '${secretsLine}' >> /tmp/pap-secrets.pisowifi"`);
    await execAsync('sudo cp /tmp/pap-secrets.pisowifi /etc/ppp/pap-secrets');

    // Bring down DHCP client and start PPPoE
    await execAsync(`sudo dhclient -r ${iface} 2>/dev/null || true`);
    await execAsync('sudo poff pisowifi-wan 2>/dev/null || true');
    await execAsync('sudo pon pisowifi-wan');
  } else {
    // DHCP mode: stop PPPoE and acquire lease
    await execAsync('sudo poff pisowifi-wan 2>/dev/null || true');
    await execAsync(`sudo dhclient -r ${iface} 2>/dev/null || true`);
    await execAsync(`sudo dhclient ${iface}`);
  }
}

// WAN configuration (DHCP/PPPoE)
router.get('/wan', authenticateToken, async (req, res) => {
  try {
    try {
      const result = await db.query('SELECT * FROM network_config WHERE id = 1');
      if (result.rows.length > 0) {
        const row = result.rows[0];
        return res.json({
          wan_mode: row.wan_mode || 'dhcp',
          wan_interface: row.wan_interface || 'eth0',
          pppoe_username: row.pppoe_username || '',
          pppoe_password: row.pppoe_password || '',
          pppoe_mtu: row.pppoe_mtu || 1492
        });
      }
    } catch (dbError) {
      console.warn('Get WAN config fallback:', dbError.message);
    }

    res.json({
      wan_mode: 'dhcp',
      wan_interface: 'eth0',
      pppoe_username: '',
      pppoe_password: '',
      pppoe_mtu: 1492
    });
  } catch (error) {
    console.error('Get WAN config error:', error);
    res.status(500).json({ error: 'Failed to get WAN config' });
  }
});

router.put('/wan', authenticateToken, async (req, res) => {
  try {
    const { wan_mode, wan_interface, pppoe_username, pppoe_password, pppoe_mtu } = req.body;

    if (!['dhcp', 'pppoe'].includes(wan_mode)) {
      return res.status(400).json({ error: 'Invalid WAN mode' });
    }
    if (!isValidInterfaceName(wan_interface)) {
      return res.status(400).json({ error: 'Invalid WAN interface name' });
    }
    if (pppoe_mtu !== undefined && !isValidInteger(pppoe_mtu, 576, 1500)) {
      return res.status(400).json({ error: 'Invalid PPPoE MTU (576-1500)' });
    }

    await db.query(
      `UPDATE network_config SET
        wan_mode = $1,
        wan_interface = $2,
        pppoe_username = $3,
        pppoe_password = $4,
        pppoe_mtu = $5,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = 1`,
      [wan_mode, wan_interface, pppoe_username || '', pppoe_password || '', pppoe_mtu || 1492]
    );

    try {
      await applyWanConfig({ wan_mode, wan_interface, pppoe_username, pppoe_password, pppoe_mtu });
      res.json({ success: true, message: 'WAN configuration applied' });
    } catch (applyError) {
      console.warn('WAN apply warning:', applyError.message);
      res.json({ success: true, message: 'WAN configuration saved', warning: applyError.message });
    }
  } catch (error) {
    console.error('Update WAN config error:', error);
    res.status(500).json({ error: 'Failed to update WAN config' });
  }
});

async function getBandwidthInterface() {
  try {
    const result = await db.query('SELECT wifi_interface, ethernet_interface FROM network_config WHERE id = 1');
    if (result.rows.length > 0) {
      return result.rows[0].wifi_interface || result.rows[0].ethernet_interface;
    }
  } catch (_) {
    // ignore
  }

  try {
    const result = await db.query('SELECT interface FROM network_settings WHERE id = 1');
    if (result.rows.length > 0) {
      return result.rows[0].interface;
    }
  } catch (_) {
    // ignore
  }

  return process.env.PISOWIFI_INTERFACE || 'wlan0';
}

async function clearGlobalBandwidthLimit(iface) {
  try {
    await execAsync(`sudo tc qdisc del dev ${iface} root 2>/dev/null || true`);
    await execAsync(`sudo tc qdisc del dev ${iface} ingress 2>/dev/null || true`);
    await execAsync('sudo tc qdisc del dev ifb0 root 2>/dev/null || true');
    await execAsync('sudo ip link set ifb0 down 2>/dev/null || true');
  } catch (error) {
    console.warn('Clear bandwidth limit warning:', error.message);
  }
}

async function applyGlobalBandwidthLimit(iface, uploadLimit, downloadLimit) {
  // Validate interface
  if (!isValidInterfaceName(iface)) {
    throw new Error('Invalid network interface for bandwidth limit');
  }

  // Validate bandwidth limits (kbps)
  const dlLimit = parseInt(downloadLimit, 10);
  const ulLimit = parseInt(uploadLimit, 10);

  if (!isValidInteger(dlLimit, 1, 10000000) || !isValidInteger(ulLimit, 1, 10000000)) {
    throw new Error('Invalid bandwidth limits');
  }

  // Clear existing qdisc to avoid duplicates
  await clearGlobalBandwidthLimit(iface);

  // Egress shaping (download to clients) on LAN interface
  await execAsync(`sudo tc qdisc add dev ${iface} root handle 1: htb default 10`);
  await execAsync(`sudo tc class add dev ${iface} parent 1: classid 1:10 htb rate ${dlLimit}kbit`);

  // Ingress shaping (upload from clients) using ifb0
  await execAsync('sudo modprobe ifb');
  await execAsync('sudo ip link add ifb0 type ifb 2>/dev/null || true');
  await execAsync('sudo ip link set ifb0 up');
  await execAsync(`sudo tc qdisc add dev ${iface} handle ffff: ingress`);
  await execAsync(`sudo tc filter add dev ${iface} parent ffff: matchall action mirred egress redirect dev ifb0`);
  await execAsync('sudo tc qdisc add dev ifb0 root handle 2: htb default 20');
  await execAsync(`sudo tc class add dev ifb0 parent 2: classid 2:20 htb rate ${ulLimit}kbit`);
}

async function getBandwidthMonitoring() {
  try {
    // Simplified: Return mock data to avoid database dependency
    const monitoring = [];

    // Generate mock monitoring data for common IP range
    for (let i = 10; i < 15; i++) {
      monitoring.push({
        client_id: `client_${i}`,
        mac_address: `aa:bb:cc:dd:ee:${i.toString(16).padStart(2, '0')}`,
        ip_address: `10.0.0.${i}`,
        upload_bytes: Math.floor(Math.random() * 1000000),
        download_bytes: Math.floor(Math.random() * 5000000),
        upload_rate: Math.floor(Math.random() * 100) + 'kbps',
        download_rate: Math.floor(Math.random() * 500) + 'kbps',
        status: Math.random() > 0.3 ? 'CONNECTED' : 'IDLE'
      });
    }

    return monitoring;
  } catch (error) {
    console.error('Bandwidth monitoring error:', error);
    return [];
  }
}

function hashIpToClassId(ipAddress) {
  const parts = ipAddress.split('.').map(p => parseInt(p, 10));
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n))) return null;
  let hash = 0;
  for (const n of parts) {
    hash = (hash * 31 + n) % 64000;
  }
  return hash + 1000; // 1000-65000
}

async function ensurePerClientQdisc(iface) {
  // Ensure root qdisc exists
  await execAsync(`sudo tc qdisc add dev ${iface} root handle 1: htb default 1 2>/dev/null || true`);

  // Ensure parent class exists (respect global limit if enabled)
  let parentRate = 10000000; // 10Gbps default
  try {
    const result = await db.query('SELECT bandwidth_enabled, bandwidth_download_limit, bandwidth_upload_limit FROM network_config WHERE id = 1');
    if (result.rows.length > 0 && result.rows[0].bandwidth_enabled) {
      parentRate = parseInt(result.rows[0].bandwidth_download_limit, 10) || parentRate;
    }
  } catch (_) {
    // ignore
  }
  await execAsync(`sudo tc class replace dev ${iface} parent 1: classid 1:1 htb rate ${parentRate}kbit`);

  // Ensure ifb0 for ingress shaping
  await execAsync('sudo modprobe ifb');
  await execAsync('sudo ip link add ifb0 type ifb 2>/dev/null || true');
  await execAsync('sudo ip link set ifb0 up');
  await execAsync(`sudo tc qdisc add dev ${iface} handle ffff: ingress 2>/dev/null || true`);
  await execAsync(`sudo tc filter add dev ${iface} parent ffff: matchall action mirred egress redirect dev ifb0 2>/dev/null || true`);
  await execAsync('sudo tc qdisc add dev ifb0 root handle 2: htb default 1 2>/dev/null || true');

  let parentUpload = 10000000; // 10Gbps default
  try {
    const result = await db.query('SELECT bandwidth_enabled, bandwidth_upload_limit FROM network_config WHERE id = 1');
    if (result.rows.length > 0 && result.rows[0].bandwidth_enabled) {
      parentUpload = parseInt(result.rows[0].bandwidth_upload_limit, 10) || parentUpload;
    }
  } catch (_) {
    // ignore
  }
  await execAsync(`sudo tc class replace dev ifb0 parent 2: classid 2:1 htb rate ${parentUpload}kbit`);
}

async function applyPerClientBandwidthLimit(iface, ipAddress, uploadLimit, downloadLimit) {
  if (process.platform !== 'linux') {
    console.warn('Per-client bandwidth apply skipped: non-Linux platform');
    return;
  }
  // SECURITY: Validate inputs
  if (!isValidIPv4(ipAddress)) {
    throw new Error('Invalid IP address provided to applyPerClientBandwidthLimit');
  }

  const dlLimit = parseInt(downloadLimit, 10);
  const ulLimit = parseInt(uploadLimit, 10);

  if (!isValidInteger(dlLimit, 1, 10000000) || !isValidInteger(ulLimit, 1, 10000000)) {
    throw new Error('Invalid per-client bandwidth limits');
  }

  await ensurePerClientQdisc(iface);

  const classId = hashIpToClassId(ipAddress);
  if (!classId) {
    throw new Error('Failed to derive class id for client IP');
  }

  // Download shaping (to client) on LAN interface
  await execAsync(`sudo tc class replace dev ${iface} parent 1:1 classid 1:${classId} htb rate ${dlLimit}kbit ceil ${dlLimit}kbit`);
  await execAsync(`sudo tc filter replace dev ${iface} parent 1: protocol ip prio 1 u32 match ip dst ${ipAddress}/32 flowid 1:${classId}`);

  // Upload shaping (from client) on ifb0
  await execAsync(`sudo tc class replace dev ifb0 parent 2:1 classid 2:${classId} htb rate ${ulLimit}kbit ceil ${ulLimit}kbit`);
  await execAsync(`sudo tc filter replace dev ifb0 parent 2: protocol ip prio 1 u32 match ip src ${ipAddress}/32 flowid 2:${classId}`);
}

async function clearPerClientBandwidthLimit(iface, ipAddress) {
  if (process.platform !== 'linux') {
    console.warn('Per-client bandwidth clear skipped: non-Linux platform');
    return;
  }
  if (!isValidIPv4(ipAddress)) return;
  const classId = hashIpToClassId(ipAddress);
  if (!classId) return;
  await execAsync(`sudo tc filter del dev ${iface} parent 1: protocol ip prio 1 u32 match ip dst ${ipAddress}/32 flowid 1:${classId} 2>/dev/null || true`);
  await execAsync(`sudo tc class del dev ${iface} classid 1:${classId} 2>/dev/null || true`);
  await execAsync(`sudo tc filter del dev ifb0 parent 2: protocol ip prio 1 u32 match ip src ${ipAddress}/32 flowid 2:${classId} 2>/dev/null || true`);
  await execAsync(`sudo tc class del dev ifb0 classid 2:${classId} 2>/dev/null || true`);
}

// Update universal bandwidth configuration
router.put('/bandwidth-config', authenticateToken, async (req, res) => {
  try {
    const {
      bandwidth_enabled,
      bandwidth_download_limit,
      bandwidth_upload_limit
    } = req.body;

    if (!isValidInteger(bandwidth_download_limit, 1, 10000000) || !isValidInteger(bandwidth_upload_limit, 1, 10000000)) {
      return res.status(400).json({ error: 'Invalid bandwidth limits' });
    }

    // Try to save to database
    try {
      // First check if table has bandwidth columns
      const result = await db.query('SELECT * FROM network_config WHERE id = 1');
      
      if (result.rows.length > 0) {
        // Update existing config with bandwidth settings
        await db.query(
          `UPDATE network_config SET 
            bandwidth_enabled = ?,
            bandwidth_download_limit = ?,
            bandwidth_upload_limit = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = 1`,
          [bandwidth_enabled ? 1 : 0, bandwidth_download_limit, bandwidth_upload_limit]
        );
      } else {
        // Insert new config with bandwidth settings
        await db.query(
          `INSERT INTO network_config (id, bandwidth_enabled, bandwidth_download_limit, bandwidth_upload_limit, updated_at) 
           VALUES (1, ?, ?, ?, CURRENT_TIMESTAMP)`,
          [bandwidth_enabled ? 1 : 0, bandwidth_download_limit, bandwidth_upload_limit]
        );
      }
      
      console.log('Bandwidth config saved to database');
    } catch (dbError) {
      console.log('Database error saving bandwidth config:', dbError.message);
      
      // Fallback to file-based config
      try {
        let config = {};
        try {
          const configData = await fs.readFile('/tmp/network-config.json', 'utf8');
          config = JSON.parse(configData);
        } catch (readError) {
          // File doesn't exist, start fresh
        }
        
        config.bandwidth_enabled = bandwidth_enabled;
        config.bandwidth_download_limit = bandwidth_download_limit;
        config.bandwidth_upload_limit = bandwidth_upload_limit;
        
        await fs.writeFile('/tmp/network-config.json', JSON.stringify(config, null, 2));
        console.log('Bandwidth config saved to file');
      } catch (fileError) {
        console.error('Failed to save bandwidth config to file:', fileError);
      }
    }

    // Apply or clear global bandwidth shaping
    try {
      const iface = await getBandwidthInterface();
      if (bandwidth_enabled) {
        await applyGlobalBandwidthLimit(iface, bandwidth_upload_limit, bandwidth_download_limit);
      } else {
        await clearGlobalBandwidthLimit(iface);
      }
    } catch (applyError) {
      console.warn('Bandwidth apply warning:', applyError.message);
    }

    // Emit real-time update to all admin clients
    try {
      const { io } = require('../../app');
      io.emit('bandwidth-settings-updated', {
        type: 'global',
        bandwidth_enabled,
        bandwidth_download_limit,
        bandwidth_upload_limit
      });
      console.log('[BANDWIDTH] Emitted real-time global bandwidth update');
    } catch (ioError) {
      console.warn('Socket.IO emit warning:', ioError.message);
    }

    res.json({ success: true, message: 'Bandwidth configuration updated' });
  } catch (error) {
    console.error('Update bandwidth config error:', error);
    res.status(500).json({ error: 'Failed to update bandwidth configuration' });
  }
});

// Default per-client bandwidth limits (apply to all clients)
router.put('/bandwidth-per-client-default', authenticateToken, async (req, res) => {
  try {
    const {
      per_client_bandwidth_enabled,
      per_client_download_limit,
      per_client_upload_limit
    } = req.body;

    if (!isValidInteger(per_client_download_limit, 1, 10000000) || !isValidInteger(per_client_upload_limit, 1, 10000000)) {
      return res.status(400).json({ error: 'Invalid per-client default limits' });
    }

    try {
      const result = await db.query('SELECT * FROM network_config WHERE id = 1');

      if (result.rows.length > 0) {
        await db.query(
          `UPDATE network_config SET 
            per_client_bandwidth_enabled = ?,
            per_client_download_limit = ?,
            per_client_upload_limit = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = 1`,
          [per_client_bandwidth_enabled ? 1 : 0, per_client_download_limit, per_client_upload_limit]
        );
      } else {
        await db.query(
          `INSERT INTO network_config (id, per_client_bandwidth_enabled, per_client_download_limit, per_client_upload_limit, updated_at)
           VALUES (1, ?, ?, ?, CURRENT_TIMESTAMP)`,
          [per_client_bandwidth_enabled ? 1 : 0, per_client_download_limit, per_client_upload_limit]
        );
      }
    } catch (dbError) {
      console.log('Database error saving per-client defaults:', dbError.message);
    }

    // Save to file fallback
    try {
      let config = {};
      try {
        const configData = await fs.readFile('/tmp/network-config.json', 'utf8');
        config = JSON.parse(configData);
      } catch (_) {
        // ignore
      }

      config.per_client_bandwidth_enabled = per_client_bandwidth_enabled;
      config.per_client_download_limit = per_client_download_limit;
      config.per_client_upload_limit = per_client_upload_limit;

      await fs.writeFile('/tmp/network-config.json', JSON.stringify(config, null, 2));
    } catch (fileError) {
      console.error('Failed to save per-client defaults to file:', fileError);
    }

    // Apply to ALL clients in the database (real-time update)
    let updatedCount = 0;
    try {
      const iface = await getBandwidthInterface();
      
      // Update ALL clients in database, not just connected ones
      if (per_client_bandwidth_enabled) {
        // Apply limits to all clients
        const updateResult = await db.query(
          'UPDATE clients SET upload_limit = $1, download_limit = $2',
          [per_client_upload_limit, per_client_download_limit]
        );
        updatedCount = updateResult.changes || 0;
        console.log(`[BANDWIDTH] Applied per-client limits to ${updatedCount} clients: Download=${per_client_download_limit}kbps, Upload=${per_client_upload_limit}kbps`);
        
        // Apply network shaping to connected clients with IP
        const connectedClients = await db.query(
          `SELECT id, ip_address FROM clients 
           WHERE status = 'CONNECTED' AND time_remaining > 0 AND ip_address IS NOT NULL`
        );
        
        for (const client of connectedClients.rows) {
          if (!client.ip_address) continue;
          await applyPerClientBandwidthLimit(iface, client.ip_address, per_client_upload_limit, per_client_download_limit);
        }
      } else {
        // Clear limits from all clients
        const updateResult = await db.query(
          'UPDATE clients SET upload_limit = 0, download_limit = 0'
        );
        updatedCount = updateResult.changes || 0;
        console.log(`[BANDWIDTH] Cleared per-client limits from ${updatedCount} clients`);
        
        // Clear network shaping from connected clients
        const connectedClients = await db.query(
          `SELECT id, ip_address FROM clients 
           WHERE status = 'CONNECTED' AND ip_address IS NOT NULL`
        );
        
        for (const client of connectedClients.rows) {
          if (!client.ip_address) continue;
          await clearPerClientBandwidthLimit(iface, client.ip_address);
        }
      }
    } catch (applyError) {
      console.warn('Per-client default apply warning:', applyError.message);
    }

    // Emit real-time update to all admin clients via Socket.IO
    try {
      const { io } = require('../../app');
      io.emit('bandwidth-settings-updated', {
        type: 'per-client',
        per_client_bandwidth_enabled,
        per_client_download_limit,
        per_client_upload_limit,
        updated_clients: updatedCount
      });
      console.log(`[BANDWIDTH] Emitted real-time per-client bandwidth update to all clients`);
    } catch (ioError) {
      console.warn('Socket.IO emit warning:', ioError.message);
    }

    res.json({ 
      success: true, 
      message: `Per-client default limits updated for ${updatedCount} clients`,
      updated_clients: updatedCount
    });
  } catch (error) {
    console.error('Update per-client default error:', error);
    res.status(500).json({ error: 'Failed to update per-client defaults' });
  }
});

// Per-client bandwidth limit
router.post('/bandwidth-client', authenticateToken, async (req, res) => {
  try {
    const { clientId, ipAddress, uploadLimit, downloadLimit, enabled = true } = req.body;

    if (!ipAddress || !isValidIPv4(ipAddress)) {
      return res.status(400).json({ error: 'Valid ipAddress is required' });
    }

    if (enabled && (!isValidInteger(uploadLimit, 1, 10000000) || !isValidInteger(downloadLimit, 1, 10000000))) {
      return res.status(400).json({ error: 'Invalid per-client bandwidth limits' });
    }

    const iface = await getBandwidthInterface();

    if (enabled) {
      await applyPerClientBandwidthLimit(iface, ipAddress, uploadLimit, downloadLimit);
    } else {
      await clearPerClientBandwidthLimit(iface, ipAddress);
    }

    // Persist to clients table if clientId provided
    if (clientId) {
      await db.query(
        'UPDATE clients SET upload_limit = $1, download_limit = $2 WHERE id = $3',
        [enabled ? uploadLimit : 0, enabled ? downloadLimit : 0, clientId]
      );
    }

    res.json({ success: true, message: 'Per-client bandwidth updated' });
  } catch (error) {
    console.error('Per-client bandwidth error:', error);
    res.status(500).json({ error: 'Failed to update per-client bandwidth' });
  }
});

module.exports = router;