#!/bin/bash

# Fix dnsmasq interface configuration
echo "Fixing dnsmasq interface configuration"
echo "======================================"

# Kill any existing dnsmasq
killall dnsmasq 2>/dev/null || true
sleep 2

# Create correct dnsmasq configuration
cat > /tmp/dnsmasq-fixed.conf << 'EOF'
interface=enx00e04c68276e
bind-interfaces
except-interface=lo
except-interface=end0
dhcp-range=192.168.100.10,192.168.100.50,255.255.255.0,2h
dhcp-option=3,192.168.100.1
dhcp-option=6,192.168.100.1
dhcp-authoritative
server=8.8.8.8
server=8.8.4.4
address=/#/192.168.100.1
log-dhcp
log-queries
dhcp-leasefile=/var/lib/misc/dnsmasq.leases
address=/connectivitycheck.gstatic.com/192.168.100.1
address=/clients3.google.com/192.168.100.1
address=/captive.apple.com/192.168.100.1
address=/www.msftconnecttest.com/192.168.100.1
address=/detectportal.firefox.com/192.168.100.1
EOF

echo "✓ Created fixed dnsmasq configuration"

# Show the config
echo ""
echo "Configuration file contents:"
cat /tmp/dnsmasq-fixed.conf

# Test the configuration
echo ""
echo "Testing configuration..."
dnsmasq -C /tmp/dnsmasq-fixed.conf --test
if [ $? -eq 0 ]; then
    echo "✓ Configuration is valid"
else
    echo "✗ Configuration has errors"
    exit 1
fi

# Start dnsmasq
echo ""
echo "Starting dnsmasq..."
dnsmasq -C /tmp/dnsmasq-fixed.conf --no-daemon &
DNSMASQ_PID=$!

sleep 2

# Check if it's running
if ps -p $DNSMASQ_PID > /dev/null; then
    echo "✓ dnsmasq started successfully (PID: $DNSMASQ_PID)"
    
    # Show listening ports
    echo ""
    echo "Listening on:"
    netstat -ulpn | grep :67
    
    echo ""
    echo "dnsmasq process:"
    ps aux | grep dnsmasq | grep -v grep
    
    echo ""
    echo "========================================="
    echo "✓ DHCP server is ready!"
    echo "========================================="
    echo ""
    echo "Now connect a device to the ethernet cable"
    echo "Monitor with: tail -f /var/log/syslog | grep dnsmasq"
    
else
    echo "✗ Failed to start dnsmasq"
    echo "Check errors with: dnsmasq -C /tmp/dnsmasq-fixed.conf --test"
fi