#!/bin/bash

# Start PISOWifi Server Script
echo "Starting PISOWifi Server"
echo "======================="

# Check if we're in the right directory
if [ ! -f "server/app.js" ]; then
    echo "Error: Please run this from the pisowifi-nextjs directory"
    exit 1
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed"
    echo "Install with: curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash - && sudo apt-get install -y nodejs"
    exit 1
fi

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Show network status
echo ""
echo "Network Status:"
echo "==============="
echo "PISOWifi DHCP Server: $(pgrep dnsmasq > /dev/null && echo "✓ Running" || echo "✗ Not running")"
echo "PISOWifi Interface: $(ip addr show enx00e04c68276e | grep "inet 192.168.100.1" > /dev/null && echo "✓ Configured" || echo "✗ Not configured")"

echo ""
echo "DHCP Leases (Connected devices):"
if [ -f /var/lib/misc/dnsmasq.leases ]; then
    cat /var/lib/misc/dnsmasq.leases
else
    echo "No devices connected yet"
fi

echo ""
echo "Starting PISOWifi portal server on port 3000..."
echo "Portal URL: http://192.168.100.1:3000/portal"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

# Start the server
cd /root/pisowifi-nextjs
export NODE_ENV=production
export PORT=3000
node server/app.js