#!/bin/bash

# WiFi Adapter Diagnostic Script for Orange Pi

echo "====================================="
echo "WiFi Adapter Diagnostic"
echo "====================================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "Please run as root (use sudo)"
    exit 1
fi

echo "1. Checking for network interfaces..."
echo "-----------------------------------"
ip link show
echo ""

echo "2. Checking for wireless interfaces..."
echo "-----------------------------------"
iw dev 2>/dev/null || echo "iw command not found or no wireless devices"
echo ""

echo "3. Checking USB devices (for USB WiFi adapters)..."
echo "-----------------------------------"
lsusb | grep -i wireless || lsusb | grep -i wifi || lsusb | grep -i 802.11 || echo "No USB WiFi adapter found in device list"
echo ""
echo "All USB devices:"
lsusb
echo ""

echo "4. Checking PCI devices (for internal WiFi)..."
echo "-----------------------------------"
lspci 2>/dev/null | grep -i network || echo "No PCI network devices found (normal for ARM boards)"
echo ""

echo "5. Checking loaded kernel modules..."
echo "-----------------------------------"
lsmod | grep -E "80211|wifi|wlan|rtl|8188|8192|mt76" || echo "No common WiFi modules loaded"
echo ""

echo "6. Checking dmesg for WiFi-related messages..."
echo "-----------------------------------"
dmesg | grep -i -E "wifi|wlan|802.11|wireless" | tail -10
echo ""

echo "7. Checking rfkill status..."
echo "-----------------------------------"
rfkill list 2>/dev/null || echo "rfkill not available"
echo ""

echo "8. Checking available network devices in /sys..."
echo "-----------------------------------"
ls -la /sys/class/net/
echo ""

echo "9. Checking NetworkManager devices..."
echo "-----------------------------------"
nmcli device status
echo ""

echo "====================================="
echo "Diagnostic Summary"
echo "====================================="

# Check if any wireless interface exists
if ip link show | grep -q "wlan\|wlp\|wlx"; then
    WIFI_IF=$(ip link show | grep -E "wlan|wlp|wlx" | awk -F': ' '{print $2}' | head -1)
    echo "✓ Found wireless interface: $WIFI_IF"
    echo ""
    echo "To enable it:"
    echo "  ip link set $WIFI_IF up"
    echo "  iw dev $WIFI_IF set type __ap"
else
    echo "✗ No wireless interface found"
    echo ""
    echo "Possible solutions:"
    echo ""
    echo "1. If you have a USB WiFi adapter:"
    echo "   - Make sure it's properly connected"
    echo "   - Install drivers if needed:"
    echo "     apt-get install firmware-realtek firmware-misc-nonfree"
    echo ""
    echo "2. For Realtek RTL8188/8192 adapters:"
    echo "   apt-get install rtl8188eu-dkms"
    echo ""
    echo "3. Check if WiFi is disabled:"
    echo "   rfkill unblock wifi"
    echo ""
    echo "4. Load common WiFi modules manually:"
    echo "   modprobe cfg80211"
    echo "   modprobe mac80211"
fi

echo ""
echo "====================================="
echo "Alternative: Use Ethernet as Gateway"
echo "====================================="
echo ""
echo "If WiFi is not available, you can use Ethernet for PISOWifi:"
echo ""
echo "1. Connect clients via Ethernet switch/hub to eth0"
echo "2. Configure eth0 as the PISOWifi interface:"
echo "   - Update /etc/dnsmasq.d/pisowifi.conf"
echo "   - Change interface=wlan0 to interface=eth0"
echo "3. Set static IP on eth0:"
echo "   ip addr add 192.168.100.1/24 dev eth0"
echo "4. Restart services"
echo ""
echo "Or use a different network configuration where:"
echo "- eth0 = Internet connection (WAN)"
echo "- eth1 = Client connections (LAN) via USB-to-Ethernet adapter"