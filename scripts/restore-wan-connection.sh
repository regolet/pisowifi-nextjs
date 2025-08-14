#!/bin/bash

# Script to restore WAN connection after network configuration issues

echo "Restoring WAN Connection"
echo "======================="

# Must run as root
if [ "$EUID" -ne 0 ]; then 
    echo "Please run as root: sudo ./restore-wan-connection.sh"
    exit 1
fi

echo "Stopping services that might interfere..."
killall dnsmasq 2>/dev/null || true
systemctl stop dnsmasq 2>/dev/null || true

echo ""
echo "Current network configuration:"
ip addr show | grep -E "^[0-9]|inet "

echo ""
echo "Restoring end0 (WAN) interface..."

# Flush the interface
ip addr flush dev end0

# Restart networking to get DHCP
echo "Restarting network service..."
if command -v netplan >/dev/null 2>&1; then
    # Ubuntu/newer systems
    netplan apply
elif systemctl is-enabled systemd-networkd >/dev/null 2>&1; then
    # systemd-networkd
    systemctl restart systemd-networkd
else
    # Traditional networking
    systemctl restart networking
fi

# If that doesn't work, manually request DHCP
echo "Requesting DHCP lease..."
dhclient -r end0 2>/dev/null || true
dhclient end0

echo ""
echo "Waiting for IP address..."
sleep 5

echo ""
echo "Current end0 status:"
ip addr show end0

echo ""
echo "Testing internet connectivity..."
if ping -c 2 8.8.8.8 >/dev/null 2>&1; then
    echo "✓ Internet connection restored!"
    echo ""
    echo "WAN IP address:"
    ip addr show end0 | grep "inet " | awk '{print $2}'
else
    echo "✗ Still no internet connection"
    echo ""
    echo "Try manual DHCP renewal:"
    echo "  dhclient -r end0 && dhclient end0"
    echo ""
    echo "Or restart networking:"
    echo "  systemctl restart networking"
fi

echo ""
echo "Default route:"
ip route | grep default