#!/bin/bash

echo "=== PISOWifi Firewall Diagnostic ==="
echo ""

echo "1. Checking iptables NAT rules..."
echo "-----------------------------------"
sudo iptables -t nat -L PREROUTING -n --line-numbers
echo ""

echo "2. Checking iptables INPUT rules..."
echo "-----------------------------------"
sudo iptables -L INPUT -n --line-numbers | head -20
echo ""

echo "3. Checking for port 3000 rules..."
echo "-----------------------------------"
sudo iptables -L -n | grep 3000 || echo "No port 3000 rules found"
echo ""

echo "4. Checking for DNAT rules..."
echo "-----------------------------------"
sudo iptables -t nat -L -n | grep DNAT || echo "No DNAT rules found"
echo ""

echo "5. Checking services..."
echo "-----------------------------------"
systemctl is-active pisowifi-dynamic && echo "pisowifi-dynamic: Active" || echo "pisowifi-dynamic: Inactive"
systemctl is-active pisowifi-final && echo "pisowifi-final: Active" || echo "pisowifi-final: Inactive"
pgrep dnsmasq > /dev/null && echo "dnsmasq: Running (PID: $(pgrep dnsmasq))" || echo "dnsmasq: Not running"
echo ""

echo "6. Checking network interfaces..."
echo "-----------------------------------"
ip addr show enx00e04c68276e | grep inet || echo "enx00e04c68276e not configured"
echo ""

echo "7. Testing what the dashboard checks..."
echo "-----------------------------------"
echo "Dashboard NAT check:"
sudo iptables -t nat -L PREROUTING -n | grep -E "DNAT.*3000" && echo "✓ Found DNAT to port 3000" || echo "✗ No DNAT to port 3000"

echo ""
echo "Dashboard INPUT check:"
sudo iptables -L INPUT -n | grep -E "tcp.*dpt:3000" && echo "✓ Found INPUT rule for port 3000" || echo "✗ No INPUT rule for port 3000"

echo ""
echo "=== Recommendations ==="
if ! sudo iptables -t nat -L PREROUTING -n | grep -q "DNAT.*3000"; then
    echo "❌ Captive portal rules are missing!"
    echo "Run: sudo /etc/iptables/pisowifi-dynamic.sh"
    echo "Or: sudo /etc/iptables/pisowifi-final.sh"
else
    echo "✅ Captive portal rules are present"
fi