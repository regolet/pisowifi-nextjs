#!/bin/bash

# Setup PISOWifi Auto-Start Services
# Creates systemd services for all components to auto-start on boot

echo "Setting up PISOWifi Auto-Start Services"
echo "======================================="

# Must run as root
if [ "$EUID" -ne 0 ]; then 
    echo "Please run as root: sudo ./setup-autostart-services.sh"
    exit 1
fi

PROJECT_DIR="/root/pisowifi-nextjs"
PORTAL_IP="10.0.0.1"
PORTAL_PORT="80"

# Auto-detect LAN interface
# Priority: USB Ethernet (enx*) > Secondary Ethernet (eth1/end1) > First non-loopback
detect_lan_interface() {
    # Look for USB Ethernet adapter (usually starts with "enx" or "usb")
    local usb_iface=$(ip link show | grep -oE 'enx[a-f0-9]+|usb[0-9]+' | head -1)
    if [ -n "$usb_iface" ]; then
        echo "$usb_iface"
        return
    fi
    
    # Look for secondary ethernet (eth1, end1)
    for iface in eth1 end1 enp0s1; do
        if ip link show "$iface" &>/dev/null; then
            echo "$iface"
            return
        fi
    done
    
    # Fallback: find first non-loopback, non-wireless interface
    local iface=$(ip link show | grep -E '^[0-9]+:' | grep -v 'lo:' | grep -v 'wlan' | grep -v 'wl' | head -1 | cut -d: -f2 | tr -d ' ')
    if [ -n "$iface" ]; then
        echo "$iface"
        return
    fi
    
    # Ultimate fallback
    echo "eth0"
}

LAN_INTERFACE=$(detect_lan_interface)

echo "Configuration:"
echo "  Project Directory: $PROJECT_DIR"
echo "  LAN Interface: $LAN_INTERFACE (auto-detected)"
echo "  Portal IP: $PORTAL_IP"
echo "  Portal Port: $PORTAL_PORT"
echo ""

# Step 1: Create PISOWifi Portal Server Service
echo "Step 1: Creating PISOWifi portal server service..."

cat > /etc/systemd/system/pisowifi-portal.service << EOF
[Unit]
Description=PISOWifi Portal Server
Documentation=https://github.com/regolet/pisowifi-nextjs
After=network.target network-online.target
Wants=network-online.target
Requires=pisowifi-network.service

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=$PROJECT_DIR
ExecStart=/usr/bin/node $PROJECT_DIR/server/app.js
Restart=always
RestartSec=10
StartLimitInterval=60s
StartLimitBurst=3

# Environment variables
Environment=NODE_ENV=production
Environment=PORT=$PORTAL_PORT
Environment=DATABASE_URL=file:./dev.db

# Process management
KillMode=mixed
TimeoutStopSec=5
PrivateTmp=false

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=pisowifi-portal

[Install]
WantedBy=multi-user.target
EOF

echo "✓ PISOWifi portal service created"

# Step 2: Create Network Setup Service (runs before portal)
echo ""
echo "Step 2: Creating network setup service..."

cat > /etc/systemd/system/pisowifi-network.service << EOF
[Unit]
Description=PISOWifi Network Setup (Interface, DHCP, DNS)
Documentation=https://github.com/regolet/pisowifi-nextjs
After=network.target
Before=pisowifi-portal.service
DefaultDependencies=false

[Service]
Type=oneshot
User=root
ExecStart=$PROJECT_DIR/scripts/setup-network-on-boot.sh
RemainAfterExit=yes
TimeoutSec=30

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=pisowifi-network

[Install]
WantedBy=multi-user.target
EOF

echo "✓ PISOWifi network service created"

# Step 3: Create PISOWifi DHCP/DNS Service
echo ""
echo "Step 3: Creating PISOWifi DHCP/DNS service..."

cat > /etc/systemd/system/pisowifi-dhcp.service << EOF
[Unit]
Description=PISOWifi DHCP and DNS Server (dnsmasq)
Documentation=https://github.com/regolet/pisowifi-nextjs
After=pisowifi-network.service
Requires=pisowifi-network.service
Conflicts=dnsmasq.service systemd-resolved.service

[Service]
Type=forking
User=root
PIDFile=/var/run/pisowifi-dnsmasq.pid
ExecStartPre=/bin/bash -c 'killall dnsmasq 2>/dev/null || true'
ExecStart=/usr/sbin/dnsmasq -C /tmp/dnsmasq-captive.conf --pid-file=/var/run/pisowifi-dnsmasq.pid
ExecReload=/bin/kill -HUP \$MAINPID
ExecStop=/bin/kill -TERM \$MAINPID
Restart=always
RestartSec=5
StartLimitInterval=60s
StartLimitBurst=5

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=pisowifi-dhcp

[Install]
WantedBy=multi-user.target
EOF

echo "✓ PISOWifi DHCP service created"

# Step 4: Create network setup script that runs on boot
echo ""
echo "Step 4: Creating network setup script..."

cat > $PROJECT_DIR/scripts/setup-network-on-boot.sh << 'EOF'
#!/bin/bash

# PISOWifi Network Setup on Boot
# Sets up interface, iptables, and dnsmasq config

PORTAL_IP="10.0.0.1"
PORTAL_PORT="80"

# Auto-detect LAN interface
detect_lan_interface() {
    # Look for USB Ethernet adapter (usually starts with "enx" or "usb")
    local usb_iface=$(ip link show | grep -oE 'enx[a-f0-9]+|usb[0-9]+' | head -1)
    if [ -n "$usb_iface" ]; then
        echo "$usb_iface"
        return
    fi
    
    # Look for secondary ethernet (eth1, end1)
    for iface in eth1 end1 enp0s1; do
        if ip link show "$iface" &>/dev/null; then
            echo "$iface"
            return
        fi
    done
    
    # Fallback: find first non-loopback, non-wireless, non-primary interface
    local iface=$(ip link show | grep -E '^[0-9]+:' | grep -v 'lo:' | grep -v 'wlan' | grep -v 'wl' | grep -v 'end0:' | grep -v 'eth0:' | head -1 | cut -d: -f2 | tr -d ' ')
    if [ -n "$iface" ]; then
        echo "$iface"
        return
    fi
    
    # Ultimate fallback
    echo "eth0"
}

LAN_INTERFACE=$(detect_lan_interface)

echo "PISOWifi Network Setup on Boot"
echo "=============================="
echo "Auto-detected LAN Interface: $LAN_INTERFACE"

# Wait for interface to be available (if not already up)
echo "Checking interface $LAN_INTERFACE..."
for i in {1..30}; do
    if ip link show $LAN_INTERFACE &>/dev/null; then
        echo "✓ Interface $LAN_INTERFACE found"
        break
    fi
    sleep 1
    if [ $i -eq 30 ]; then
        echo "✗ Interface $LAN_INTERFACE not found after 30 seconds"
        exit 1
    fi
done

# Configure interface IP
echo "Configuring interface IP..."
ip addr flush dev $LAN_INTERFACE 2>/dev/null || true
ip addr add $PORTAL_IP/24 dev $LAN_INTERFACE
ip link set $LAN_INTERFACE up

# Enable IP forwarding
echo "Enabling IP forwarding..."
echo 1 > /proc/sys/net/ipv4/ip_forward

# Setup iptables rules
echo "Setting up iptables rules..."

# Clear existing rules
iptables -t nat -F PREROUTING 2>/dev/null || true
iptables -F FORWARD 2>/dev/null || true

# Allow established connections
iptables -A FORWARD -m state --state ESTABLISHED,RELATED -j ACCEPT

# HTTP/HTTPS redirect to portal
iptables -t nat -A PREROUTING -i $LAN_INTERFACE -p tcp --dport 80 -j DNAT --to-destination $PORTAL_IP:$PORTAL_PORT
iptables -t nat -A PREROUTING -i $LAN_INTERFACE -p tcp --dport 443 -j DNAT --to-destination $PORTAL_IP:$PORTAL_PORT

# Allow traffic to portal
iptables -A INPUT -i $LAN_INTERFACE -p tcp --dport $PORTAL_PORT -j ACCEPT

# Allow DHCP and DNS
iptables -A INPUT -i $LAN_INTERFACE -p udp --dport 67 -j ACCEPT
iptables -A INPUT -i $LAN_INTERFACE -p udp --dport 53 -j ACCEPT

# Block internet access (will be controlled by portal)
iptables -A FORWARD -i $LAN_INTERFACE -j DROP

# Create dnsmasq config
echo "Creating dnsmasq configuration..."
cat > /tmp/dnsmasq-captive.conf << DNSEOF
interface=$LAN_INTERFACE
bind-interfaces
except-interface=lo
except-interface=end0
dhcp-range=10.0.0.10,10.0.0.50,255.255.255.0,2h
dhcp-option=3,$PORTAL_IP
dhcp-option=6,$PORTAL_IP
dhcp-authoritative
address=/#/$PORTAL_IP
address=/connectivitycheck.gstatic.com/$PORTAL_IP
address=/connectivitycheck.android.com/$PORTAL_IP
address=/clients3.google.com/$PORTAL_IP
address=/captive.apple.com/$PORTAL_IP
address=/www.apple.com/$PORTAL_IP
address=/www.msftconnecttest.com/$PORTAL_IP
address=/www.msftncsi.com/$PORTAL_IP
address=/detectportal.firefox.com/$PORTAL_IP
address=/nmcheck.gnome.org/$PORTAL_IP
address=/google.com/$PORTAL_IP
address=/www.google.com/$PORTAL_IP
no-resolv
bogus-priv
log-dhcp
log-queries
dhcp-leasefile=/var/lib/misc/dnsmasq.leases
DNSEOF

echo "✓ Network setup completed"
echo "Interface: $LAN_INTERFACE ($PORTAL_IP)"
echo "DHCP Range: 10.0.0.10-50"
echo "Portal Port: $PORTAL_PORT"
EOF

chmod +x $PROJECT_DIR/scripts/setup-network-on-boot.sh
echo "✓ Network setup script created"

# Step 5: Stop conflicting services
echo ""
echo "Step 5: Disabling conflicting services..."

# Disable default dnsmasq
systemctl stop dnsmasq 2>/dev/null || true
systemctl disable dnsmasq 2>/dev/null || true

# Disable systemd-resolved if it exists
systemctl stop systemd-resolved 2>/dev/null || true
systemctl disable systemd-resolved 2>/dev/null || true

# Remove systemd-resolved symlink
rm -f /etc/resolv.conf
echo "nameserver 8.8.8.8" > /etc/resolv.conf

echo "✓ Conflicting services disabled"

# Step 6: Enable PISOWifi services
echo ""
echo "Step 6: Enabling PISOWifi services..."

systemctl daemon-reload

# Enable services in order
systemctl enable pisowifi-network.service
systemctl enable pisowifi-dhcp.service  
systemctl enable pisowifi-portal.service

echo "✓ PISOWifi services enabled"

# Step 7: Start services
echo ""
echo "Step 7: Starting PISOWifi services..."

systemctl start pisowifi-network.service
sleep 2
systemctl start pisowifi-dhcp.service
sleep 2
systemctl start pisowifi-portal.service

# Check service status
echo ""
echo "Service Status:"
echo "==============="

echo ""
echo "Network Service:"
systemctl is-active pisowifi-network.service --quiet && echo "✓ Active" || echo "✗ Failed"

echo ""
echo "DHCP Service:"
systemctl is-active pisowifi-dhcp.service --quiet && echo "✓ Active" || echo "✗ Failed"

echo ""
echo "Portal Service:"
systemctl is-active pisowifi-portal.service --quiet && echo "✓ Active" || echo "✗ Failed"

# Step 8: Verify everything is working
echo ""
echo "Step 8: Verification..."

echo ""
echo "Interface status:"
ip addr show $LAN_INTERFACE | grep inet || echo "✗ Interface not configured"

echo ""
echo "DHCP server:"
netstat -ulpn | grep :67 && echo "✓ DHCP listening" || echo "✗ DHCP not listening"

echo ""
echo "Portal server:"
netstat -tlpn | grep :$PORTAL_PORT && echo "✓ Portal listening" || echo "✗ Portal not listening"

echo ""
echo "========================================="
echo "✓ PISOWifi Auto-Start Setup Complete!"
echo "========================================="
echo ""
echo "Services configured:"
echo "  • pisowifi-network.service  - Network setup (interface, iptables)"
echo "  • pisowifi-dhcp.service     - DHCP/DNS server"  
echo "  • pisowifi-portal.service   - Portal web server"
echo ""
echo "All services will:"
echo "  • Start automatically on boot"
echo "  • Restart automatically if they fail"
echo "  • Start in correct dependency order"
echo ""
echo "To check status:"
echo "  systemctl status pisowifi-portal.service"
echo "  systemctl status pisowifi-dhcp.service"
echo "  systemctl status pisowifi-network.service"
echo ""
echo "To view logs:"
echo "  journalctl -u pisowifi-portal.service -f"
echo "  journalctl -u pisowifi-dhcp.service -f"
echo ""
echo "To restart all services:"
echo "  systemctl restart pisowifi-network pisowifi-dhcp pisowifi-portal"
echo ""
echo "PISOWifi is now production-ready with auto-restart! 🚀"