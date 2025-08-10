#!/bin/bash

# PISOWifi Captive Portal Network Setup Script
# This script configures the Orange Pi as a captive portal hotspot

set -e

# Configuration
INTERFACE="wlan0"           # WiFi interface (change if using USB WiFi adapter)
ETHERNET_INTERFACE="eth0"   # Ethernet interface for internet connection
HOTSPOT_IP="192.168.100.1"
HOTSPOT_NETWORK="192.168.100.0/24"
DHCP_START="192.168.100.10"
DHCP_END="192.168.100.100"
PORTAL_PORT="3000"
PORTAL_URL="http://192.168.100.1:3000/portal"

echo "🚀 PISOWifi Captive Portal Network Setup"
echo "========================================"

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "❌ Please run as root: sudo $0"
    exit 1
fi

echo "📦 Installing required packages..."
apt-get update
apt-get install -y hostapd dnsmasq iptables-persistent nginx

echo "🛑 Stopping services..."
systemctl stop hostapd
systemctl stop dnsmasq
systemctl stop nginx

echo "📡 Configuring hostapd (WiFi Access Point)..."
cat > /etc/hostapd/hostapd.conf << EOF
interface=$INTERFACE
driver=nl80211
ssid=PISOWifi-Free
hw_mode=g
channel=7
wmm_enabled=0
macaddr_acl=0
auth_algs=1
ignore_broadcast_ssid=0
wpa=0
EOF

# Configure hostapd daemon
echo 'DAEMON_CONF="/etc/hostapd/hostapd.conf"' > /etc/default/hostapd

echo "🌐 Configuring dnsmasq (DHCP + DNS)..."
# Backup original config
cp /etc/dnsmasq.conf /etc/dnsmasq.conf.backup

cat > /etc/dnsmasq.conf << EOF
# PISOWifi Captive Portal DNS Configuration

# Interface to bind to
interface=$INTERFACE

# Don't forward short names
domain-needed

# Never forward addresses in the non-routed address spaces
bogus-priv

# Don't read /etc/resolv.conf or any other file
no-resolv

# Don't poll /etc/resolv.conf for changes
no-poll

# Log queries
log-queries

# Log DHCP transactions
log-dhcp

# DHCP range
dhcp-range=$DHCP_START,$DHCP_END,12h

# Set gateway (this device)
dhcp-option=3,$HOTSPOT_IP

# Set DNS servers (this device)
dhcp-option=6,$HOTSPOT_IP

# Captive Portal DNS Hijacking
# Redirect ALL DNS queries to portal
address=/#/$HOTSPOT_IP

# Specifically handle captive portal detection
address=/captive.apple.com/$HOTSPOT_IP
address=/www.apple.com/$HOTSPOT_IP
address=/gstatic.com/$HOTSPOT_IP
address=/connectivitycheck.gstatic.com/$HOTSPOT_IP
address=/connectivitycheck.android.com/$HOTSPOT_IP
address=/clients3.google.com/$HOTSPOT_IP
address=/generate_204/$HOTSPOT_IP
address=/ncsi.msftconnecttest.com/$HOTSPOT_IP
address=/www.msftconnecttest.com/$HOTSPOT_IP
address=/ipv6.msftconnecttest.com/$HOTSPOT_IP

# Never forward plain names (without a dot or domain part)
domain-needed
EOF

echo "🔗 Configuring network interface..."
# Configure static IP for hotspot interface
cat > /etc/systemd/network/10-$INTERFACE.network << EOF
[Match]
Name=$INTERFACE

[Network]
Address=$HOTSPOT_IP/24
IPMasquerade=true
IPForward=true
EOF

echo "🔥 Configuring iptables (Firewall Rules)..."

# Clear existing rules
iptables -F
iptables -X
iptables -t nat -F
iptables -t nat -X
iptables -t mangle -F
iptables -t mangle -X

# Enable IP forwarding
echo 1 > /proc/sys/net/ipv4/ip_forward
echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.conf

# NAT rules for internet sharing
iptables -t nat -A POSTROUTING -o $ETHERNET_INTERFACE -j MASQUERADE
iptables -A FORWARD -i $ETHERNET_INTERFACE -o $INTERFACE -m state --state RELATED,ESTABLISHED -j ACCEPT
iptables -A FORWARD -i $INTERFACE -o $ETHERNET_INTERFACE -j ACCEPT

# Captive Portal Rules
# Create custom chains
iptables -t nat -N CAPTIVE_PORTAL
iptables -t mangle -N CAPTIVE_PORTAL

# Redirect HTTP traffic to captive portal (except for authenticated clients)
iptables -t nat -A PREROUTING -i $INTERFACE -p tcp --dport 80 -j CAPTIVE_PORTAL
iptables -t nat -A CAPTIVE_PORTAL -j DNAT --to-destination $HOTSPOT_IP:$PORTAL_PORT

# Block HTTPS until authenticated (will show browser warnings)
iptables -t mangle -A PREROUTING -i $INTERFACE -p tcp --dport 443 -j CAPTIVE_PORTAL
iptables -t mangle -A CAPTIVE_PORTAL -j MARK --set-mark 99
iptables -A FORWARD -m mark --mark 99 -j REJECT --reject-with tcp-reset

# Allow access to captive portal
iptables -I FORWARD -i $INTERFACE -d $HOTSPOT_IP -j ACCEPT

# Allow DNS queries to this device
iptables -A INPUT -i $INTERFACE -p udp --dport 53 -j ACCEPT
iptables -A INPUT -i $INTERFACE -p tcp --dport 53 -j ACCEPT

# Allow DHCP
iptables -A INPUT -i $INTERFACE -p udp --dport 67 -j ACCEPT

# Allow captive portal web server
iptables -A INPUT -i $INTERFACE -p tcp --dport $PORTAL_PORT -j ACCEPT

# Save iptables rules
iptables-save > /etc/iptables/rules.v4

echo "🌍 Configuring Nginx for captive portal..."
cat > /etc/nginx/sites-available/captive-portal << EOF
server {
    listen 80 default_server;
    server_name _;
    
    # Captive portal detection endpoints
    location = /generate_204 {
        return 302 $PORTAL_URL;
    }
    
    location = /connecttest.txt {
        return 302 $PORTAL_URL;
    }
    
    location = /redirect {
        return 302 $PORTAL_URL;
    }
    
    # Apple captive portal
    location /hotspot-detect.html {
        return 302 $PORTAL_URL;
    }
    
    # Android captive portal
    location /generate_204 {
        return 302 $PORTAL_URL;
    }
    
    # Microsoft captive portal
    location /connecttest.txt {
        return 302 $PORTAL_URL;
    }
    
    location /ncsi.txt {
        return 302 $PORTAL_URL;
    }
    
    # Redirect all other HTTP traffic
    location / {
        return 302 $PORTAL_URL;
    }
}
EOF

# Enable the site
ln -sf /etc/nginx/sites-available/captive-portal /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

echo "🔧 Creating management scripts..."

# Create script to add authenticated client
cat > /usr/local/bin/pisowifi-allow-client << 'EOF'
#!/bin/bash
MAC_ADDRESS=$1
if [ -z "$MAC_ADDRESS" ]; then
    echo "Usage: $0 <MAC_ADDRESS>"
    exit 1
fi

# Allow this MAC address to bypass captive portal
iptables -t nat -I CAPTIVE_PORTAL -m mac --mac-source $MAC_ADDRESS -j RETURN
iptables -t mangle -I CAPTIVE_PORTAL -m mac --mac-source $MAC_ADDRESS -j RETURN

echo "✅ Client $MAC_ADDRESS authenticated and allowed internet access"
EOF

# Create script to remove authenticated client
cat > /usr/local/bin/pisowifi-block-client << 'EOF'
#!/bin/bash
MAC_ADDRESS=$1
if [ -z "$MAC_ADDRESS" ]; then
    echo "Usage: $0 <MAC_ADDRESS>"
    exit 1
fi

# Remove rules allowing this MAC address
iptables -t nat -D CAPTIVE_PORTAL -m mac --mac-source $MAC_ADDRESS -j RETURN 2>/dev/null || true
iptables -t mangle -D CAPTIVE_PORTAL -m mac --mac-source $MAC_ADDRESS -j RETURN 2>/dev/null || true

echo "❌ Client $MAC_ADDRESS blocked from internet access"
EOF

# Create script to list authenticated clients
cat > /usr/local/bin/pisowifi-list-clients << 'EOF'
#!/bin/bash
echo "📋 Authenticated clients:"
iptables -t nat -L CAPTIVE_PORTAL -n | grep "MAC" | awk '{print $7}' | sort | uniq
EOF

chmod +x /usr/local/bin/pisowifi-*

echo "🚀 Starting services..."
systemctl enable hostapd
systemctl enable dnsmasq  
systemctl enable nginx
systemctl enable systemd-networkd

systemctl start systemd-networkd
sleep 2
systemctl start hostapd
sleep 2
systemctl start dnsmasq
systemctl start nginx

echo "✅ Captive Portal Setup Complete!"
echo "=================================="
echo "📡 WiFi Network: PISOWifi-Free"
echo "🌐 Portal IP: $HOTSPOT_IP"
echo "🔗 Portal URL: $PORTAL_URL"
echo ""
echo "📋 Management Commands:"
echo "  pisowifi-allow-client <MAC>   - Allow client internet access"
echo "  pisowifi-block-client <MAC>   - Block client internet access"  
echo "  pisowifi-list-clients         - List authenticated clients"
echo ""
echo "🔄 To restart services:"
echo "  sudo systemctl restart hostapd dnsmasq nginx"
echo ""
echo "📊 Check status:"
echo "  sudo systemctl status hostapd"
echo "  sudo systemctl status dnsmasq"
echo "  sudo iptables -t nat -L CAPTIVE_PORTAL"

# Test connectivity
echo "🧪 Testing network configuration..."
ping -c 1 8.8.8.8 > /dev/null && echo "✅ Internet connectivity: OK" || echo "❌ Internet connectivity: FAILED"

# Show interface status
echo "📡 Network interfaces:"
ip addr show $INTERFACE 2>/dev/null && echo "✅ WiFi interface: OK" || echo "❌ WiFi interface: NOT FOUND"
ip addr show $ETHERNET_INTERFACE 2>/dev/null && echo "✅ Ethernet interface: OK" || echo "❌ Ethernet interface: NOT FOUND"