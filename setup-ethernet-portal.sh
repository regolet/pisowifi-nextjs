#!/bin/bash

# PISOWifi Ethernet-based Captive Portal Setup
# Use this when WiFi adapter is not available

echo "====================================="
echo "PISOWifi Ethernet Portal Setup"
echo "====================================="
echo ""
echo "This will configure PISOWifi to work via Ethernet"
echo "Clients will connect through Ethernet instead of WiFi"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "Please run as root (use sudo)"
    exit 1
fi

# Detect available network interfaces
echo "Available network interfaces:"
ip link show | grep -E "^[0-9]:" | awk -F': ' '{print $2}'
echo ""

# Ask user to choose interface
read -p "Enter the interface for client connections (e.g., eth0): " CLIENT_IF
read -p "Enter the interface for internet connection (e.g., eth1, or 'none' if not available): " WAN_IF

if [ -z "$CLIENT_IF" ]; then
    CLIENT_IF="eth0"
fi

echo ""
echo "Configuration:"
echo "  Client Interface: $CLIENT_IF"
echo "  WAN Interface: $WAN_IF"
echo ""
read -p "Continue? (y/n): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
fi

# Configure client interface
echo "Configuring client interface..."
ip addr flush dev $CLIENT_IF
ip addr add 192.168.100.1/24 dev $CLIENT_IF
ip link set $CLIENT_IF up

# Configure dnsmasq for Ethernet
echo "Configuring DHCP and DNS..."
cat > /etc/dnsmasq.d/pisowifi-eth.conf << EOF
# PISOWifi Ethernet DHCP Configuration
interface=$CLIENT_IF
bind-interfaces
except-interface=lo

# DHCP range
dhcp-range=192.168.100.10,192.168.100.200,255.255.255.0,12h

# Gateway
dhcp-option=3,192.168.100.1

# DNS (use portal IP to catch all DNS)
dhcp-option=6,192.168.100.1

# Captive portal detection
address=/connectivitycheck.gstatic.com/192.168.100.1
address=/connectivitycheck.android.com/192.168.100.1
address=/captive.apple.com/192.168.100.1
address=/www.msftconnecttest.com/192.168.100.1
address=/detectportal.firefox.com/192.168.100.1

# Redirect all domains to portal for unauthenticated users
address=/#/192.168.100.1

# Logging
log-dhcp
log-queries
EOF

# Remove WiFi-specific config
rm -f /etc/dnsmasq.d/pisowifi.conf

# Configure iptables for Ethernet-based captive portal
echo "Configuring firewall rules..."
cat > /etc/iptables/ethernet-captive.sh << EOF
#!/bin/bash

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
iptables -A INPUT -i $CLIENT_IF -p udp --dport 67:68 -j ACCEPT
iptables -A INPUT -i $CLIENT_IF -p udp --dport 53 -j ACCEPT
iptables -A INPUT -i $CLIENT_IF -p tcp --dport 53 -j ACCEPT

# Allow web server access
iptables -A INPUT -i $CLIENT_IF -p tcp --dport 3000 -j ACCEPT

# Redirect HTTP/HTTPS to portal
iptables -t nat -A PREROUTING -i $CLIENT_IF -p tcp --dport 80 -j DNAT --to-destination 192.168.100.1:3000
iptables -t nat -A PREROUTING -i $CLIENT_IF -p tcp --dport 443 -j DNAT --to-destination 192.168.100.1:3000

# Create authentication chain
iptables -t mangle -N pisowifi_auth 2>/dev/null || iptables -t mangle -F pisowifi_auth
iptables -t mangle -A PREROUTING -i $CLIENT_IF -j pisowifi_auth

EOF

# Add NAT if WAN interface is specified
if [ "$WAN_IF" != "none" ] && [ ! -z "$WAN_IF" ]; then
    echo "# NAT for authenticated clients" >> /etc/iptables/ethernet-captive.sh
    echo "iptables -t nat -A POSTROUTING -o $WAN_IF -j MASQUERADE" >> /etc/iptables/ethernet-captive.sh
    
    # Enable IP forwarding
    sysctl -w net.ipv4.ip_forward=1
    sed -i 's/#net.ipv4.ip_forward=1/net.ipv4.ip_forward=1/' /etc/sysctl.conf
fi

chmod +x /etc/iptables/ethernet-captive.sh

# Apply firewall rules
/etc/iptables/ethernet-captive.sh

# Save iptables rules
iptables-save > /etc/iptables/rules.v4

# Stop WiFi-related services
echo "Stopping WiFi services..."
systemctl stop hostapd 2>/dev/null
systemctl disable hostapd 2>/dev/null

# Restart dnsmasq
echo "Restarting services..."
systemctl restart dnsmasq

# Update systemd service for Ethernet
cat > /etc/systemd/system/pisowifi-ethernet.service << EOF
[Unit]
Description=PISOWifi Ethernet Captive Portal
After=network.target

[Service]
Type=oneshot
ExecStart=/etc/iptables/ethernet-captive.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable pisowifi-ethernet
systemctl start pisowifi-ethernet

# Create network status script
cat > /usr/local/bin/pisowifi-status << 'EOF'
#!/bin/bash
echo "PISOWifi Ethernet Portal Status"
echo "================================"
echo ""
echo "Client Interface: $CLIENT_IF"
ip addr show $CLIENT_IF | grep inet
echo ""
echo "Connected Clients:"
arp -n | grep 192.168.100
echo ""
echo "DHCP Leases:"
cat /var/lib/misc/dnsmasq.leases 2>/dev/null || echo "No active leases"
echo ""
echo "Service Status:"
systemctl is-active dnsmasq && echo "  dnsmasq: Active" || echo "  dnsmasq: Inactive"
systemctl is-active pisowifi-ethernet && echo "  captive-portal: Active" || echo "  captive-portal: Inactive"
EOF

chmod +x /usr/local/bin/pisowifi-status

echo ""
echo "====================================="
echo "Ethernet Portal Setup Complete!"
echo "====================================="
echo ""
echo "Configuration Summary:"
echo "  Portal IP: 192.168.100.1"
echo "  Client Interface: $CLIENT_IF"
echo "  DHCP Range: 192.168.100.10 - 200"
echo ""
echo "To check status: pisowifi-status"
echo ""
echo "Connect clients to the $CLIENT_IF interface"
echo "They will be redirected to http://192.168.100.1:3000/portal"
echo ""
echo "Make sure the PISOWifi server is running:"
echo "  cd ~/pisowifi-nextjs && npm start"