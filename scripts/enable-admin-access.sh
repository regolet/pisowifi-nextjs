#!/bin/bash

# Enable admin panel access from home network
echo "Enabling Admin Panel Access from Home Network"
echo "============================================="

# Must run as root
if [ "$EUID" -ne 0 ]; then 
    echo "Please run as root: sudo ./enable-admin-access.sh"
    exit 1
fi

# Check current iptables rules
echo "Current firewall rules for port 3000:"
iptables -L INPUT -n | grep 3000 || echo "No rules for port 3000 found"

echo ""
echo "Adding firewall rules to allow admin access..."

# Allow admin access from home network (192.168.1.x)
iptables -A INPUT -s 192.168.1.0/24 -p tcp --dport 3000 -j ACCEPT

# Allow admin access from PISOWifi network (192.168.100.x)  
iptables -A INPUT -s 192.168.100.0/24 -p tcp --dport 3000 -j ACCEPT

# Allow from WAN interface (end0)
iptables -A INPUT -i end0 -p tcp --dport 3000 -j ACCEPT

# Allow from LAN interface (enx00e04c68276e)
iptables -A INPUT -i enx00e04c68276e -p tcp --dport 3000 -j ACCEPT

# Allow SSH access as well
iptables -A INPUT -s 192.168.1.0/24 -p tcp --dport 22 -j ACCEPT
iptables -A INPUT -i end0 -p tcp --dport 22 -j ACCEPT

echo "✓ Firewall rules added"

# Save iptables rules
if command -v iptables-save > /dev/null; then
    iptables-save > /etc/iptables/rules.v4 2>/dev/null || true
    echo "✓ Firewall rules saved"
fi

echo ""
echo "Current rules for port 3000:"
iptables -L INPUT -n | grep 3000

echo ""
echo "Testing server accessibility..."

# Check if server is running
if netstat -tlpn | grep -q ":3000"; then
    echo "✓ Server is running on port 3000"
    
    # Show which interfaces server is bound to
    echo ""
    echo "Server binding:"
    netstat -tlpn | grep :3000
    
else
    echo "✗ Server is not running on port 3000"
    echo "Start with: cd /root/pisowifi-nextjs && npm run server"
fi

echo ""
echo "Network interfaces:"
ip addr show | grep -E "^[0-9]|inet " | grep -v "127.0.0.1"

echo ""
echo "Admin panel should now be accessible at:"
echo "  From home network: http://192.168.1.105:3000/admin"
echo "  From PISOWifi: http://192.168.100.1:3000/admin"
echo ""
echo "Login credentials:"
echo "  Username: admin"
echo "  Password: admin123"