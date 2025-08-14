#!/bin/bash

# Setup Captive Portal Hijacking
# This script configures DNS and HTTP hijacking for automatic portal detection

echo "Setting up Captive Portal Hijacking"
echo "===================================="

# Must run as root
if [ "$EUID" -ne 0 ]; then 
    echo "Please run as root: sudo ./setup-captive-portal-hijack.sh"
    exit 1
fi

LAN_INTERFACE="enx00e04c68276e"
PORTAL_IP="192.168.100.1"
PORTAL_PORT="3000"

echo "Configuration:"
echo "  LAN Interface: $LAN_INTERFACE"
echo "  Portal IP: $PORTAL_IP"
echo "  Portal Port: $PORTAL_PORT"
echo ""

# Step 1: Setup iptables rules for HTTP/HTTPS interception
echo "Step 1: Setting up HTTP/HTTPS interception..."

# Clear existing NAT rules for our interface
iptables -t nat -D PREROUTING -i $LAN_INTERFACE -p tcp --dport 80 -j DNAT --to-destination $PORTAL_IP:$PORTAL_PORT 2>/dev/null || true
iptables -t nat -D PREROUTING -i $LAN_INTERFACE -p tcp --dport 443 -j DNAT --to-destination $PORTAL_IP:$PORTAL_PORT 2>/dev/null || true

# Add HTTP redirect (port 80 -> portal)
iptables -t nat -A PREROUTING -i $LAN_INTERFACE -p tcp --dport 80 -j DNAT --to-destination $PORTAL_IP:$PORTAL_PORT

# Add HTTPS redirect (port 443 -> portal) 
iptables -t nat -A PREROUTING -i $LAN_INTERFACE -p tcp --dport 443 -j DNAT --to-destination $PORTAL_IP:$PORTAL_PORT

# Allow traffic to portal
iptables -A INPUT -i $LAN_INTERFACE -p tcp --dport $PORTAL_PORT -j ACCEPT

echo "✓ HTTP/HTTPS traffic will be redirected to portal"

# Step 2: Setup DNS hijacking in dnsmasq
echo ""
echo "Step 2: Setting up DNS hijacking..."

# Kill existing dnsmasq
killall dnsmasq 2>/dev/null || true
sleep 1

# Create comprehensive dnsmasq config with DNS hijacking
cat > /tmp/dnsmasq-captive.conf << EOF
# Captive Portal DNS Hijacking Configuration
interface=$LAN_INTERFACE
bind-interfaces
except-interface=lo
except-interface=end0

# DHCP Configuration
dhcp-range=192.168.100.10,192.168.100.50,255.255.255.0,2h
dhcp-option=3,$PORTAL_IP
dhcp-option=6,$PORTAL_IP
dhcp-authoritative

# DNS Hijacking - Redirect ALL domains to portal
address=/#/$PORTAL_IP

# Specific captive portal detection domains
address=/connectivitycheck.gstatic.com/$PORTAL_IP
address=/connectivitycheck.android.com/$PORTAL_IP
address=/clients3.google.com/$PORTAL_IP
address=/captive.apple.com/$PORTAL_IP
address=/www.apple.com/$PORTAL_IP
address=/www.msftconnecttest.com/$PORTAL_IP
address=/www.msftncsi.com/$PORTAL_IP
address=/detectportal.firefox.com/$PORTAL_IP
address=/nmcheck.gnome.org/$PORTAL_IP

# Common domains that devices check
address=/google.com/$PORTAL_IP
address=/www.google.com/$PORTAL_IP
address=/facebook.com/$PORTAL_IP
address=/www.facebook.com/$PORTAL_IP
address=/microsoft.com/$PORTAL_IP
address=/www.microsoft.com/$PORTAL_IP

# Disable upstream DNS for hijacking
no-resolv
bogus-priv

# Logging
log-dhcp
log-queries
dhcp-leasefile=/var/lib/misc/dnsmasq.leases
EOF

# Start dnsmasq with captive portal config
echo "Starting dnsmasq with DNS hijacking..."
dnsmasq -C /tmp/dnsmasq-captive.conf --no-daemon &
DNSMASQ_PID=$!

sleep 2

if ps -p $DNSMASQ_PID > /dev/null; then
    echo "✓ DNS hijacking enabled - all domains redirect to portal"
else
    echo "✗ Failed to start dnsmasq with DNS hijacking"
    exit 1
fi

# Step 3: Setup additional iptables rules for captive portal
echo ""
echo "Step 3: Setting up additional firewall rules..."

# Block internet access for unauthenticated clients (will be controlled by portal)
iptables -A FORWARD -i $LAN_INTERFACE -j DROP

# Allow local traffic (portal, DHCP, DNS)
iptables -A FORWARD -i $LAN_INTERFACE -d 192.168.100.0/24 -j ACCEPT

echo "✓ Internet access blocked - only portal accessible"

# Step 4: Test the setup
echo ""
echo "Step 4: Testing captive portal setup..."

# Test DNS hijacking
echo "Testing DNS hijacking:"
nslookup google.com 192.168.100.1 | grep -A1 "Name:" | grep "$PORTAL_IP" && echo "✓ DNS hijacking working" || echo "✗ DNS hijacking failed"

# Test HTTP redirect
echo ""
echo "Testing HTTP redirect:"
if curl -s -o /dev/null -w "%{http_code}" http://192.168.100.1:3000/generate_204 | grep -q "20[0-9]"; then
    echo "✓ Portal server responding"
else
    echo "✗ Portal server not responding"
fi

# Show current configuration
echo ""
echo "Current Configuration:"
echo "======================"

echo ""
echo "DHCP Leases:"
cat /var/lib/misc/dnsmasq.leases 2>/dev/null || echo "No clients connected yet"

echo ""
echo "NAT Rules:"
iptables -t nat -L PREROUTING -n | grep -E "(80|443|3000)"

echo ""
echo "DNS Server:"
netstat -ulpn | grep :53

echo ""
echo "========================================="
echo "✓ Captive Portal Hijacking Setup Complete!"
echo "========================================="
echo ""
echo "What happens now:"
echo "1. Device connects and gets IP via DHCP"
echo "2. Device tries to access internet"
echo "3. DNS queries redirect to portal IP"
echo "4. HTTP/HTTPS traffic redirects to portal"
echo "5. Device sees captive portal popup!"
echo ""
echo "Test by connecting a device and opening browser"
echo "Monitor with: tail -f /var/log/syslog | grep dnsmasq"
echo ""
echo "Portal URLs:"
echo "  http://192.168.100.1:3000/portal"
echo "  http://192.168.100.1:3000/generate_204 (Android)"
echo "  http://192.168.100.1:3000/hotspot-detect.html (iOS)"