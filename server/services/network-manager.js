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
    // Setup iptables rules for ethernet-based captive portal
    try {
      // Use the dedicated ethernet setup script
      const scriptsPath = path.join(__dirname, '../../scripts');
      await execAsync(`sudo ${scriptsPath}/pisowifi-setup-ethernet-portal`);
      console.log('Ethernet captive portal rules applied');
    } catch (error) {
      console.error('Failed to setup ethernet captive portal:', error);
      
      // Fallback: try basic setup
      try {
        await execAsync('sudo sysctl -w net.ipv4.ip_forward=1');
        console.log('IP forwarding enabled as fallback');
      } catch (fallbackError) {
        console.error('Failed to enable IP forwarding:', fallbackError);
      }
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
      // Use the dedicated ethernet allow script
      const scriptsPath = path.join(__dirname, '../../scripts');
      await execAsync(`sudo ${scriptsPath}/pisowifi-allow-client-ethernet ${macAddress} ${duration}`);
      
      // Track authenticated client in file
      const authFile = '/tmp/authenticated-clients.json';
      let clients = [];
      try {
        const data = await fs.readFile(authFile, 'utf8');
        clients = JSON.parse(data);
      } catch (e) {
        // File doesn't exist yet
      }
      
      // Remove any existing entry for this MAC
      clients = clients.filter(c => c.mac !== macAddress);
      
      // Add new entry
      clients.push({
        mac: macAddress,
        ip: ipAddress,
        authenticated_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + duration * 1000).toISOString(),
        duration: duration
      });
      
      await fs.writeFile(authFile, JSON.stringify(clients, null, 2));
      
      console.log(`Authenticated client ${macAddress} for ${duration} seconds`);
      return { success: true };
    } catch (error) {
      console.error('Failed to authenticate client:', error);
      return { success: false, error: error.message };
    }
  }

  async deauthenticateClient(macAddress) {
    try {
      // Use the dedicated ethernet block script
      const scriptsPath = path.join(__dirname, '../../scripts');
      await execAsync(`sudo ${scriptsPath}/pisowifi-block-client-ethernet ${macAddress} "api_disconnect"`);
      
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
      
      console.log(`Deauthenticated client ${macAddress}`);
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
    
    // Check pisowifi services (try multiple service names)
    let pisowifiActive = false;
    let pisowifiStatus = 'inactive';
    let pisowifiInfo = 'Service not found';
    
    // Check pisowifi-dynamic first
    try {
      const { stdout } = await execAsync('systemctl is-active pisowifi-dynamic');
      if (stdout.trim() === 'active') {
        pisowifiActive = true;
        pisowifiStatus = 'active';
        pisowifiInfo = 'Dynamic service active';
      }
    } catch (error) {
      // Try pisowifi-final
      try {
        const { stdout } = await execAsync('systemctl is-active pisowifi-final');
        if (stdout.trim() === 'active') {
          pisowifiActive = true;
          pisowifiStatus = 'active';
          pisowifiInfo = 'Final service active';
        }
      } catch (error2) {
        // If no services, but rules exist, mark as active
        if (status.iptables && status.iptables.active) {
          pisowifiActive = true;
          pisowifiStatus = 'manual';
          pisowifiInfo = 'Rules manually applied';
        }
      }
    }
    
    status.pisowifi = {
      active: pisowifiActive,
      status: pisowifiStatus,
      info: pisowifiInfo
    };
    
    return status;
  }

  async getConnectedClients() {
    try {
      const clients = [];
      
      // Try multiple sources for client information
      
      // Method 1: DHCP leases from dnsmasq
      try {
        const { stdout: dhcpOutput } = await execAsync('cat /var/lib/misc/dnsmasq.leases /var/lib/dhcp/dhcpd.leases 2>/dev/null || echo ""');
        const dhcpLines = dhcpOutput.trim().split('\n').filter(l => l && l.includes('192.168.100.'));
        
        dhcpLines.forEach(line => {
          const parts = line.split(' ');
          if (parts.length >= 3) {
            clients.push({
              timestamp: parts[0],
              mac_address: parts[1],
              ip_address: parts[2], 
              hostname: parts[3] || 'Unknown',
              client_id: parts[4] || '',
              source: 'dhcp'
            });
          }
        });
      } catch (dhcpError) {
        console.warn('DHCP lease parsing failed:', dhcpError.message);
      }
      
      // Method 2: ARP/Neighbor table for ethernet interface
      try {
        const { stdout: arpOutput } = await execAsync('ip neighbor show dev enx00e04c68276e | grep 192.168.100');
        const arpLines = arpOutput.trim().split('\n').filter(l => l);
        
        arpLines.forEach(line => {
          const parts = line.split(' ');
          if (parts.length >= 5) {
            const ip = parts[0];
            const mac = parts[4];
            
            // Check if we already have this client from DHCP
            const existing = clients.find(c => c.mac_address === mac);
            if (!existing) {
              clients.push({
                timestamp: Date.now(),
                mac_address: mac,
                ip_address: ip,
                hostname: 'Unknown',
                client_id: '',
                source: 'arp'
              });
            }
          }
        });
      } catch (arpError) {
        console.warn('ARP table parsing failed:', arpError.message);
      }
      
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
          expires_at: authInfo?.expires_at || null,
          auth_duration: authInfo?.duration || null
        };
      });
      
      console.log(`Found ${enrichedClients.length} connected clients (${enrichedClients.filter(c => c.authenticated).length} authenticated)`);
      return enrichedClients;
    } catch (error) {
      console.error('Failed to get connected clients:', error);
      return [];
    }
  }
}

module.exports = NetworkManager;