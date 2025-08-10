const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');

const execAsync = promisify(exec);

class NetworkManager {
  constructor() {
    this.configPath = '/etc/pisowifi/network-config.json';
    this.dnsmasqConfig = '/etc/dnsmasq.d/pisowifi.conf';
    this.hostapdConfig = '/etc/hostapd/hostapd.conf';
    this.iptablesRules = '/etc/pisowifi/iptables.rules';
  }

  async initializeNetworkStack() {
    try {
      // Create config directories if they don't exist
      await execAsync('sudo mkdir -p /etc/pisowifi /etc/dnsmasq.d');
      
      // Initialize captive portal rules
      await this.setupCaptivePortal();
      
      // Setup DHCP server
      await this.setupDHCPServer();
      
      // Setup firewall rules
      await this.setupFirewallRules();
      
      return { success: true, message: 'Network stack initialized' };
    } catch (error) {
      console.error('Network initialization error:', error);
      return { success: false, error: error.message };
    }
  }

  async setupCaptivePortal() {
    // Setup iptables rules for captive portal
    const rules = `
#!/bin/bash
# PISOWifi Captive Portal Rules

# Enable IP forwarding
echo 1 > /proc/sys/net/ipv4/ip_forward

# Clear existing rules
iptables -t nat -F
iptables -t mangle -F
iptables -F

# Mark authenticated clients
iptables -t mangle -N pisowifi_auth 2>/dev/null || iptables -t mangle -F pisowifi_auth

# Redirect unauthenticated HTTP traffic to portal
iptables -t nat -A PREROUTING -i wlan0 -p tcp --dport 80 -j DNAT --to-destination 192.168.100.1:3000
iptables -t nat -A PREROUTING -i wlan0 -p tcp --dport 443 -j DNAT --to-destination 192.168.100.1:3000

# Allow DNS for all clients (needed for captive portal detection)
iptables -t nat -A PREROUTING -i wlan0 -p udp --dport 53 -j ACCEPT
iptables -t nat -A PREROUTING -i wlan0 -p tcp --dport 53 -j ACCEPT

# Allow DHCP
iptables -A INPUT -i wlan0 -p udp --dport 67:68 -j ACCEPT

# Allow portal access
iptables -A INPUT -i wlan0 -p tcp --dport 3000 -j ACCEPT

# Drop all other traffic from unauthenticated clients
iptables -A FORWARD -i wlan0 -m mark ! --mark 0x1 -j DROP

# NAT for authenticated clients
iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
`;

    try {
      await fs.writeFile('/tmp/captive-portal.sh', rules);
      await execAsync('sudo chmod +x /tmp/captive-portal.sh');
      await execAsync('sudo /tmp/captive-portal.sh');
      console.log('Captive portal rules applied');
    } catch (error) {
      console.error('Failed to setup captive portal:', error);
    }
  }

  async setupDHCPServer() {
    const dnsmasqConfig = `
# PISOWifi DHCP Configuration
interface=wlan0
dhcp-range=192.168.100.10,192.168.100.200,255.255.255.0,12h
dhcp-option=3,192.168.100.1
dhcp-option=6,8.8.8.8,8.8.4.4

# Captive portal detection responses
address=/connectivitycheck.gstatic.com/192.168.100.1
address=/connectivitycheck.android.com/192.168.100.1
address=/captive.apple.com/192.168.100.1
address=/www.msftconnecttest.com/192.168.100.1
address=/detectportal.firefox.com/192.168.100.1

# Log DHCP
log-dhcp
log-queries

# DNS
server=8.8.8.8
server=8.8.4.4
`;

    try {
      await fs.writeFile('/tmp/dnsmasq-pisowifi.conf', dnsmasqConfig);
      await execAsync('sudo cp /tmp/dnsmasq-pisowifi.conf /etc/dnsmasq.d/pisowifi.conf');
      await execAsync('sudo systemctl restart dnsmasq');
      console.log('DHCP server configured');
    } catch (error) {
      console.error('Failed to setup DHCP server:', error);
    }
  }

  async setupFirewallRules() {
    try {
      // Enable routing
      await execAsync('sudo sysctl -w net.ipv4.ip_forward=1');
      await execAsync('echo "net.ipv4.ip_forward=1" | sudo tee -a /etc/sysctl.conf');
      
      console.log('Firewall rules configured');
    } catch (error) {
      console.error('Failed to setup firewall:', error);
    }
  }

  async authenticateClient(macAddress, ipAddress, duration) {
    try {
      // Add iptables rule to mark authenticated client
      await execAsync(`sudo iptables -t mangle -A pisowifi_auth -m mac --mac-source ${macAddress} -j MARK --set-mark 0x1`);
      
      // Allow forwarding for authenticated client
      await execAsync(`sudo iptables -I FORWARD -m mac --mac-source ${macAddress} -j ACCEPT`);
      
      // Track authenticated client
      const authFile = '/tmp/authenticated-clients.json';
      let clients = [];
      try {
        const data = await fs.readFile(authFile, 'utf8');
        clients = JSON.parse(data);
      } catch (e) {
        // File doesn't exist yet
      }
      
      clients.push({
        mac: macAddress,
        ip: ipAddress,
        authenticated_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + duration * 1000).toISOString()
      });
      
      await fs.writeFile(authFile, JSON.stringify(clients, null, 2));
      
      // Schedule deauthentication
      setTimeout(() => {
        this.deauthenticateClient(macAddress);
      }, duration * 1000);
      
      return { success: true };
    } catch (error) {
      console.error('Failed to authenticate client:', error);
      return { success: false, error: error.message };
    }
  }

  async deauthenticateClient(macAddress) {
    try {
      // Remove iptables rules
      await execAsync(`sudo iptables -t mangle -D pisowifi_auth -m mac --mac-source ${macAddress} -j MARK --set-mark 0x1`).catch(() => {});
      await execAsync(`sudo iptables -D FORWARD -m mac --mac-source ${macAddress} -j ACCEPT`).catch(() => {});
      
      // Update authenticated clients file
      const authFile = '/tmp/authenticated-clients.json';
      try {
        const data = await fs.readFile(authFile, 'utf8');
        let clients = JSON.parse(data);
        clients = clients.filter(c => c.mac !== macAddress);
        await fs.writeFile(authFile, JSON.stringify(clients, null, 2));
      } catch (e) {
        // Ignore if file doesn't exist
      }
      
      return { success: true };
    } catch (error) {
      console.error('Failed to deauthenticate client:', error);
      return { success: false, error: error.message };
    }
  }

  async getServiceStatus() {
    const status = {};
    
    // Check dnsmasq
    try {
      const { stdout } = await execAsync('systemctl is-active dnsmasq');
      status.dnsmasq = {
        active: stdout.trim() === 'active',
        status: stdout.trim(),
        info: `DHCP & DNS Server ${stdout.trim()}`
      };
    } catch (error) {
      // Check if dnsmasq process is running even if systemctl fails
      try {
        const { stdout } = await execAsync('pgrep dnsmasq');
        status.dnsmasq = {
          active: true,
          status: 'running',
          info: `Running (PID: ${stdout.trim()})`
        };
      } catch (processError) {
        status.dnsmasq = {
          active: false,
          status: 'inactive',
          info: 'Not running'
        };
      }
    }
    
    // Check hostapd (we know it won't work without WiFi)
    status.hostapd = {
      active: false,
      status: 'disabled',
      info: 'WiFi not available'
    };
    
    // Check iptables/firewall
    try {
      // Check for DNAT rules (captive portal redirects)
      const { stdout: natRules } = await execAsync('sudo iptables -t nat -L PREROUTING -n 2>/dev/null || echo ""');
      const hasRedirectRules = natRules.includes('DNAT') && natRules.includes('3000');
      
      // Check for INPUT rules (allow web server access)
      const { stdout: inputRules } = await execAsync('sudo iptables -L INPUT -n 2>/dev/null || echo ""');
      const hasInputRules = inputRules.includes('tcp') && inputRules.includes('3000');
      
      // Check for any iptables rules at all
      const { stdout: allRules } = await execAsync('sudo iptables -L -n 2>/dev/null || echo ""');
      const hasAnyRules = allRules.length > 100; // Basic rules should have some content
      
      console.log(`Firewall check: DNAT=${hasRedirectRules}, INPUT=${hasInputRules}, ANY=${hasAnyRules}`);
      
      status.iptables = {
        active: hasRedirectRules || hasInputRules,
        status: (hasRedirectRules || hasInputRules) ? 'active' : 'inactive',
        info: hasRedirectRules ? 'Captive portal rules active' : 
              hasInputRules ? 'Partial rules active' :
              hasAnyRules ? 'Basic rules only' : 'No rules detected'
      };
    } catch (error) {
      console.error('Iptables check error:', error.message);
      status.iptables = {
        active: false,
        status: 'error',
        info: `Check failed: ${error.message}`
      };
    }
    
    // Check pisowifi-final service
    try {
      const { stdout } = await execAsync('systemctl is-active pisowifi-final');
      status.pisowifi = {
        active: stdout.trim() === 'active',
        status: stdout.trim(),
        info: `Captive portal ${stdout.trim()}`
      };
    } catch (error) {
      status.pisowifi = {
        active: false,
        status: 'inactive',
        info: 'Service not found'
      };
    }
    
    return status;
  }

  async getConnectedClients() {
    try {
      // Get DHCP leases
      const { stdout } = await execAsync('cat /var/lib/misc/dnsmasq.leases 2>/dev/null || echo ""');
      const lines = stdout.trim().split('\n').filter(l => l);
      
      const clients = lines.map(line => {
        const parts = line.split(' ');
        return {
          timestamp: parts[0],
          mac_address: parts[1],
          ip_address: parts[2],
          hostname: parts[3] || 'Unknown',
          client_id: parts[4] || ''
        };
      });
      
      // Check authentication status
      let authClients = [];
      try {
        const authData = await fs.readFile('/tmp/authenticated-clients.json', 'utf8');
        authClients = JSON.parse(authData);
      } catch (e) {
        // No authenticated clients yet
      }
      
      // Merge authentication status
      const enrichedClients = clients.map(client => {
        const authInfo = authClients.find(a => a.mac === client.mac_address);
        return {
          ...client,
          authenticated: !!authInfo,
          expires_at: authInfo?.expires_at || null
        };
      });
      
      return enrichedClients;
    } catch (error) {
      console.error('Failed to get connected clients:', error);
      return [];
    }
  }
}

module.exports = NetworkManager;