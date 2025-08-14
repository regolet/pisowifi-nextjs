#!/bin/bash

# DHCP Debugging Script - Find out why devices can't get IP addresses

echo "PISOWifi DHCP Debugging"
echo "======================"
echo ""

# Check if dnsmasq is running
echo "1. DHCP Server Status:"
echo "----------------------"
if pgrep dnsmasq > /dev/null; then
    echo "✓ dnsmasq is running (PID: $(pgrep dnsmasq))"
    echo "Command line:"
    ps aux | grep dnsmasq | grep -v grep
else
    echo "✗ dnsmasq is NOT running"
    echo "Start with: dnsmasq -C /tmp/dnsmasq-pisowifi.conf --no-daemon"
    exit 1
fi

echo ""
echo "2. Network Interfaces:"
echo "----------------------"
ip addr show | grep -E "^[0-9]|inet "

echo ""
echo "3. DHCP Configuration:"
echo "----------------------"
if [ -f /tmp/dnsmasq-pisowifi.conf ]; then
    echo "Config file exists:"
    cat /tmp/dnsmasq-pisowifi.conf
else
    echo "No config file found at /tmp/dnsmasq-pisowifi.conf"
fi

echo ""
echo "4. Port Listeners:"
echo "------------------"
echo "DHCP (port 67):"
netstat -ulpn | grep :67 || echo "No DHCP server listening on port 67"
echo ""
echo "DNS (port 53):"
netstat -ulpn | grep :53 || echo "No DNS server listening on port 53"

echo ""
echo "5. Interface Link Status:"
echo "-------------------------"
for iface in end0 enx00e04c68276e; do
    if ip link show $iface &>/dev/null; then
        echo "$iface status:"
        ip link show $iface | grep -E "state|link"
        echo "Cable connected: $(ethtool $iface 2>/dev/null | grep 'Link detected' || echo 'Unknown')"
    fi
done

echo ""
echo "6. DHCP Logs (last 20 lines):"
echo "------------------------------"
journalctl -n 20 --no-pager | grep -i dhcp || echo "No DHCP logs in journal"

echo ""
echo "7. Firewall Rules:"
echo "------------------"
echo "Input rules for DHCP:"
iptables -L INPUT -n | grep -E "(67|68)" || echo "No DHCP firewall rules"

echo ""
echo "8. Test DHCP Response:"
echo "----------------------"
echo "Testing DHCP discover on enx00e04c68276e..."

# Create a simple DHCP test
timeout 10 tcpdump -i enx00e04c68276e -c 5 port 67 or port 68 &
TCPDUMP_PID=$!

sleep 2

# Send DHCP discover (if dhcping is available)
if command -v dhcping >/dev/null 2>&1; then
    dhcping -c 192.168.100.1 -s 192.168.100.1 -i enx00e04c68276e
else
    echo "dhcping not available, install with: apt install dhcping"
fi

wait $TCPDUMP_PID 2>/dev/null || true

echo ""
echo "9. Manual DHCP Test:"
echo "--------------------"
echo "To manually test DHCP, run this on a client device:"
echo "  sudo dhclient -d -v enx00e04c68276e"
echo ""
echo "Or use nmap to scan for the DHCP server:"
echo "  nmap --script broadcast-dhcp-discover"

echo ""
echo "10. Troubleshooting Steps:"
echo "--------------------------"

problems=()

# Check if interface has link
if ! ethtool enx00e04c68276e 2>/dev/null | grep -q "Link detected: yes"; then
    problems+=("No physical link detected on enx00e04c68276e - check cable")
fi

# Check if dnsmasq is bound to the right interface
if ! netstat -ulpn | grep :67 | grep -q dnsmasq; then
    problems+=("dnsmasq not listening on DHCP port 67")
fi

# Check if IP forwarding is enabled
if [ "$(cat /proc/sys/net/ipv4/ip_forward)" != "1" ]; then
    problems+=("IP forwarding disabled - run: echo 1 > /proc/sys/net/ipv4/ip_forward")
fi

if [ ${#problems[@]} -eq 0 ]; then
    echo "No obvious issues found. Try:"
    echo "1. Check physical cable connection"
    echo "2. Test with a different device"
    echo "3. Monitor logs: tail -f /var/log/syslog | grep dnsmasq"
else
    echo "Issues found:"
    for problem in "${problems[@]}"; do
        echo "⚠ $problem"
    done
fi

echo ""
echo "Quick fixes to try:"
echo "==================="
echo "1. Restart dnsmasq:"
echo "   killall dnsmasq"
echo "   dnsmasq -C /tmp/dnsmasq-pisowifi.conf --no-daemon &"
echo ""
echo "2. Reset interface:"
echo "   ip link set enx00e04c68276e down"
echo "   ip link set enx00e04c68276e up"
echo ""
echo "3. Check cable and try different port on switch/device"