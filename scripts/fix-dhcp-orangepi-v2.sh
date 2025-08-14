#!/bin/bash

# Quick fix for Orange Pi DHCP issues - Version 2
# Supports different interface names including Orange Pi specific ones

echo "PISOWifi DHCP Quick Fix v2"
echo "=========================="

# Must run as root
if [ "$EUID" -ne 0 ]; then 
    echo "Please run as root: sudo ./fix-dhcp-orangepi-v2.sh"
    exit 1
fi

# Kill any conflicting DHCP servers
echo "Stopping conflicting services..."
systemctl stop NetworkManager 2>/dev/null || true
systemctl stop systemd-networkd 2>/dev/null || true
systemctl stop isc-dhcp-server 2>/dev/null || true
killall dnsmasq 2>/dev/null || true

# Detect the network interface - updated for Orange Pi
echo "Detecting network interfaces..."
IFACE=""

# Check for various interface names
for interface in wlan0 eth0 end0 enx00e04c68276e eth1 enp0s3; do
    if ip link show $interface &>/dev/null; then
        # Skip loopback and check if interface is up or can be brought up
        if [ "$interface" != "lo" ]; then
            IFACE=$interface
            echo "Found interface: $IFACE"
            break
        fi
    fi
done

# If no interface found by name, try to find any ethernet interface
if [ -z "$IFACE" ]; then
    # Get first non-loopback interface
    IFACE=$(ip -o link show | awk -F': ' '{print $2}' | grep -v '^lo$' | grep -E '^(en|eth|wlan)' | head -1)
    if [ -n "$IFACE" ]; then
        echo "Auto-detected interface: $IFACE"
    fi
fi

if [ -z "$IFACE" ]; then
    echo "ERROR: No suitable network interface found!"
    echo "Available interfaces:"
    ip link show
    echo ""
    echo "Please specify the interface manually:"
    echo "Example: IFACE=enx00e04c68276e ./fix-dhcp-orangepi-v2.sh"
    exit 1
fi

echo "Using interface: $IFACE"

# Check current interface state
echo "Current interface configuration:"
ip addr show $IFACE

# Configure the interface
echo ""
echo "Configuring network interface..."
ip addr flush dev $IFACE
ip addr add 192.168.100.1/24 dev $IFACE
ip link set $IFACE up

echo "Interface configured with IP 192.168.100.1"

# Enable IP forwarding
echo "Enabling IP forwarding..."
echo 1 > /proc/sys/net/ipv4/ip_forward

# Simple dnsmasq config for DHCP only
echo "Setting up dnsmasq..."
cat > /tmp/dnsmasq-simple.conf << EOF
# Simple DHCP Configuration
interface=$IFACE
bind-interfaces
except-interface=lo
dhcp-range=192.168.100.10,192.168.100.50,255.255.255.0,2h
dhcp-option=3,192.168.100.1
dhcp-option=6,192.168.100.1
dhcp-authoritative
log-dhcp
log-queries
dhcp-leasefile=/var/lib/misc/dnsmasq.leases

# Captive portal DNS hijacking
address=/#/192.168.100.1
EOF

# Create lease file directory if it doesn't exist
mkdir -p /var/lib/misc

# Start dnsmasq with simple config
echo "Starting dnsmasq..."
dnsmasq -C /tmp/dnsmasq-simple.conf --no-daemon &
DNSMASQ_PID=$!

sleep 2

# Check if dnsmasq is running
if ps -p $DNSMASQ_PID > /dev/null; then
    echo ""
    echo "========================================="
    echo "✓ DHCP server is running successfully!"
    echo "========================================="
    echo ""
    echo "Network Configuration:"
    echo "  Interface: $IFACE"
    echo "  Gateway IP: 192.168.100.1"
    echo "  DHCP Range: 192.168.100.10 - 192.168.100.50"
    echo "  DNS Server: 192.168.100.1"
    echo ""
    echo "Devices should now be able to:"
    echo "  1. Connect and get an IP address"
    echo "  2. See the captive portal"
    echo ""
    echo "To monitor DHCP requests:"
    echo "  tail -f /var/log/syslog | grep dnsmasq"
    echo ""
    echo "To see connected clients:"
    echo "  cat /var/lib/misc/dnsmasq.leases"
    echo ""
    echo "To make this permanent, run:"
    echo "  ./scripts/setup-orangepi-network-v2.sh"
else
    echo ""
    echo "✗ Failed to start DHCP server"
    echo ""
    echo "Checking for errors..."
    dnsmasq -C /tmp/dnsmasq-simple.conf --test
    echo ""
    echo "Common issues:"
    echo "1. Port 53 already in use: killall dnsmasq"
    echo "2. Interface not up: ip link set $IFACE up"
    echo "3. Permission denied: run as root"
fi