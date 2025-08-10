#!/bin/bash

# Fix PISOWifi for Orange Pi with USB Ethernet Adapter

echo "====================================="
echo "Fixing PISOWifi Ethernet Configuration"
echo "====================================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "Please run as root (use sudo)"
    exit 1
fi

echo "Network interfaces found:"
ip link show | grep -E "^[0-9]:" | awk -F': ' '{print "  " $2}'
echo ""

# Your interfaces:
WAN_IF="end0"      # Main internet connection (192.168.1.105)
CLIENT_IF="enx00e04c68276e"  # USB Ethernet for PISOWifi clients (192.168.100.1)

echo "PISOWifi Configuration:"
echo "  Internet (WAN): $WAN_IF (192.168.1.105)"
echo "  Clients (LAN): $CLIENT_IF (192.168.100.1)"
echo ""

# Stop all conflicting services
echo "Stopping conflicting services..."
systemctl stop dnsmasq
systemctl stop hostapd
systemctl disable hostapd
pkill dnsmasq 2>/dev/null

# Remove all old config files
echo "Cleaning old configurations..."
rm -f /etc/dnsmasq.d/pisowifi*.conf

# Create correct dnsmasq configuration
echo "Creating dnsmasq configuration for $CLIENT_IF..."
cat > /etc/dnsmasq.d/pisowifi-final.conf << EOF
# PISOWifi Final Configuration
interface=$CLIENT_IF
bind-interfaces

# DHCP Configuration
dhcp-range=192.168.100.10,192.168.100.200,255.255.255.0,12h
dhcp-option=3,192.168.100.1
dhcp-option=6,192.168.100.1

# DNS Configuration - redirect all to portal
address=/#/192.168.100.1

# Captive Portal Detection
address=/connectivitycheck.gstatic.com/192.168.100.1
address=/connectivitycheck.android.com/192.168.100.1
address=/captive.apple.com/192.168.100.1
address=/www.msftconnecttest.com/192.168.100.1
address=/detectportal.firefox.com/192.168.100.1
address=/clients3.google.com/192.168.100.1

# Upstream DNS for authenticated clients
server=8.8.8.8
server=8.8.4.4

# Logging
log-dhcp
log-queries
log-facility=/var/log/dnsmasq.log
EOF

# Configure client interface
echo "Configuring client interface $CLIENT_IF..."
ip addr flush dev $CLIENT_IF 2>/dev/null
ip addr add 192.168.100.1/24 dev $CLIENT_IF
ip link set $CLIENT_IF up

# Enable IP forwarding
echo "Enabling IP forwarding..."
sysctl -w net.ipv4.ip_forward=1
echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf

# Create iptables rules for PISOWifi
echo "Creating firewall rules..."
cat > /etc/iptables/pisowifi-final.sh << EOF
#!/bin/bash

# PISOWifi Firewall Rules - Final Version

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
iptables -A INPUT -i $CLIENT_IF -p udp --dport 67 -j ACCEPT
iptables -A INPUT -i $CLIENT_IF -p udp --dport 53 -j ACCEPT
iptables -A INPUT -i $CLIENT_IF -p tcp --dport 53 -j ACCEPT

# Allow web server access
iptables -A INPUT -i $CLIENT_IF -p tcp --dport 3000 -j ACCEPT

# Redirect HTTP/HTTPS to portal (unauthenticated clients)
iptables -t nat -A PREROUTING -i $CLIENT_IF -p tcp --dport 80 -j DNAT --to-destination 192.168.100.1:3000
iptables -t nat -A PREROUTING -i $CLIENT_IF -p tcp --dport 443 -j DNAT --to-destination 192.168.100.1:3000

# NAT for authenticated clients (internet access)
iptables -t nat -A POSTROUTING -o $WAN_IF -j MASQUERADE

# Create authentication chain for client management
iptables -t mangle -N pisowifi_auth 2>/dev/null
iptables -t mangle -F pisowifi_auth
iptables -t mangle -A PREROUTING -i $CLIENT_IF -j pisowifi_auth

echo "PISOWifi firewall rules applied"
EOF

chmod +x /etc/iptables/pisowifi-final.sh
/etc/iptables/pisowifi-final.sh

# Save iptables rules
iptables-save > /etc/iptables/rules.v4

# Create systemd service
cat > /etc/systemd/system/pisowifi-final.service << EOF
[Unit]
Description=PISOWifi Final Service
After=network.target

[Service]
Type=oneshot
ExecStart=/etc/iptables/pisowifi-final.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

# Start services
echo "Starting services..."
systemctl daemon-reload
systemctl enable pisowifi-final
systemctl start pisowifi-final

# Start dnsmasq
systemctl start dnsmasq
systemctl enable dnsmasq

# Create status check script
cat > /usr/local/bin/pisowifi-check << EOF
#!/bin/bash
echo "PISOWifi Status Check"
echo "===================="
echo ""
echo "Network Interfaces:"
ip addr show $CLIENT_IF | grep inet
ip addr show $WAN_IF | grep inet
echo ""
echo "Services:"
systemctl is-active dnsmasq && echo "  ✓ dnsmasq: Active" || echo "  ✗ dnsmasq: Inactive"
systemctl is-active pisowifi-final && echo "  ✓ firewall: Active" || echo "  ✗ firewall: Inactive"
echo ""
echo "DHCP Leases:"
cat /var/lib/misc/dnsmasq.leases 2>/dev/null || echo "  No active leases"
echo ""
echo "Connected Devices:"
arp -a | grep 192.168.100 || echo "  No devices connected"
EOF

chmod +x /usr/local/bin/pisowifi-check

echo ""
echo "====================================="
echo "PISOWifi Configuration Complete!"
echo "====================================="
echo ""
echo "Setup Summary:"
echo "  Client Interface: $CLIENT_IF (192.168.100.1)"
echo "  Internet Interface: $WAN_IF (192.168.1.105)"
echo "  DHCP Range: 192.168.100.10 - 192.168.100.200"
echo "  Portal URL: http://192.168.100.1:3000"
echo ""
echo "To check status: pisowifi-check"
echo ""
echo "How to connect clients:"
echo "1. Connect device to $CLIENT_IF via Ethernet cable"
echo "2. Device will get IP automatically (192.168.100.x)"
echo "3. Device will be redirected to portal when browsing"
echo "4. After payment, device gets internet access"
echo ""

# Final status check
echo "Current Status:"
if systemctl is-active --quiet dnsmasq; then
    echo "  ✓ dnsmasq: Running"
else
    echo "  ✗ dnsmasq: Failed"
    echo "    Error: $(systemctl status dnsmasq --no-pager -l | grep -E 'failed|error')"
fi

if systemctl is-active --quiet pisowifi-final; then
    echo "  ✓ firewall: Running"
else
    echo "  ✗ firewall: Failed"
fi

echo ""
echo "Test your setup:"
echo "  1. Connect a device to the USB Ethernet port"
echo "  2. Check if it gets an IP: ping 192.168.100.10"
echo "  3. Try browsing - should redirect to portal"