#!/bin/bash

# Quick fix for Orange Pi DHCP issues
# Run this on your Orange Pi to fix "obtaining IP address" problem

echo "PISOWifi DHCP Quick Fix"
echo "======================"

# Must run as root
if [ "$EUID" -ne 0 ]; then 
    echo "Please run as root: sudo ./fix-dhcp-orangepi.sh"
    exit 1
fi

# Kill any conflicting DHCP servers
echo "Stopping conflicting services..."
systemctl stop NetworkManager 2>/dev/null || true
systemctl stop systemd-networkd 2>/dev/null || true
systemctl stop isc-dhcp-server 2>/dev/null || true
killall dnsmasq 2>/dev/null || true

# Detect the network interface
if ip link show wlan0 &>/dev/null; then
    IFACE="wlan0"
elif ip link show eth0 &>/dev/null; then
    IFACE="eth0"
else
    echo "No suitable interface found!"
    exit 1
fi

echo "Using interface: $IFACE"

# Configure the interface
echo "Configuring network interface..."
ip addr flush dev $IFACE
ip addr add 192.168.100.1/24 dev $IFACE
ip link set $IFACE up

# Simple dnsmasq config for DHCP only
echo "Setting up dnsmasq..."
cat > /tmp/dnsmasq-simple.conf << EOF
# Simple DHCP Configuration
interface=$IFACE
bind-interfaces
dhcp-range=192.168.100.10,192.168.100.50,255.255.255.0,2h
dhcp-option=3,192.168.100.1
dhcp-option=6,192.168.100.1
dhcp-authoritative
log-dhcp
EOF

# Start dnsmasq with simple config
echo "Starting dnsmasq..."
dnsmasq -C /tmp/dnsmasq-simple.conf --no-daemon &
DNSMASQ_PID=$!

sleep 2

# Check if dnsmasq is running
if ps -p $DNSMASQ_PID > /dev/null; then
    echo "✓ DHCP server is running"
    echo ""
    echo "DHCP Configuration:"
    echo "  Interface: $IFACE (192.168.100.1)"
    echo "  DHCP Range: 192.168.100.10 - 192.168.100.50"
    echo ""
    echo "Now devices should be able to get IP addresses!"
    echo ""
    echo "To monitor DHCP requests:"
    echo "  tail -f /var/log/syslog | grep dnsmasq"
    echo ""
    echo "To see connected clients:"
    echo "  cat /var/lib/misc/dnsmasq.leases"
else
    echo "✗ Failed to start DHCP server"
    echo "Check for errors:"
    dnsmasq -C /tmp/dnsmasq-simple.conf --test
fi