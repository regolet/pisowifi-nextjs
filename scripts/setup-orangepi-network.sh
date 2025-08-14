#!/bin/bash

# PISOWifi Orange Pi Network Setup Script
# This script sets up the Orange Pi as a gateway with DHCP and captive portal

set -e

echo "======================================"
echo "PISOWifi Orange Pi Network Setup"
echo "======================================"

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "Please run as root (sudo ./setup-orangepi-network.sh)"
    exit 1
fi

# Configuration variables
WIFI_INTERFACE="wlan0"
ETH_INTERFACE="eth0"
PISOWIFI_IP="192.168.100.1"
PISOWIFI_NETWORK="192.168.100.0/24"
DHCP_RANGE_START="192.168.100.10"
DHCP_RANGE_END="192.168.100.50"
PORTAL_PORT="3000"

# Detect network interfaces
echo "Detecting network interfaces..."
if ip link show wlan0 &>/dev/null; then
    INTERFACE="wlan0"
    echo "Using WiFi interface: $INTERFACE"
elif ip link show eth0 &>/dev/null; then
    INTERFACE="eth0"
    echo "Using Ethernet interface: $INTERFACE"
elif ip link show enp0s3 &>/dev/null; then
    INTERFACE="enp0s3"
    echo "Using Ethernet interface: $INTERFACE"
else
    echo "No suitable network interface found!"
    echo "Available interfaces:"
    ip link show
    exit 1
fi

# Step 1: Install required packages
echo ""
echo "Step 1: Installing required packages..."
apt-get update
apt-get install -y dnsmasq hostapd iptables-persistent net-tools wireless-tools

# Step 2: Stop services temporarily
echo ""
echo "Step 2: Stopping services..."
systemctl stop dnsmasq 2>/dev/null || true
systemctl stop hostapd 2>/dev/null || true
systemctl stop NetworkManager 2>/dev/null || true

# Step 3: Configure network interface
echo ""
echo "Step 3: Configuring network interface..."

# Backup existing configuration
cp /etc/network/interfaces /etc/network/interfaces.backup 2>/dev/null || true

# Configure the interface with static IP
cat > /etc/network/interfaces << EOF
# PISOWifi Network Configuration
auto lo
iface lo inet loopback

# External network (to internet)
auto eth0
iface eth0 inet dhcp

# PISOWifi network interface
auto $INTERFACE
iface $INTERFACE inet static
    address $PISOWIFI_IP
    netmask 255.255.255.0
    network 192.168.100.0
    broadcast 192.168.100.255
EOF

# Bring up the interface
ifconfig $INTERFACE down 2>/dev/null || true
ifconfig $INTERFACE $PISOWIFI_IP netmask 255.255.255.0 up
echo "Interface $INTERFACE configured with IP $PISOWIFI_IP"

# Step 4: Configure dnsmasq for DHCP and DNS
echo ""
echo "Step 4: Configuring dnsmasq..."

# Backup existing configuration
mv /etc/dnsmasq.conf /etc/dnsmasq.conf.backup 2>/dev/null || true

# Create new dnsmasq configuration
cat > /etc/dnsmasq.conf << EOF
# PISOWifi DHCP and DNS Configuration
interface=$INTERFACE
bind-interfaces
server=8.8.8.8
server=8.8.4.4
domain-needed
bogus-priv

# DHCP Configuration
dhcp-range=$DHCP_RANGE_START,$DHCP_RANGE_END,255.255.255.0,12h
dhcp-option=3,$PISOWIFI_IP
dhcp-option=6,$PISOWIFI_IP

# Captive Portal DNS
address=/#/$PISOWIFI_IP

# Log queries for debugging
log-queries
log-dhcp

# Lease file
dhcp-leasefile=/var/lib/dnsmasq/dnsmasq.leases

# Enable authoritative mode
dhcp-authoritative

# Set gateway
dhcp-option=option:router,$PISOWIFI_IP

# Captive portal detection domains
address=/connectivitycheck.gstatic.com/$PISOWIFI_IP
address=/clients3.google.com/$PISOWIFI_IP
address=/captive.apple.com/$PISOWIFI_IP
address=/www.apple.com/$PISOWIFI_IP
address=/www.msftconnecttest.com/$PISOWIFI_IP
address=/www.msftncsi.com/$PISOWIFI_IP
address=/detectportal.firefox.com/$PISOWIFI_IP
EOF

# Step 5: Enable IP forwarding
echo ""
echo "Step 5: Enabling IP forwarding..."
echo 1 > /proc/sys/net/ipv4/ip_forward

# Make it permanent
sed -i 's/#net.ipv4.ip_forward=1/net.ipv4.ip_forward=1/' /etc/sysctl.conf
sysctl -p

# Step 6: Setup iptables rules
echo ""
echo "Step 6: Setting up iptables rules..."

# Clear existing rules
iptables -F
iptables -t nat -F
iptables -t mangle -F

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

# Allow DHCP
iptables -A INPUT -i $INTERFACE -p udp --dport 67:68 -j ACCEPT

# Allow DNS
iptables -A INPUT -i $INTERFACE -p udp --dport 53 -j ACCEPT
iptables -A INPUT -i $INTERFACE -p tcp --dport 53 -j ACCEPT

# Allow HTTP for captive portal
iptables -A INPUT -i $INTERFACE -p tcp --dport 80 -j ACCEPT
iptables -A INPUT -i $INTERFACE -p tcp --dport $PORTAL_PORT -j ACCEPT

# Allow SSH from PISOWifi network
iptables -A INPUT -i $INTERFACE -p tcp --dport 22 -j ACCEPT

# Redirect HTTP traffic to portal for non-authenticated clients
iptables -t nat -A PREROUTING -i $INTERFACE -p tcp --dport 80 -j DNAT --to-destination $PISOWIFI_IP:$PORTAL_PORT

# Allow forwarding from PISOWifi network to external (will be controlled by marking)
iptables -A FORWARD -i $INTERFACE -o eth0 -j ACCEPT
iptables -A FORWARD -i eth0 -o $INTERFACE -j ACCEPT

# NAT for internet access (when authenticated)
iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE

# Save iptables rules
iptables-save > /etc/iptables/rules.v4

# Step 7: Configure hostapd (if using WiFi)
if [ "$INTERFACE" = "wlan0" ]; then
    echo ""
    echo "Step 7: Configuring hostapd for WiFi..."
    
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

    # Point to the config file
    sed -i 's|#DAEMON_CONF=""|DAEMON_CONF="/etc/hostapd/hostapd.conf"|' /etc/default/hostapd
fi

# Step 8: Create systemd service for PISOWifi
echo ""
echo "Step 8: Creating systemd service..."

cat > /etc/systemd/system/pisowifi.service << EOF
[Unit]
Description=PISOWifi Server
After=network.target dnsmasq.service

[Service]
Type=simple
User=root
WorkingDirectory=/root/pisowifi-nextjs
ExecStart=/usr/bin/node /root/pisowifi-nextjs/server/app.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=PORT=$PORTAL_PORT

[Install]
WantedBy=multi-user.target
EOF

# Step 9: Start services
echo ""
echo "Step 9: Starting services..."

systemctl daemon-reload
systemctl restart dnsmasq
systemctl enable dnsmasq

if [ "$INTERFACE" = "wlan0" ]; then
    systemctl restart hostapd
    systemctl enable hostapd
fi

# Check dnsmasq status
if systemctl is-active --quiet dnsmasq; then
    echo "✓ dnsmasq is running"
else
    echo "✗ dnsmasq failed to start. Check: journalctl -u dnsmasq -n 50"
fi

# Step 10: Test configuration
echo ""
echo "Step 10: Testing configuration..."

# Show IP configuration
echo "Network configuration:"
ip addr show $INTERFACE

# Show DHCP leases
echo ""
echo "DHCP status:"
if [ -f /var/lib/dnsmasq/dnsmasq.leases ]; then
    echo "DHCP leases file exists"
    cat /var/lib/dnsmasq/dnsmasq.leases
else
    echo "No DHCP leases yet"
fi

# Test DNS
echo ""
echo "Testing DNS resolution:"
nslookup google.com 127.0.0.1 || echo "DNS test failed"

echo ""
echo "======================================"
echo "PISOWifi Network Setup Complete!"
echo "======================================"
echo ""
echo "Network Details:"
echo "  Interface: $INTERFACE"
echo "  IP Address: $PISOWIFI_IP"
echo "  DHCP Range: $DHCP_RANGE_START - $DHCP_RANGE_END"
echo "  Portal URL: http://$PISOWIFI_IP:$PORTAL_PORT/portal"
echo ""
echo "Next steps:"
echo "1. Start PISOWifi server: cd /root/pisowifi-nextjs && npm run server"
echo "2. Or enable auto-start: systemctl enable pisowifi"
echo "3. Connect a device to test DHCP and captive portal"
echo ""
echo "Troubleshooting:"
echo "  Check dnsmasq: journalctl -u dnsmasq -f"
echo "  Check DHCP leases: cat /var/lib/dnsmasq/dnsmasq.leases"
echo "  Check network: ip addr show"
echo "  Test captive portal: curl http://$PISOWIFI_IP:$PORTAL_PORT/generate_204"