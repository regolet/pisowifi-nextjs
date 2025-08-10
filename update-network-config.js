#!/usr/bin/env node

// Dynamic Network Configuration Updater
// Reads configuration from database and applies it to the system

const { Pool } = require('pg');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;

const execAsync = promisify(exec);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://pisowifi_user:admin123@localhost:5432/pisowifi'
});

async function updateNetworkConfiguration() {
  console.log('=== PISOWifi Dynamic Configuration Update ===');
  console.log('');

  try {
    // Get network configuration from database
    console.log('Reading configuration from database...');
    const result = await pool.query('SELECT * FROM network_config WHERE id = 1');
    
    let config;
    if (result.rows.length > 0) {
      config = result.rows[0];
      console.log('✓ Configuration loaded from database');
    } else {
      // Fallback to file
      try {
        const fileData = await fs.readFile('/tmp/network-config.json', 'utf8');
        config = JSON.parse(fileData);
        console.log('✓ Configuration loaded from file');
      } catch (fileError) {
        throw new Error('No configuration found in database or file');
      }
    }

    console.log('');
    console.log('Configuration:');
    console.log(`  DHCP Range: ${config.dhcp_range_start} - ${config.dhcp_range_end}`);
    console.log(`  Gateway: ${config.gateway}`);
    console.log(`  DNS: ${config.dns_primary}, ${config.dns_secondary}`);
    console.log(`  Interface: ${config.wifi_interface} (will be mapped to available Ethernet)`);
    console.log('');

    // Detect available network interfaces
    const { stdout: interfaceList } = await execAsync('ip link show | grep -E "^[0-9]:" | awk -F\': \' \'{print $2}\'');
    const interfaces = interfaceList.trim().split('\n').filter(iface => 
      !iface.includes('lo') && iface.length > 0
    );

    let clientInterface = 'enx00e04c68276e'; // Default USB Ethernet
    let wanInterface = 'end0'; // Default main interface

    // Find correct interfaces
    for (const iface of interfaces) {
      if (iface.startsWith('enx') || iface.includes('usb')) {
        clientInterface = iface;
      } else if (iface.startsWith('end') || iface.startsWith('eth')) {
        wanInterface = iface;
      }
    }

    console.log(`Detected interfaces: Client=${clientInterface}, WAN=${wanInterface}`);
    console.log('');

    // Stop existing services
    console.log('Stopping services...');
    await execAsync('sudo systemctl stop dnsmasq').catch(() => {});
    await execAsync('sudo pkill dnsmasq').catch(() => {});

    // Create dynamic dnsmasq configuration
    console.log('Creating dnsmasq configuration...');
    const dnsmasqConfig = `# PISOWifi Dynamic Configuration
interface=${clientInterface}
bind-interfaces

# DHCP Configuration from database
dhcp-range=${config.dhcp_range_start},${config.dhcp_range_end},${config.subnet_mask},${config.lease_time}s
dhcp-option=3,${config.gateway}
dhcp-option=6,${config.dns_primary},${config.dns_secondary}

# Captive Portal DNS redirects
address=/connectivitycheck.gstatic.com/${config.gateway}
address=/connectivitycheck.android.com/${config.gateway}
address=/captive.apple.com/${config.gateway}
address=/www.msftconnecttest.com/${config.gateway}
address=/detectportal.firefox.com/${config.gateway}
address=/clients3.google.com/${config.gateway}

# Redirect all domains to portal for unauthenticated users
address=/#/${config.gateway}

# Upstream DNS
server=${config.dns_primary}
server=${config.dns_secondary}

# Logging
log-dhcp
log-queries
log-facility=/var/log/dnsmasq.log
`;

    await fs.writeFile('/etc/dnsmasq.d/pisowifi-dynamic.conf', dnsmasqConfig);
    
    // Remove old config files
    await execAsync('sudo rm -f /etc/dnsmasq.d/pisowifi*.conf').catch(() => {});
    await execAsync(`sudo cp /etc/dnsmasq.d/pisowifi-dynamic.conf /etc/dnsmasq.d/pisowifi-active.conf`);

    // Configure network interface
    console.log(`Configuring interface ${clientInterface}...`);
    await execAsync(`sudo ip addr flush dev ${clientInterface}`).catch(() => {});
    await execAsync(`sudo ip addr add ${config.gateway}/${config.subnet_mask.split('.').map(octet => 
      256 - parseInt(octet)
    ).map(bits => Math.log2(bits)).reduce((sum, bits) => sum + (8 - bits), 0)} dev ${clientInterface}`);
    await execAsync(`sudo ip link set ${clientInterface} up`);

    // Create dynamic iptables rules
    console.log('Creating firewall rules...');
    const iptablesScript = `#!/bin/bash
# PISOWifi Dynamic Firewall Rules

# Clear existing rules
iptables -t nat -F
iptables -t mangle -F
iptables -F
iptables -X

# Default policies
iptables -P INPUT ACCEPT
iptables -P FORWARD DROP
iptables -P OUTPUT ACCEPT

# Allow loopback
iptables -A INPUT -i lo -j ACCEPT

# Allow established connections
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A FORWARD -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow DHCP and DNS on client interface
iptables -A INPUT -i ${clientInterface} -p udp --dport 67 -j ACCEPT
iptables -A INPUT -i ${clientInterface} -p udp --dport 53 -j ACCEPT
iptables -A INPUT -i ${clientInterface} -p tcp --dport 53 -j ACCEPT

# Allow web server access
iptables -A INPUT -i ${clientInterface} -p tcp --dport 3000 -j ACCEPT

# Redirect HTTP/HTTPS to portal
iptables -t nat -A PREROUTING -i ${clientInterface} -p tcp --dport 80 -j DNAT --to-destination ${config.gateway}:3000
iptables -t nat -A PREROUTING -i ${clientInterface} -p tcp --dport 443 -j DNAT --to-destination ${config.gateway}:3000

# NAT for authenticated clients
iptables -t nat -A POSTROUTING -o ${wanInterface} -j MASQUERADE

# Create authentication chain
iptables -t mangle -N pisowifi_auth 2>/dev/null
iptables -t mangle -F pisowifi_auth
iptables -t mangle -A PREROUTING -i ${clientInterface} -j pisowifi_auth

echo "PISOWifi dynamic firewall rules applied"
echo "Gateway: ${config.gateway}"
echo "Client Interface: ${clientInterface}"
echo "WAN Interface: ${wanInterface}"
`;

    await fs.writeFile('/etc/iptables/pisowifi-dynamic.sh', iptablesScript);
    await execAsync('sudo chmod +x /etc/iptables/pisowifi-dynamic.sh');
    await execAsync('sudo /etc/iptables/pisowifi-dynamic.sh');

    // Enable IP forwarding
    await execAsync('sudo sysctl -w net.ipv4.ip_forward=1');

    // Update systemd service
    const serviceConfig = `[Unit]
Description=PISOWifi Dynamic Service
After=network.target

[Service]
Type=oneshot
ExecStart=/etc/iptables/pisowifi-dynamic.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
`;

    await fs.writeFile('/etc/systemd/system/pisowifi-dynamic.service', serviceConfig);
    await execAsync('sudo systemctl daemon-reload');
    await execAsync('sudo systemctl enable pisowifi-dynamic');
    await execAsync('sudo systemctl start pisowifi-dynamic');

    // Start dnsmasq
    console.log('Starting services...');
    await execAsync('sudo systemctl start dnsmasq');

    // Save current config
    await fs.writeFile('/tmp/current-network-config.json', JSON.stringify({
      ...config,
      client_interface: clientInterface,
      wan_interface: wanInterface,
      applied_at: new Date().toISOString()
    }, null, 2));

    console.log('');
    console.log('=== Configuration Applied Successfully ===');
    console.log(`Gateway: ${config.gateway}`);
    console.log(`DHCP Range: ${config.dhcp_range_start} - ${config.dhcp_range_end}`);
    console.log(`Client Interface: ${clientInterface}`);
    console.log(`WAN Interface: ${wanInterface}`);
    console.log('');
    console.log('Services should now be active in dashboard');

  } catch (error) {
    console.error('Configuration update failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run if called directly
if (require.main === module) {
  updateNetworkConfiguration();
}

module.exports = { updateNetworkConfiguration };