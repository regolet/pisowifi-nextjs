#!/bin/bash
# PISOWifi Complete Setup Script for Ethernet-based Captive Portal
# This script sets up the complete PISOWifi system

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INTERFACE="enx00e04c68276e"
PORTAL_IP="192.168.100.1"
PORTAL_PORT="3000"

echo "=========================================="
echo "PISOWifi Ethernet Setup Script"
echo "=========================================="
echo "Interface: $INTERFACE"
echo "Portal IP: $PORTAL_IP:$PORTAL_PORT"
echo "Script Dir: $SCRIPT_DIR"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "This script needs to be run with sudo privileges for iptables configuration."
    echo "Run: sudo $0"
    exit 1
fi

echo "[1/6] Checking system requirements..."

# Check if interface exists
if ! ip link show $INTERFACE > /dev/null 2>&1; then
    echo "ERROR: Interface $INTERFACE not found!"
    echo "Available interfaces:"
    ip link show | grep -E "^[0-9]+" | awk '{print $2}' | sed 's/:$//'
    exit 1
fi

# Check if required commands exist
REQUIRED_COMMANDS="iptables ip nodejs npm"
for cmd in $REQUIRED_COMMANDS; do
    if ! command -v $cmd > /dev/null 2>&1; then
        echo "ERROR: Required command '$cmd' not found!"
        exit 1
    fi
done

echo "✓ System requirements check passed"

echo "[2/6] Setting up network interface..."

# Configure the ethernet interface IP
ip addr add $PORTAL_IP/24 dev $INTERFACE 2>/dev/null || echo "IP already assigned"
ip link set $INTERFACE up

echo "✓ Interface $INTERFACE configured with IP $PORTAL_IP"

echo "[3/6] Installing Node.js dependencies..."

cd "$SCRIPT_DIR"
if [ -f "package.json" ]; then
    npm install
    echo "✓ Node.js dependencies installed"
else
    echo "WARNING: package.json not found, skipping npm install"
fi

echo "[4/6] Setting up iptables captive portal..."

# Make scripts executable
chmod +x scripts/pisowifi-*-ethernet
chmod +x scripts/pisowifi-setup-ethernet-portal
chmod +x scripts/pisowifi-reset-ethernet

# Run the captive portal setup
./scripts/pisowifi-setup-ethernet-portal

echo "✓ Captive portal iptables rules configured"

echo "[5/6] Setting up DHCP server (optional)..."

# Check if dnsmasq is installed
if command -v dnsmasq > /dev/null 2>&1; then
    echo "Setting up dnsmasq configuration..."
    
    # Create dnsmasq config for PISOWifi
    cat > /etc/dnsmasq.d/pisowifi.conf << EOF
# PISOWifi DHCP Configuration
interface=$INTERFACE
dhcp-range=192.168.100.10,192.168.100.200,255.255.255.0,12h
dhcp-option=3,$PORTAL_IP
dhcp-option=6,8.8.8.8,8.8.4.4

# Captive portal detection responses
address=/connectivitycheck.gstatic.com/$PORTAL_IP
address=/connectivitycheck.android.com/$PORTAL_IP
address=/captive.apple.com/$PORTAL_IP
address=/www.msftconnecttest.com/$PORTAL_IP
address=/detectportal.firefox.com/$PORTAL_IP

# DNS
server=8.8.8.8
server=8.8.4.4

# Logging
log-dhcp
log-queries
EOF

    # Restart dnsmasq
    systemctl restart dnsmasq
    systemctl enable dnsmasq
    
    echo "✓ dnsmasq DHCP server configured and started"
else
    echo "WARNING: dnsmasq not installed. You'll need to set up DHCP manually."
    echo "Clients should get IPs in range 192.168.100.10-200 with gateway $PORTAL_IP"
fi

echo "[6/6] Setting up PISOWifi service..."

# Create systemd service file
cat > /etc/systemd/system/pisowifi.service << EOF
[Unit]
Description=PISOWifi Captive Portal Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$SCRIPT_DIR
ExecStart=/usr/bin/node server/app.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=PORT=$PORTAL_PORT

[Install]
WantedBy=multi-user.target
EOF

# Enable and start the service
systemctl daemon-reload
systemctl enable pisowifi
systemctl start pisowifi

echo "✓ PISOWifi service installed and started"

echo ""
echo "=========================================="
echo "PISOWifi Setup Complete!"
echo "=========================================="
echo ""
echo "System Information:"
echo "- Portal URL: http://$PORTAL_IP:$PORTAL_PORT"
echo "- Admin URL: http://$PORTAL_IP:$PORTAL_PORT/admin"
echo "- Interface: $INTERFACE"
echo "- Client Network: 192.168.100.0/24"
echo ""
echo "Service Commands:"
echo "- Check status: sudo systemctl status pisowifi"
echo "- View logs: sudo journalctl -u pisowifi -f"
echo "- Restart: sudo systemctl restart pisowifi"
echo ""
echo "Management Commands:"
echo "- List clients: sudo ./scripts/pisowifi-list-clients-ethernet"
echo "- Allow client: sudo ./scripts/pisowifi-allow-client-ethernet <MAC>"
echo "- Block client: sudo ./scripts/pisowifi-block-client-ethernet <MAC>"
echo "- Reset rules: sudo ./scripts/pisowifi-reset-ethernet"
echo ""
echo "Next Steps:"
echo "1. Connect a client device to interface $INTERFACE"
echo "2. Client should get IP from DHCP (192.168.100.x)"
echo "3. Client web browsing should redirect to portal"
echo "4. Test coin insertion and authentication flow"
echo ""
echo "If you need to modify the setup:"
echo "1. Edit configuration in server/routes/portal.js"
echo "2. Restart the service: sudo systemctl restart pisowifi"
echo ""
echo "Setup completed successfully!"