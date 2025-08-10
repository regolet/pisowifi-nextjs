#!/bin/bash

# PISOWifi Captive Portal Setup Script for Orange Pi
# This script configures the network for captive portal operation

echo "====================================="
echo "PISOWifi Captive Portal Setup"
echo "====================================="

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "Please run as root (use sudo)"
    exit 1
fi

# Install required packages
echo "Installing required packages..."
apt-get update
apt-get install -y dnsmasq hostapd iptables-persistent

# Stop services during configuration
systemctl stop dnsmasq
systemctl stop hostapd

# Configure network interface
echo "Configuring network interface..."
cat > /etc/network/interfaces.d/wlan0 << EOF
auto wlan0
iface wlan0 inet static
    address 192.168.100.1
    netmask 255.255.255.0
    network 192.168.100.0
    broadcast 192.168.100.255
EOF

# Configure hostapd for access point
echo "Configuring access point..."
cat > /etc/hostapd/hostapd.conf << EOF
interface=wlan0
driver=nl80211
ssid=PISOWifi
hw_mode=g
channel=6
wmm_enabled=0
macaddr_acl=0
auth_algs=1
ignore_broadcast_ssid=0
EOF

# Update hostapd default config
sed -i 's/#DAEMON_CONF=""/DAEMON_CONF="\/etc\/hostapd\/hostapd.conf"/' /etc/default/hostapd

# Configure dnsmasq for DHCP and DNS
echo "Configuring DHCP and DNS..."
cat > /etc/dnsmasq.d/pisowifi.conf << EOF
# PISOWifi DHCP Configuration
interface=wlan0
dhcp-range=192.168.100.10,192.168.100.200,255.255.255.0,12h
dhcp-option=3,192.168.100.1
dhcp-option=6,192.168.100.1

# Captive portal detection - redirect all domains to our server
address=/#/192.168.100.1

# Log DHCP requests
log-dhcp
log-queries
log-facility=/var/log/dnsmasq.log
EOF

# Enable IP forwarding
echo "Enabling IP forwarding..."
sed -i 's/#net.ipv4.ip_forward=1/net.ipv4.ip_forward=1/' /etc/sysctl.conf
sysctl -w net.ipv4.ip_forward=1

# Configure iptables for captive portal
echo "Configuring firewall rules..."
cat > /etc/iptables/captive-portal.sh << 'EOF'
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
iptables -A OUTPUT -o lo -j ACCEPT

# Allow established connections
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A FORWARD -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow DHCP and DNS
iptables -A INPUT -i wlan0 -p udp --dport 67:68 -j ACCEPT
iptables -A INPUT -i wlan0 -p udp --dport 53 -j ACCEPT
iptables -A INPUT -i wlan0 -p tcp --dport 53 -j ACCEPT

# Allow access to web server (port 3000)
iptables -A INPUT -i wlan0 -p tcp --dport 3000 -j ACCEPT

# Redirect HTTP traffic to portal
iptables -t nat -A PREROUTING -i wlan0 -p tcp --dport 80 -j DNAT --to-destination 192.168.100.1:3000
iptables -t nat -A PREROUTING -i wlan0 -p tcp --dport 443 -j DNAT --to-destination 192.168.100.1:3000

# NAT for authenticated clients (will be added dynamically)
iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE

# Create chain for authenticated clients
iptables -t mangle -N pisowifi_auth 2>/dev/null || iptables -t mangle -F pisowifi_auth
iptables -t mangle -A PREROUTING -i wlan0 -j pisowifi_auth
EOF

chmod +x /etc/iptables/captive-portal.sh

# Apply firewall rules
/etc/iptables/captive-portal.sh

# Save iptables rules
iptables-save > /etc/iptables/rules.v4

# Create systemd service for captive portal
echo "Creating systemd service..."
cat > /etc/systemd/system/pisowifi-captive.service << EOF
[Unit]
Description=PISOWifi Captive Portal
After=network.target

[Service]
Type=oneshot
ExecStart=/etc/iptables/captive-portal.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

# Enable services
echo "Enabling services..."
systemctl daemon-reload
systemctl enable hostapd
systemctl enable dnsmasq
systemctl enable pisowifi-captive

# Start services
echo "Starting services..."
systemctl start hostapd
systemctl start dnsmasq
systemctl start pisowifi-captive

# Create directories for PISOWifi
mkdir -p /etc/pisowifi
mkdir -p /var/log/pisowifi

echo "====================================="
echo "Captive Portal Setup Complete!"
echo "====================================="
echo ""
echo "Access Point SSID: PISOWifi"
echo "Gateway IP: 192.168.100.1"
echo "DHCP Range: 192.168.100.10 - 192.168.100.200"
echo ""
echo "To authenticate a client, use:"
echo "  iptables -t mangle -A pisowifi_auth -m mac --mac-source XX:XX:XX:XX:XX:XX -j MARK --set-mark 0x1"
echo "  iptables -I FORWARD -m mac --mac-source XX:XX:XX:XX:XX:XX -j ACCEPT"
echo ""
echo "Please restart your Orange Pi for all changes to take effect."