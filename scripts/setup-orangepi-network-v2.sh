#!/bin/bash

# PISOWifi Orange Pi Network Setup Script - Version 2
# Updated to support Orange Pi specific interfaces (end0, enx*)

set -e

echo "======================================"
echo "PISOWifi Orange Pi Network Setup v2"
echo "======================================"

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "Please run as root (sudo ./setup-orangepi-network-v2.sh)"
    exit 1
fi

# Configuration variables
PISOWIFI_IP="192.168.100.1"
PISOWIFI_NETWORK="192.168.100.0/24"
DHCP_RANGE_START="192.168.100.10"
DHCP_RANGE_END="192.168.100.50"
PORTAL_PORT="3000"

# Detect network interfaces - updated for Orange Pi
echo "Detecting network interfaces..."
INTERFACE=""
EXTERNAL_INTERFACE=""

# Find PISOWifi interface (for clients)
for iface in enx00e04c68276e end0 eth0 eth1 wlan0; do
    if ip link show $iface &>/dev/null; then
        if [ "$iface" = "end0" ] || [ "$iface" = "eth0" ]; then
            # Built-in ethernet might be external
            if [ -z "$EXTERNAL_INTERFACE" ]; then
                EXTERNAL_INTERFACE=$iface
            fi
        else
            # USB ethernet or WiFi for PISOWifi
            INTERFACE=$iface
            break
        fi
    fi
done

# If we only found one interface, use it for PISOWifi
if [ -z "$INTERFACE" ] && [ -n "$EXTERNAL_INTERFACE" ]; then
    INTERFACE=$EXTERNAL_INTERFACE
    EXTERNAL_INTERFACE=""
fi

if [ -z "$INTERFACE" ]; then
    echo "ERROR: No suitable network interface found!"
    echo "Available interfaces:"
    ip link show | grep -E "^[0-9]" | cut -d: -f2
    echo ""
    echo "Please specify the interface manually:"
    echo "Example: INTERFACE=enx00e04c68276e ./setup-orangepi-network-v2.sh"
    exit 1
fi

echo "Using PISOWifi interface: $INTERFACE"
if [ -n "$EXTERNAL_INTERFACE" ]; then
    echo "Using external interface: $EXTERNAL_INTERFACE"
fi

# Step 1: Install required packages
echo ""
echo "Step 1: Installing required packages..."
apt-get update
apt-get install -y dnsmasq iptables-persistent net-tools

# For WiFi interface
if [[ "$INTERFACE" == wlan* ]]; then
    apt-get install -y hostapd wireless-tools
fi

# Step 2: Stop services temporarily
echo ""
echo "Step 2: Stopping services..."
systemctl stop dnsmasq 2>/dev/null || true
systemctl stop hostapd 2>/dev/null || true
systemctl stop NetworkManager 2>/dev/null || true
systemctl stop systemd-resolved 2>/dev/null || true

# Step 3: Configure network interface
echo ""
echo "Step 3: Configuring network interface..."

# Configure with netplan if available (modern Ubuntu/Debian)
if [ -d /etc/netplan ]; then
    echo "Configuring with netplan..."
    cat > /etc/netplan/99-pisowifi.yaml << EOF
network:
  version: 2
  renderer: networkd
  ethernets:
    $INTERFACE:
      addresses:
        - $PISOWIFI_IP/24
      nameservers:
        addresses: [8.8.8.8, 8.8.4.4]
EOF
    netplan apply 2>/dev/null || true
else
    # Traditional network configuration
    echo "Configuring with /etc/network/interfaces..."
    cp /etc/network/interfaces /etc/network/interfaces.backup 2>/dev/null || true
    cat > /etc/network/interfaces << EOF
auto lo
iface lo inet loopback

# PISOWifi network interface
auto $INTERFACE
iface $INTERFACE inet static
    address $PISOWIFI_IP
    netmask 255.255.255.0
    network 192.168.100.0
    broadcast 192.168.100.255
EOF
fi

# Apply configuration immediately
ip addr flush dev $INTERFACE
ip addr add $PISOWIFI_IP/24 dev $INTERFACE
ip link set $INTERFACE up

echo "Interface $INTERFACE configured with IP $PISOWIFI_IP"

# Step 4: Configure dnsmasq for DHCP and DNS
echo ""
echo "Step 4: Configuring dnsmasq..."

# Disable systemd-resolved if it exists (conflicts with dnsmasq)
systemctl disable systemd-resolved 2>/dev/null || true
systemctl stop systemd-resolved 2>/dev/null || true

# Remove symlink and create new resolv.conf
rm -f /etc/resolv.conf
echo "nameserver 8.8.8.8" > /etc/resolv.conf

# Backup and create new dnsmasq configuration
mv /etc/dnsmasq.conf /etc/dnsmasq.conf.backup 2>/dev/null || true
cat > /etc/dnsmasq.conf << EOF
# PISOWifi DHCP and DNS Configuration
interface=$INTERFACE
bind-interfaces
except-interface=lo

# DNS Settings
server=8.8.8.8
server=8.8.4.4
domain-needed
bogus-priv
no-resolv

# DHCP Configuration
dhcp-range=$DHCP_RANGE_START,$DHCP_RANGE_END,255.255.255.0,12h
dhcp-option=3,$PISOWIFI_IP
dhcp-option=6,$PISOWIFI_IP
dhcp-authoritative

# Lease file
dhcp-leasefile=/var/lib/misc/dnsmasq.leases

# Captive Portal DNS (redirect all domains to portal)
address=/#/$PISOWIFI_IP

# Log for debugging
log-queries
log-dhcp
log-facility=/var/log/dnsmasq.log

# Captive portal detection domains
address=/connectivitycheck.gstatic.com/$PISOWIFI_IP
address=/clients3.google.com/$PISOWIFI_IP
address=/captive.apple.com/$PISOWIFI_IP
address=/www.msftconnecttest.com/$PISOWIFI_IP
address=/detectportal.firefox.com/$PISOWIFI_IP
EOF

# Create log file
touch /var/log/dnsmasq.log
chmod 644 /var/log/dnsmasq.log

# Step 5: Enable IP forwarding
echo ""
echo "Step 5: Enabling IP forwarding..."
echo 1 > /proc/sys/net/ipv4/ip_forward
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

# Allow established connections
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A FORWARD -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow DHCP
iptables -A INPUT -i $INTERFACE -p udp --dport 67:68 -j ACCEPT

# Allow DNS
iptables -A INPUT -i $INTERFACE -p udp --dport 53 -j ACCEPT
iptables -A INPUT -i $INTERFACE -p tcp --dport 53 -j ACCEPT

# Allow HTTP/HTTPS for captive portal
iptables -A INPUT -i $INTERFACE -p tcp --dport 80 -j ACCEPT
iptables -A INPUT -i $INTERFACE -p tcp --dport 443 -j ACCEPT
iptables -A INPUT -i $INTERFACE -p tcp --dport $PORTAL_PORT -j ACCEPT

# Allow SSH
iptables -A INPUT -i $INTERFACE -p tcp --dport 22 -j ACCEPT

# Redirect HTTP traffic to portal
iptables -t nat -A PREROUTING -i $INTERFACE -p tcp --dport 80 -j DNAT --to-destination $PISOWIFI_IP:$PORTAL_PORT

# Allow forwarding (controlled by application)
iptables -A FORWARD -i $INTERFACE -j ACCEPT
if [ -n "$EXTERNAL_INTERFACE" ]; then
    iptables -A FORWARD -i $EXTERNAL_INTERFACE -o $INTERFACE -j ACCEPT
    # NAT for internet access
    iptables -t nat -A POSTROUTING -o $EXTERNAL_INTERFACE -j MASQUERADE
fi

# Save iptables rules
iptables-save > /etc/iptables/rules.v4

# Step 7: Configure hostapd for WiFi (if applicable)
if [[ "$INTERFACE" == wlan* ]]; then
    echo ""
    echo "Step 7: Configuring hostapd for WiFi..."
    
    cat > /etc/hostapd/hostapd.conf << EOF
interface=$INTERFACE
driver=nl80211
ssid=PISOWifi
hw_mode=g
channel=6
wmm_enabled=0
macaddr_acl=0
auth_algs=1
ignore_broadcast_ssid=0
EOF

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

if [[ "$INTERFACE" == wlan* ]]; then
    systemctl restart hostapd
    systemctl enable hostapd
fi

# Check services
sleep 2
echo ""
echo "Service Status:"
echo "---------------"

if systemctl is-active --quiet dnsmasq; then
    echo "✓ dnsmasq (DHCP/DNS) is running"
else
    echo "✗ dnsmasq failed to start"
    journalctl -u dnsmasq -n 20 --no-pager
fi

# Step 10: Test configuration
echo ""
echo "======================================"
echo "PISOWifi Network Setup Complete!"
echo "======================================"
echo ""
echo "Network Configuration:"
echo "  Interface: $INTERFACE"
echo "  IP Address: $PISOWIFI_IP"
echo "  DHCP Range: $DHCP_RANGE_START - $DHCP_RANGE_END"
echo "  Portal Port: $PORTAL_PORT"
echo ""
echo "Next steps:"
echo "1. Start PISOWifi: cd /root/pisowifi-nextjs && npm run server"
echo "2. Enable auto-start: systemctl enable pisowifi"
echo "3. Test connection with a device"
echo ""
echo "Monitor DHCP leases:"
echo "  cat /var/lib/misc/dnsmasq.leases"
echo ""
echo "View logs:"
echo "  tail -f /var/log/dnsmasq.log"
echo ""
echo "If devices still can't connect, check:"
echo "  journalctl -u dnsmasq -f"