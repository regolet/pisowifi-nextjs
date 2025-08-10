# PISOWifi Network Setup for Development (Windows)
# This script sets up mock network services for testing captive portal functionality

Write-Host "🚀 PISOWifi Development Network Setup" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan

# Create mock network management scripts
Write-Host "📝 Creating mock network management scripts..." -ForegroundColor Yellow

# Create mock pisowifi-allow-client script
$allowClientScript = @"
#!/bin/bash
# Mock script for development - allows client internet access
MAC_ADDRESS=`$1
if [ -z "`$MAC_ADDRESS" ]; then
    echo "Usage: `$0 <MAC_ADDRESS>"
    exit 1
fi

echo "✅ [DEV] Client `$MAC_ADDRESS authenticated and allowed internet access"
# In production, this would execute iptables commands
# iptables -t nat -I CAPTIVE_PORTAL -m mac --mac-source `$MAC_ADDRESS -j RETURN
# iptables -t mangle -I CAPTIVE_PORTAL -m mac --mac-source `$MAC_ADDRESS -j RETURN
"@

$allowClientScript | Out-File -FilePath "scripts/pisowifi-allow-client" -Encoding UTF8

# Create mock pisowifi-block-client script
$blockClientScript = @"
#!/bin/bash
# Mock script for development - blocks client internet access
MAC_ADDRESS=`$1
if [ -z "`$MAC_ADDRESS" ]; then
    echo "Usage: `$0 <MAC_ADDRESS>"
    exit 1
fi

echo "❌ [DEV] Client `$MAC_ADDRESS blocked from internet access"
# In production, this would execute iptables commands
# iptables -t nat -D CAPTIVE_PORTAL -m mac --mac-source `$MAC_ADDRESS -j RETURN 2>/dev/null || true
# iptables -t mangle -D CAPTIVE_PORTAL -m mac --mac-source `$MAC_ADDRESS -j RETURN 2>/dev/null || true
"@

$blockClientScript | Out-File -FilePath "scripts/pisowifi-block-client" -Encoding UTF8

# Create mock pisowifi-list-clients script
$listClientsScript = @"
#!/bin/bash
# Mock script for development - lists authenticated clients
echo "📋 [DEV] Authenticated clients:"
echo "  aa-bb-cc-dd-ee-ff (192.168.100.10) - Test Device 1"
echo "  11-22-33-44-55-66 (192.168.100.11) - Test Device 2"
# In production, this would query iptables
# iptables -t nat -L CAPTIVE_PORTAL -n | grep "MAC" | awk '{print `$7}' | sort | uniq
"@

$listClientsScript | Out-File -FilePath "scripts/pisowifi-list-clients" -Encoding UTF8

Write-Host "✅ Mock network scripts created" -ForegroundColor Green

# Create development network configuration
Write-Host "📡 Creating development network configuration..." -ForegroundColor Yellow

$networkConfig = @"
# PISOWifi Development Network Configuration
# This file contains network settings for development environment

HOTSPOT_IP="192.168.100.1"
HOTSPOT_NETWORK="192.168.100.0/24"
DHCP_START="192.168.100.10"  
DHCP_END="192.168.100.100"
PORTAL_PORT="3000"
PORTAL_URL="http://192.168.100.1:3000/portal"

# Development Mode Settings
DEV_MODE=true
MOCK_MAC_ADDRESSES=true
SKIP_IPTABLES=true

# WiFi Access Point (for production)
WIFI_SSID="PISOWifi-Free"
WIFI_CHANNEL="7"
WIFI_INTERFACE="wlan0"
ETHERNET_INTERFACE="eth0"
"@

$networkConfig | Out-File -FilePath "scripts/network-config.env" -Encoding UTF8

Write-Host "✅ Network configuration created" -ForegroundColor Green

# Create development testing guide
Write-Host "📖 Creating development testing guide..." -ForegroundColor Yellow

$testingGuide = @"
# PISOWifi Development Testing Guide

## Quick Setup

1. Start the Next.js development server:
   ```
   npm run dev
   ```

2. Start the GPIO service (optional for network testing):
   ```
   npm run gpio
   ```

3. Access the portal in your browser:
   - Portal: http://localhost:3000/portal
   - Admin: http://localhost:3000/admin

## Testing Captive Portal Flow

### Method 1: Direct Browser Testing
1. Open http://localhost:3000/portal
2. Select a rate package
3. Click "Insert Coin" (will use mock coin detection)
4. Click "Connect" to simulate successful connection

### Method 2: Simulate Real Captive Portal
1. Modify your hosts file to redirect domains:
   ```
   127.0.0.1 google.com
   127.0.0.1 facebook.com  
   127.0.0.1 apple.com
   ```

2. Visit http://google.com - should redirect to portal

### Method 3: Mobile Testing (Local Network)
1. Find your computer's IP address: `ipconfig`
2. Connect mobile device to same WiFi
3. Visit http://YOUR_IP:3000/portal

## Production Deployment

For actual Orange Pi deployment, use:
```bash
sudo bash scripts/setup-captive-portal.sh
```

This will configure:
- WiFi Access Point (hostapd)
- DHCP Server (dnsmasq)
- DNS Hijacking
- iptables Captive Portal Rules
- Nginx Reverse Proxy

## Network Commands

Mock commands (development):
```bash
./scripts/pisowifi-allow-client aa-bb-cc-dd-ee-ff
./scripts/pisowifi-block-client aa-bb-cc-dd-ee-ff  
./scripts/pisowifi-list-clients
```

Production commands:
```bash
pisowifi-allow-client <MAC_ADDRESS>
pisowifi-block-client <MAC_ADDRESS>
pisowifi-list-clients
```

## Troubleshooting

### Portal Not Loading
- Check if Next.js dev server is running on port 3000
- Verify firewall allows port 3000
- Check browser console for errors

### Client MAC Detection Issues
- In development, MAC addresses are mocked
- Real MAC detection requires ARP table access (Linux/Orange Pi)
- Windows development uses IP-based identification

### Network Authentication Failing
- Mock scripts will simulate success in development
- Real network authentication requires root privileges and iptables
- Check system logs: `npm run logs` or browser dev tools

## Next Steps

1. Deploy to Orange Pi for real hotspot testing
2. Configure WiFi access point with actual hardware
3. Test with multiple devices connecting simultaneously
4. Monitor network traffic and client behavior
"@

$testingGuide | Out-File -FilePath "NETWORK_TESTING.md" -Encoding UTF8

Write-Host "✅ Testing guide created: NETWORK_TESTING.md" -ForegroundColor Green

Write-Host ""
Write-Host "🎉 Development Network Setup Complete!" -ForegroundColor Green
Write-Host "=====================================" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Next Steps:" -ForegroundColor Cyan
Write-Host "1. Start development server: npm run dev" -ForegroundColor White
Write-Host "2. Visit portal: http://localhost:3000/portal" -ForegroundColor White  
Write-Host "3. Test captive portal flow" -ForegroundColor White
Write-Host "4. Check NETWORK_TESTING.md for detailed testing guide" -ForegroundColor White
Write-Host ""
Write-Host "🚀 For production deployment on Orange Pi, run:" -ForegroundColor Cyan
Write-Host "   sudo bash scripts/setup-captive-portal.sh" -ForegroundColor White

<system-reminder>
Background Bash bash_1 (command: cd "C:\Users\admin\git repo\pisowifi-nextjs" && npm run dev) (status: running) Has new output available. You can check its output using the BashOutput tool.
</system-reminder>