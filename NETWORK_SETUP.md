# 🌐 PISOWifi Network & Captive Portal Setup Guide

## 🎯 Overview

This guide covers setting up the captive portal network infrastructure that automatically redirects clients to the portal when they connect to WiFi. This is the core functionality that makes PISOWifi work as a hotspot system.

---

## 📋 What We've Implemented

### ✅ **Completed Network Features:**

1. **🔧 Network Infrastructure Scripts**
   - Production setup script: `scripts/setup-captive-portal.sh`
   - Development mock scripts: `scripts/pisowifi-allow-client`, `scripts/pisowifi-block-client`
   - Network configuration management

2. **🌐 API Endpoints for Client Management**
   - `POST /api/clients/authenticate` - Allow client internet access
   - `POST /api/clients/disconnect` - Block client internet access  
   - `POST /api/portal/connect` - Enhanced with network authentication

3. **🔍 Network Detection Utilities**
   - Client IP detection from request headers
   - MAC address resolution from ARP table
   - Connected clients discovery
   - Development mode with mock MAC addresses

4. **🛡️ Security & Traffic Control**
   - iptables rules for traffic filtering
   - DNS hijacking configuration
   - Captive portal detection endpoints

---

## 🚀 Quick Development Testing

### 1. **Start the System**
```bash
# Terminal 1: Start Next.js server
npm run dev

# Terminal 2: Start GPIO service (optional)  
npm run gpio
```

### 2. **Test Captive Portal Flow**
```bash
# Visit the portal directly
http://localhost:3000/portal

# Test admin dashboard
http://localhost:3000/admin
# Login: admin / admin123
```

### 3. **Simulate Client Connection**
1. Select a rate package on the portal
2. Click "Insert Coin" (triggers mock coin detection)
3. Click "Connect" (simulates network authentication)
4. Check console logs for network authentication messages

---

## 🏭 Production Deployment (Orange Pi)

### **Step 1: Deploy to Orange Pi**
```bash
# Copy project to Orange Pi
scp -r pisowifi-nextjs/ pi@your-orange-pi:/home/pi/

# SSH into Orange Pi
ssh pi@your-orange-pi
cd /home/pi/pisowifi-nextjs
```

### **Step 2: Install Dependencies**
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install project dependencies
npm install
```

### **Step 3: Setup Network Infrastructure**
```bash
# Run the captive portal setup script
sudo bash scripts/setup-captive-portal.sh
```

This script will configure:
- **WiFi Access Point** (hostapd) - Creates "PISOWifi-Free" network
- **DHCP Server** (dnsmasq) - Assigns IP addresses to clients
- **DNS Hijacking** - Redirects all DNS queries to portal
- **iptables Rules** - Controls traffic flow and authentication
- **Nginx Proxy** - Handles HTTP redirects to portal

### **Step 4: Start PISOWifi Services**
```bash
# Generate Prisma client and setup database
npm run db:generate
npm run db:push
npm run create-admin

# Start the application
npm run build
npm start

# Or use PM2 for production
npm install -g pm2
pm2 start npm --name "pisowifi" -- start
pm2 save
pm2 startup
```

---

## 🔧 Network Configuration Details

### **IP Address Scheme**
- **Gateway (Orange Pi):** 192.168.100.1
- **Client Range:** 192.168.100.10 - 192.168.100.100  
- **Portal URL:** http://192.168.100.1:3000/portal
- **Admin Panel:** http://192.168.100.1:3000/admin

### **WiFi Access Point Settings**
- **SSID:** PISOWifi-Free
- **Security:** Open (no password)
- **Channel:** 7
- **Interface:** wlan0 (or USB WiFi adapter)

### **Captive Portal Detection**
The system handles detection requests from all major platforms:

```nginx
# Apple devices
location /hotspot-detect.html { return 302 $PORTAL_URL; }

# Android devices  
location /generate_204 { return 302 $PORTAL_URL; }

# Microsoft devices
location /connecttest.txt { return 302 $PORTAL_URL; }
location /ncsi.txt { return 302 $PORTAL_URL; }
```

### **Traffic Flow**
1. **Client connects** to "PISOWifi-Free"
2. **DHCP assigns** IP address (192.168.100.x)
3. **DNS queries** redirected to gateway (192.168.100.1)
4. **HTTP requests** redirected to portal via iptables
5. **Portal loads** with rate selection
6. **After payment** client MAC is whitelisted for internet access

---

## 🧪 Testing Captive Portal Redirection

### **Method 1: Direct Testing**
```bash
# On connected device, visit any HTTP site
http://google.com
http://facebook.com
http://example.com

# Should redirect to: http://192.168.100.1:3000/portal
```

### **Method 2: Captive Portal Detection**
Most devices automatically detect captive portals:
- **iOS:** Shows "Sign in to WiFi" notification
- **Android:** Shows "Sign in to network" notification  
- **Windows:** Opens captive portal browser
- **macOS:** Shows "Login required" popup

### **Method 3: Command Line Testing**
```bash
# Test DNS hijacking
nslookup google.com
# Should return 192.168.100.1

# Test HTTP redirection  
curl -L http://google.com
# Should redirect to portal

# Check iptables rules
sudo iptables -t nat -L CAPTIVE_PORTAL
```

---

## 🛠️ Management Commands

### **Client Authentication**
```bash
# Allow client internet access
pisowifi-allow-client aa:bb:cc:dd:ee:ff

# Block client access
pisowifi-block-client aa:bb:cc:dd:ee:ff

# List authenticated clients
pisowifi-list-clients
```

### **Service Management**
```bash
# Restart network services
sudo systemctl restart hostapd dnsmasq nginx

# Check service status
sudo systemctl status hostapd
sudo systemctl status dnsmasq

# Monitor logs
sudo journalctl -f -u hostapd
sudo tail -f /var/log/dnsmasq.log
```

### **Network Debugging**
```bash
# Check WiFi interface
iwconfig wlan0

# Check connected clients
cat /var/lib/dhcp/dhcpd.leases

# Monitor traffic
sudo tcpdump -i wlan0

# Check iptables rules
sudo iptables -t nat -L -n -v
```

---

## 🔍 Troubleshooting

### **Portal Not Loading**
```bash
# Check if Next.js is running
netstat -tlnp | grep :3000

# Check iptables redirect rules
sudo iptables -t nat -L CAPTIVE_PORTAL -n -v

# Test direct access
curl http://192.168.100.1:3000/portal
```

### **WiFi Access Point Issues**
```bash
# Check hostapd status
sudo systemctl status hostapd

# Check WiFi interface
sudo iwconfig wlan0

# Restart WiFi services
sudo systemctl restart hostapd
sudo systemctl restart dnsmasq
```

### **Client Cannot Connect**
```bash
# Check DHCP leases
sudo cat /var/lib/dhcp/dhcpd.leases

# Check DNS resolution
nslookup google.com 192.168.100.1

# Test network connectivity
ping 192.168.100.1
```

### **Internet Access Not Working**
```bash
# Check internet connectivity from gateway
ping 8.8.8.8

# Check NAT rules
sudo iptables -t nat -L POSTROUTING -n -v

# Check IP forwarding
cat /proc/sys/net/ipv4/ip_forward
```

---

## 📊 Network Architecture

```
[Internet] 
    ↕
[Orange Pi Gateway]
192.168.100.1
    ↕
[WiFi Access Point]
"PISOWifi-Free"
    ↕
[Connected Clients]
192.168.100.10-100
```

### **Traffic Flow:**
1. **Unauthenticated:** HTTP → Portal, HTTPS → Blocked
2. **Authenticated:** All traffic → Internet via NAT
3. **Portal Access:** Always allowed to 192.168.100.1:3000

---

## 🎯 Next Steps

1. **✅ Network infrastructure is ready**
2. **⏳ Test with real devices connecting to WiFi**  
3. **⏳ Monitor client authentication flow**
4. **⏳ Verify automatic portal redirection**
5. **⏳ Test payment processing integration**

The captive portal network foundation is now complete! Clients connecting to the WiFi will automatically be redirected to your portal where they can purchase internet access.