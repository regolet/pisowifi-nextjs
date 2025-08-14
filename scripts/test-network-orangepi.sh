#!/bin/bash

# Network diagnostics script for Orange Pi PISOWifi
echo "PISOWifi Network Diagnostics"
echo "============================"
echo ""

# 1. Check network interfaces
echo "1. Network Interfaces:"
echo "----------------------"
ip addr show | grep -E "^[0-9]|inet "
echo ""

# 2. Check if dnsmasq is running
echo "2. DHCP Server Status:"
echo "----------------------"
if pgrep dnsmasq > /dev/null; then
    echo "✓ dnsmasq is running (PID: $(pgrep dnsmasq))"
    echo "Configuration:"
    ps aux | grep dnsmasq | grep -v grep
else
    echo "✗ dnsmasq is NOT running"
    echo "Start with: systemctl start dnsmasq"
fi
echo ""

# 3. Check DHCP leases
echo "3. DHCP Leases:"
echo "---------------"
for lease_file in /var/lib/misc/dnsmasq.leases /var/lib/dnsmasq/dnsmasq.leases; do
    if [ -f "$lease_file" ]; then
        echo "Lease file: $lease_file"
        if [ -s "$lease_file" ]; then
            cat "$lease_file"
        else
            echo "No active leases"
        fi
        break
    fi
done
echo ""

# 4. Check iptables rules
echo "4. Firewall Rules:"
echo "------------------"
echo "NAT rules:"
iptables -t nat -L PREROUTING -n --line-numbers | head -5
echo ""
echo "Filter rules:"
iptables -L INPUT -n --line-numbers | head -5
echo ""

# 5. Check if portal is accessible
echo "5. Portal Status:"
echo "-----------------"
if curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/portal | grep -q "200\|302"; then
    echo "✓ Portal is accessible on port 3000"
else
    echo "✗ Portal is NOT accessible"
    echo "Start with: cd /root/pisowifi-nextjs && npm run server"
fi
echo ""

# 6. Test captive portal detection
echo "6. Captive Portal URLs:"
echo "-----------------------"
for url in "generate_204" "hotspot-detect.html" "connecttest.txt"; do
    response=$(curl -s -o /dev/null -w "%{http_code}" http://192.168.100.1:3000/$url 2>/dev/null)
    if [ "$response" = "302" ] || [ "$response" = "204" ] || [ "$response" = "200" ]; then
        echo "✓ /$url - Status: $response"
    else
        echo "✗ /$url - Status: $response"
    fi
done
echo ""

# 7. Check DNS resolution
echo "7. DNS Resolution:"
echo "------------------"
echo "Testing DNS server on 192.168.100.1..."
nslookup google.com 192.168.100.1 2>&1 | grep -A1 "Name:"
if [ $? -eq 0 ]; then
    echo "✓ DNS is working"
else
    echo "✗ DNS is not responding"
fi
echo ""

# 8. Check port listeners
echo "8. Port Listeners:"
echo "------------------"
netstat -tulpn | grep -E ":(53|67|68|80|3000|3001|3002) " | head -10
echo ""

# 9. System logs
echo "9. Recent DHCP Logs:"
echo "--------------------"
journalctl -u dnsmasq -n 10 --no-pager 2>/dev/null || \
    tail -10 /var/log/syslog 2>/dev/null | grep -i dhcp || \
    echo "No recent DHCP logs found"
echo ""

# 10. Recommendations
echo "10. Troubleshooting Steps:"
echo "--------------------------"

problems=0

if ! pgrep dnsmasq > /dev/null; then
    echo "⚠ Start DHCP server: systemctl start dnsmasq"
    problems=$((problems + 1))
fi

if ! curl -s http://localhost:3000 > /dev/null 2>&1; then
    echo "⚠ Start PISOWifi server: cd /root/pisowifi-nextjs && npm run server"
    problems=$((problems + 1))
fi

if ! iptables -t nat -L PREROUTING -n | grep -q "192.168.100.1:3000"; then
    echo "⚠ Setup iptables redirect: iptables -t nat -A PREROUTING -i wlan0 -p tcp --dport 80 -j DNAT --to 192.168.100.1:3000"
    problems=$((problems + 1))
fi

if [ $problems -eq 0 ]; then
    echo "✓ Everything looks good! Devices should connect and see the captive portal."
else
    echo ""
    echo "Run the setup script to fix all issues:"
    echo "  chmod +x /root/pisowifi-nextjs/scripts/setup-orangepi-network.sh"
    echo "  /root/pisowifi-nextjs/scripts/setup-orangepi-network.sh"
fi