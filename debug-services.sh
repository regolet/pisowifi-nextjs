#!/bin/bash

# PISOWifi Service Debug Script
# This script diagnoses why services are not starting

echo "====================================="
echo "PISOWifi Service Diagnostic"
echo "====================================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "Please run as root (use sudo)"
    exit 1
fi

echo "1. Checking service status..."
echo "-----------------------------------"
systemctl status dnsmasq --no-pager -l
echo ""
systemctl status hostapd --no-pager -l
echo ""

echo "2. Checking for port conflicts..."
echo "-----------------------------------"
echo "Port 53 (DNS):"
netstat -tulpn | grep :53 || echo "Port 53 is free"
echo ""
echo "Port 67 (DHCP):"
netstat -tulpn | grep :67 || echo "Port 67 is free"
echo ""

echo "3. Checking configuration files..."
echo "-----------------------------------"
echo "dnsmasq config:"
if [ -f /etc/dnsmasq.d/pisowifi.conf ]; then
    echo "  /etc/dnsmasq.d/pisowifi.conf exists"
    cat /etc/dnsmasq.d/pisowifi.conf
else
    echo "  /etc/dnsmasq.d/pisowifi.conf missing"
fi
echo ""

if [ -f /etc/dnsmasq.d/pisowifi-eth.conf ]; then
    echo "  /etc/dnsmasq.d/pisowifi-eth.conf exists"
    cat /etc/dnsmasq.d/pisowifi-eth.conf
else
    echo "  /etc/dnsmasq.d/pisowifi-eth.conf missing"
fi
echo ""

echo "hostapd config:"
if [ -f /etc/hostapd/hostapd.conf ]; then
    echo "  /etc/hostapd/hostapd.conf exists"
    cat /etc/hostapd/hostapd.conf
else
    echo "  /etc/hostapd/hostapd.conf missing"
fi
echo ""

echo "4. Checking network interfaces..."
echo "-----------------------------------"
ip addr show
echo ""

echo "5. Checking for conflicting services..."
echo "-----------------------------------"
systemctl list-units --state=active | grep -E "network|dhcp|dns" || echo "No conflicting services found"
echo ""

echo "6. Checking recent service logs..."
echo "-----------------------------------"
echo "dnsmasq logs:"
journalctl -xe -u dnsmasq --no-pager | tail -20
echo ""
echo "hostapd logs:"
journalctl -xe -u hostapd --no-pager | tail -20
echo ""

echo "7. Testing configurations..."
echo "-----------------------------------"
echo "Testing dnsmasq config:"
dnsmasq --test --conf-file=/etc/dnsmasq.conf 2>&1 || echo "dnsmasq config test failed"
echo ""

echo "Testing hostapd config:"
hostapd -t /etc/hostapd/hostapd.conf 2>&1 || echo "hostapd config test failed"
echo ""

echo "====================================="
echo "Attempting fixes..."
echo "====================================="

# Fix 1: Stop NetworkManager if it's interfering
if systemctl is-active --quiet NetworkManager; then
    echo "Stopping NetworkManager (it may interfere with hostapd)..."
    systemctl stop NetworkManager
fi

# Fix 2: Stop systemd-resolved if it's using port 53
if systemctl is-active --quiet systemd-resolved; then
    echo "Stopping systemd-resolved (conflicts with dnsmasq on port 53)..."
    systemctl stop systemd-resolved
fi

# Fix 3: Kill any existing dnsmasq processes
echo "Killing existing dnsmasq processes..."
pkill dnsmasq 2>/dev/null || echo "No existing dnsmasq processes"

# Fix 4: Kill any existing hostapd processes  
echo "Killing existing hostapd processes..."
pkill hostapd 2>/dev/null || echo "No existing hostapd processes"

# Fix 5: Create minimal working dnsmasq config
echo "Creating minimal dnsmasq config..."
cat > /etc/dnsmasq.d/pisowifi-minimal.conf << 'EOF'
# Minimal PISOWifi configuration
port=53
interface=eth0
bind-interfaces
dhcp-range=192.168.100.10,192.168.100.200,255.255.255.0,12h
dhcp-option=3,192.168.100.1
dhcp-option=6,192.168.100.1
address=/#/192.168.100.1
no-resolv
server=8.8.8.8
log-queries
log-dhcp
EOF

# Fix 6: Configure network interface
echo "Configuring eth0 interface..."
ip addr flush dev eth0 2>/dev/null
ip addr add 192.168.100.1/24 dev eth0
ip link set eth0 up

# Fix 7: Try to start dnsmasq manually
echo "Attempting to start dnsmasq manually..."
dnsmasq --conf-file=/etc/dnsmasq.conf --conf-dir=/etc/dnsmasq.d --pid-file=/run/dnsmasq/dnsmasq.pid

# Check if it's running
sleep 2
if pgrep dnsmasq > /dev/null; then
    echo "✓ dnsmasq is now running"
else
    echo "✗ dnsmasq failed to start"
    echo "Trying with minimal config only..."
    dnsmasq -C /etc/dnsmasq.d/pisowifi-minimal.conf --no-daemon &
    sleep 1
    if pgrep dnsmasq > /dev/null; then
        echo "✓ dnsmasq started with minimal config"
    else
        echo "✗ dnsmasq still failing"
    fi
fi

echo ""
echo "====================================="
echo "Final Status Check"
echo "====================================="

# Check final status
if pgrep dnsmasq > /dev/null; then
    echo "✓ dnsmasq: Running (PID: $(pgrep dnsmasq))"
else
    echo "✗ dnsmasq: Not running"
fi

if pgrep hostapd > /dev/null; then
    echo "✓ hostapd: Running (PID: $(pgrep hostapd))"
else
    echo "✗ hostapd: Not running (WiFi not available)"
fi

echo ""
echo "Network status:"
ip addr show eth0 2>/dev/null | grep inet || echo "eth0 not configured"

echo ""
echo "Listening ports:"
netstat -tulpn | grep -E ":53|:67" || echo "No DNS/DHCP ports listening"

echo ""
echo "====================================="
echo "Recommendations"
echo "====================================="
echo ""
echo "Based on this diagnosis:"
echo ""
echo "1. If dnsmasq is working: Your DHCP/DNS should work via Ethernet"
echo "2. If hostapd failed: Use Ethernet instead of WiFi"
echo "3. Connect clients to eth0 interface"
echo "4. Clients should get IP: 192.168.100.10-200"
echo "5. Portal should be accessible at: http://192.168.100.1:3000"
echo ""
echo "To test: Connect a device to eth0 and check if it gets an IP address"