#!/bin/bash

# PISOWifi DHCP Quick Fix v3 - Smart Interface Detection
# This version properly separates WAN and LAN interfaces

echo "PISOWifi DHCP Quick Fix v3"
echo "=========================="

# Must run as root
if [ "$EUID" -ne 0 ]; then 
    echo "Please run as root: sudo ./fix-dhcp-orangepi-v3.sh"
    exit 1
fi

# Kill any conflicting DHCP servers
echo "Stopping conflicting services..."
systemctl stop NetworkManager 2>/dev/null || true
systemctl stop systemd-networkd 2>/dev/null || true
systemctl stop isc-dhcp-server 2>/dev/null || true
killall dnsmasq 2>/dev/null || true

echo ""
echo "Current network configuration:"
echo "=============================="
ip addr show | grep -E "^[0-9]|inet "

echo ""
echo "Analyzing interfaces..."

# Detect WAN interface (the one with internet/existing IP)
WAN_INTERFACE=""
LAN_INTERFACE=""

# Check each interface for existing IP configuration
for iface in end0 enx00e04c68276e eth0 eth1; do
    if ip link show $iface &>/dev/null; then
        # Check if interface has an IP in a typical home network range
        if ip addr show $iface | grep -q "inet 192.168.[0-9]"; then
            WAN_INTERFACE=$iface
            echo "✓ WAN Interface (internet): $iface"
        elif ip link show $iface | grep -q "state UP"; then
            if [ -z "$LAN_INTERFACE" ]; then
                LAN_INTERFACE=$iface
                echo "✓ Available for LAN: $iface"
            fi
        fi
    fi
done

# If we don't have a clear LAN interface, use the USB adapter
if [ -z "$LAN_INTERFACE" ]; then
    if ip link show enx00e04c68276e &>/dev/null; then
        LAN_INTERFACE="enx00e04c68276e"
        echo "✓ Using USB adapter for LAN: $LAN_INTERFACE"
    else
        echo "ERROR: No suitable LAN interface found!"
        echo "Available interfaces:"
        ip link show | grep -E "^[0-9]"
        exit 1
    fi
fi

echo ""
echo "Interface Assignment:"
echo "  WAN (Internet): $WAN_INTERFACE (keeping current config)"
echo "  LAN (PISOWifi): $LAN_INTERFACE (configuring for clients)"

# Don't touch the WAN interface!
if [ -n "$WAN_INTERFACE" ]; then
    echo ""
    echo "Preserving WAN interface configuration..."
    echo "Current WAN IP:"
    ip addr show $WAN_INTERFACE | grep "inet "
fi

# Configure LAN interface for PISOWifi
echo ""
echo "Configuring LAN interface for PISOWifi clients..."

# First bring up the interface if it's down
ip link set $LAN_INTERFACE up

# Remove any existing IP (but only from LAN interface)
ip addr flush dev $LAN_INTERFACE

# Add PISOWifi IP to LAN interface
ip addr add 192.168.100.1/24 dev $LAN_INTERFACE

echo "LAN interface $LAN_INTERFACE configured with IP 192.168.100.1"

# Enable IP forwarding
echo "Enabling IP forwarding..."
echo 1 > /proc/sys/net/ipv4/ip_forward

# Setup iptables for routing between LAN and WAN
echo "Setting up routing rules..."
iptables -t nat -F POSTROUTING
iptables -F FORWARD

# Allow forwarding between LAN and WAN
if [ -n "$WAN_INTERFACE" ]; then
    iptables -A FORWARD -i $LAN_INTERFACE -o $WAN_INTERFACE -j ACCEPT
    iptables -A FORWARD -i $WAN_INTERFACE -o $LAN_INTERFACE -m state --state RELATED,ESTABLISHED -j ACCEPT
    
    # NAT for internet access
    iptables -t nat -A POSTROUTING -o $WAN_INTERFACE -j MASQUERADE
    echo "✓ Routing configured: $LAN_INTERFACE ↔ $WAN_INTERFACE"
fi

# Create dnsmasq config for LAN interface only
echo ""
echo "Setting up DHCP on LAN interface..."
cat > /tmp/dnsmasq-pisowifi.conf << EOF
# PISOWifi DHCP Configuration - LAN Interface Only
interface=$LAN_INTERFACE
bind-interfaces
except-interface=lo
except-interface=$WAN_INTERFACE

# DHCP Settings
dhcp-range=192.168.100.10,192.168.100.50,255.255.255.0,2h
dhcp-option=3,192.168.100.1
dhcp-option=6,192.168.100.1
dhcp-authoritative

# DNS Settings
server=8.8.8.8
server=8.8.4.4

# Captive portal DNS hijacking
address=/#/192.168.100.1

# Logging
log-dhcp
log-queries
dhcp-leasefile=/var/lib/misc/dnsmasq.leases
EOF

# Create lease file directory
mkdir -p /var/lib/misc

# Start dnsmasq
echo "Starting DHCP server..."
dnsmasq -C /tmp/dnsmasq-pisowifi.conf --no-daemon &
DNSMASQ_PID=$!

sleep 3

# Check if dnsmasq is running
if ps -p $DNSMASQ_PID > /dev/null; then
    echo ""
    echo "========================================="
    echo "✓ PISOWifi DHCP Setup Successful!"
    echo "========================================="
    echo ""
    echo "Network Configuration:"
    echo "  WAN Interface: $WAN_INTERFACE (unchanged)"
    echo "  LAN Interface: $LAN_INTERFACE (192.168.100.1)"
    echo "  DHCP Range: 192.168.100.10 - 192.168.100.50"
    echo ""
    echo "Current network status:"
    echo ""
    if [ -n "$WAN_INTERFACE" ]; then
        echo "WAN ($WAN_INTERFACE):"
        ip addr show $WAN_INTERFACE | grep "inet "
    fi
    echo ""
    echo "LAN ($LAN_INTERFACE):"
    ip addr show $LAN_INTERFACE | grep "inet "
    echo ""
    echo "Devices connecting to $LAN_INTERFACE should now:"
    echo "  1. Get IP addresses (192.168.100.x)"
    echo "  2. Have internet access through $WAN_INTERFACE"
    echo "  3. See captive portal when browsing"
    echo ""
    echo "To monitor DHCP:"
    echo "  tail -f /var/log/syslog | grep dnsmasq"
    echo ""
    echo "To see connected clients:"
    echo "  cat /var/lib/misc/dnsmasq.leases"
    echo ""
    echo "To start PISOWifi server:"
    echo "  cd /root/pisowifi-nextjs && npm run server"
else
    echo ""
    echo "✗ Failed to start DHCP server"
    echo ""
    echo "Debugging information:"
    dnsmasq -C /tmp/dnsmasq-pisowifi.conf --test
    echo ""
    echo "Check for conflicts:"
    netstat -tulpn | grep :53
fi