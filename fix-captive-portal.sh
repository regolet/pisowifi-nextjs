#!/bin/bash

# PISOWifi Captive Portal Fix Script for Orange Pi
# This script fixes common issues with the captive portal setup

echo "====================================="
echo "PISOWifi Captive Portal Fix"
echo "====================================="

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "Please run as root (use sudo)"
    exit 1
fi

# Fix 1: Unmask and enable hostapd service
echo "Fixing hostapd service..."
systemctl unmask hostapd
systemctl enable hostapd

# Fix 2: Create network interfaces directory if it doesn't exist
echo "Fixing network configuration..."
mkdir -p /etc/network/interfaces.d/

# Check if using NetworkManager or systemd-networkd
if systemctl is-active --quiet NetworkManager; then
    echo "NetworkManager detected. Creating connection profile..."
    
    # Create NetworkManager connection for AP mode
    nmcli con delete "PISOWifi-AP" 2>/dev/null || true
    nmcli con add type wifi ifname wlan0 con-name "PISOWifi-AP" autoconnect yes \
        ssid "PISOWifi" mode ap \
        ipv4.method shared \
        ipv4.addresses 192.168.100.1/24 \
        ipv6.method disabled
    
    echo "NetworkManager profile created."
    
elif systemctl is-active --quiet systemd-networkd; then
    echo "systemd-networkd detected. Creating network configuration..."
    
    # Create systemd-networkd configuration
    cat > /etc/systemd/network/10-wlan0.network << EOF
[Match]
Name=wlan0

[Network]
Address=192.168.100.1/24
DHCPServer=no
IPForward=yes

[Link]
RequiredForOnline=no
EOF
    
    systemctl restart systemd-networkd
    echo "systemd-networkd configuration created."
    
else
    echo "Using traditional networking. Creating interface configuration..."
    
    # Traditional networking configuration
    cat > /etc/network/interfaces.d/wlan0 << EOF
auto wlan0
iface wlan0 inet static
    address 192.168.100.1
    netmask 255.255.255.0
    network 192.168.100.0
    broadcast 192.168.100.255
    wireless-mode Master
    wireless-essid PISOWifi
EOF
fi

# Fix 3: Update hostapd configuration with proper driver
echo "Updating hostapd configuration..."
cat > /etc/hostapd/hostapd.conf << EOF
interface=wlan0
# Try auto driver detection first
driver=nl80211
ssid=PISOWifi
hw_mode=g
channel=6
wmm_enabled=0
macaddr_acl=0
auth_algs=1
ignore_broadcast_ssid=0
# Add these for better compatibility
ieee80211n=1
ht_capab=[HT40][SHORT-GI-20][DSSS_CCK-40]
EOF

# Fix 4: Ensure hostapd daemon config is set
echo "Updating hostapd daemon configuration..."
if [ -f /etc/default/hostapd ]; then
    sed -i 's|#DAEMON_CONF=.*|DAEMON_CONF="/etc/hostapd/hostapd.conf"|' /etc/default/hostapd
    sed -i 's|DAEMON_CONF=.*|DAEMON_CONF="/etc/hostapd/hostapd.conf"|' /etc/default/hostapd
else
    echo 'DAEMON_CONF="/etc/hostapd/hostapd.conf"' > /etc/default/hostapd
fi

# Fix 5: Check and configure wireless interface
echo "Checking wireless interface..."
WLAN_INTERFACE=$(iw dev | awk '$1=="Interface"{print $2}' | head -1)

if [ -z "$WLAN_INTERFACE" ]; then
    echo "WARNING: No wireless interface found!"
    echo "Please check if your WiFi adapter is properly connected."
else
    echo "Found wireless interface: $WLAN_INTERFACE"
    
    # Update hostapd.conf with correct interface
    sed -i "s/interface=.*/interface=$WLAN_INTERFACE/" /etc/hostapd/hostapd.conf
    
    # Bring interface up
    ip link set $WLAN_INTERFACE up
    
    # Set IP address
    ip addr flush dev $WLAN_INTERFACE
    ip addr add 192.168.100.1/24 dev $WLAN_INTERFACE
fi

# Fix 6: Update dnsmasq configuration
echo "Updating dnsmasq configuration..."
cat > /etc/dnsmasq.d/pisowifi.conf << EOF
# PISOWifi DHCP Configuration
interface=${WLAN_INTERFACE:-wlan0}
bind-interfaces
dhcp-range=192.168.100.10,192.168.100.200,255.255.255.0,12h
dhcp-option=3,192.168.100.1
dhcp-option=6,192.168.100.1

# Captive portal detection responses
address=/connectivitycheck.gstatic.com/192.168.100.1
address=/connectivitycheck.android.com/192.168.100.1
address=/captive.apple.com/192.168.100.1
address=/www.msftconnecttest.com/192.168.100.1
address=/detectportal.firefox.com/192.168.100.1
address=/clients3.google.com/192.168.100.1
address=/www.gstatic.com/192.168.100.1

# Catch all DNS requests and redirect to portal
address=/#/192.168.100.1

# Logging
log-dhcp
log-queries
log-facility=/var/log/dnsmasq.log
EOF

# Fix 7: Restart services in correct order
echo "Restarting services..."
systemctl stop NetworkManager 2>/dev/null || true
systemctl stop dnsmasq
systemctl stop hostapd

# Start services
systemctl start hostapd
sleep 2
systemctl start dnsmasq
systemctl start pisowifi-captive 2>/dev/null || true

# Fix 8: Check service status
echo ""
echo "====================================="
echo "Service Status Check"
echo "====================================="

# Check hostapd
if systemctl is-active --quiet hostapd; then
    echo "✓ hostapd: Running"
else
    echo "✗ hostapd: Not running"
    echo "  Checking error: "
    journalctl -xe -u hostapd --no-pager | tail -5
fi

# Check dnsmasq
if systemctl is-active --quiet dnsmasq; then
    echo "✓ dnsmasq: Running"
else
    echo "✗ dnsmasq: Not running"
    echo "  Checking error: "
    journalctl -xe -u dnsmasq --no-pager | tail -5
fi

# Check iptables rules
if iptables -t nat -L PREROUTING -n | grep -q "192.168.100.1:3000"; then
    echo "✓ iptables: Captive portal rules active"
else
    echo "✗ iptables: Captive portal rules not found"
    echo "  Applying rules..."
    /etc/iptables/captive-portal.sh
fi

echo ""
echo "====================================="
echo "Fix Complete!"
echo "====================================="
echo ""
echo "If services are still not running, try:"
echo "  1. Check logs: journalctl -xe -u hostapd"
echo "  2. Test hostapd manually: hostapd -dd /etc/hostapd/hostapd.conf"
echo "  3. Check WiFi adapter: iw list"
echo ""
echo "To view connected clients: iw dev $WLAN_INTERFACE station dump"
echo "To view DHCP leases: cat /var/lib/misc/dnsmasq.leases"