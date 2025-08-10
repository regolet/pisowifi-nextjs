# 🍊 Orange Pi PISOWifi Installation Guide

This guide walks you through installing and configuring the PISOWifi Next.js application on your Orange Pi to create a complete coin-operated WiFi hotspot system.

## 📋 Prerequisites

- Orange Pi with fresh SD card installation
- SSH access to your Orange Pi
- Internet connection via Ethernet
- WiFi adapter (built-in or USB)

---

## 🚀 Installation Steps

### **Step 1: System Preparation**

```bash
# SSH into your Orange Pi
ssh orangepi@your-orange-pi-ip

# Update system packages
sudo apt update && sudo apt upgrade -y

# Install required system packages
sudo apt install -y git curl build-essential python3 python3-pip

# Navigate to installation directory
cd /home/orangepi
git clone <your-repo-url> pisowifi-nextjs
cd pisowifi-nextjs

# Pull latest changes
git pull
```

### **Step 2: Install Node.js**

```bash
# Install Node.js 18.x (recommended for Next.js 14)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version  # Should show v18.x.x
npm --version   # Should show 9.x.x or higher
```

### **Step 3: Install Project Dependencies**

```bash
# Install all npm packages
npm install

# Install PM2 for production process management
sudo npm install -g pm2
```

### **Step 4: Setup PostgreSQL Database**

```bash
# Install PostgreSQL (ARM architecture compatible)
sudo apt install postgresql postgresql-contrib -y

# Start and enable PostgreSQL service
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Switch to postgres user and create database
sudo -i -u postgres
createdb pisowifi
createuser --interactive --pwprompt pisowifi_user
# When prompted:
# - Enter password: pisowifi123
# - Shall the new role be a superuser? No
# - Shall the new role be allowed to create databases? Yes
# - Shall the new role be allowed to create more new roles? No

# Grant privileges and exit
psql -c "GRANT ALL PRIVILEGES ON DATABASE pisowifi TO pisowifi_user;"
exit

# Test connection
psql -h localhost -U pisowifi_user -d pisowifi -c "SELECT version();"
```

**Expected Output:**
```
 PostgreSQL 16.9 (Ubuntu 16.9-0ubuntu0.24.04.1) on arm-unknown-linux-gnueabihf, compiled by gcc (Ubuntu 13.3.0-6ubuntu2~24.04) 13.3.0, 32-bit
(1 row)
```

### **Step 5: Create Database Schema**

```bash
# Install PostgreSQL driver for Node.js
npm install pg @types/pg

# Create database tables
psql -h localhost -U pisowifi_user -d pisowifi -c "
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'ADMIN',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE clients (
    id SERIAL PRIMARY KEY,
    mac_address VARCHAR(17) UNIQUE NOT NULL,
    ip_address VARCHAR(15),
    device_name VARCHAR(100),
    status VARCHAR(20) DEFAULT 'DISCONNECTED',
    time_remaining INTEGER DEFAULT 0,
    session_start TIMESTAMP,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE rates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    duration INTEGER NOT NULL,
    coins_required INTEGER NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
    id SERIAL PRIMARY KEY,
    client_id INTEGER REFERENCES clients(id),
    mac_address VARCHAR(17) NOT NULL,
    ip_address VARCHAR(15),
    duration INTEGER NOT NULL,
    status VARCHAR(20) DEFAULT 'ACTIVE',
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP
);

CREATE TABLE transactions (
    id SERIAL PRIMARY KEY,
    client_id INTEGER REFERENCES clients(id),
    session_id INTEGER REFERENCES sessions(id),
    rate_id INTEGER REFERENCES rates(id),
    coins_inserted INTEGER NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    duration INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE system_logs (
    id SERIAL PRIMARY KEY,
    level VARCHAR(10) NOT NULL,
    message TEXT NOT NULL,
    category VARCHAR(50),
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
"

# Insert default data
psql -h localhost -U pisowifi_user -d pisowifi -c "
-- Insert default admin user (password: admin123 hashed with bcrypt)
INSERT INTO users (username, email, password, role) VALUES 
('admin', 'admin@pisowifi.local', '\$2a\$10\$rOZjTh0ij.6R3S/ZXCR1Ie9BSP8BH7zXrZ5sPm0XL6Zl8MnI4lCGK', 'ADMIN');

-- Insert default rate packages
INSERT INTO rates (name, duration, coins_required, price, is_active) VALUES 
('15 Minutes', 900, 1, 5.00, true),
('30 Minutes', 1800, 2, 10.00, true),
('1 Hour', 3600, 4, 20.00, true),
('2 Hours', 7200, 8, 40.00, true);

-- Log system setup
INSERT INTO system_logs (level, message, category) VALUES 
('INFO', 'Database schema created and default data inserted', 'setup');
"

# Verify tables were created
psql -h localhost -U pisowifi_user -d pisowifi -c "\dt"
```

### **Step 6: Configure Network (Captive Portal)**

```bash
# Run the captive portal setup script
sudo bash scripts/setup-captive-portal.sh
```

This script will configure:
- **WiFi Access Point** - Creates "PISOWifi-Free" network
- **DHCP Server** - Assigns IP addresses to clients (192.168.100.10-100)
- **DNS Hijacking** - Redirects all DNS queries to portal
- **iptables Rules** - Controls traffic flow and authentication
- **Nginx Proxy** - Handles HTTP redirects to portal

**Expected Output:**
```
✅ Captive Portal Setup Complete!
==================================
📡 WiFi Network: PISOWifi-Free
🌐 Portal IP: 192.168.100.1
🔗 Portal URL: http://192.168.100.1:3000/portal
```

### **Step 7: Environment Configuration**

```bash
# Copy environment file
cp .env.example .env

# Edit environment variables
nano .env
```

**Critical settings to update:**
```env
# Database (PostgreSQL for ARM compatibility)
DATABASE_URL="postgresql://pisowifi_user:pisowifi123@localhost:5432/pisowifi"

# Authentication
NEXTAUTH_SECRET="your-secret-key-here"
NEXTAUTH_URL="http://192.168.100.1:3000"
JWT_SECRET="your-super-secret-jwt-key-change-this-in-production"

# GPIO Service
GPIO_SERVICE_URL="http://localhost:3001"
```

### **Step 8: Build & Start Application**

```bash
# Build the Next.js application
npm run build

# Start with PM2 for production
pm2 start npm --name "pisowifi-app" -- start

# Start GPIO service
pm2 start npm --name "pisowifi-gpio" -- run gpio

# Save PM2 configuration and setup auto-startup
pm2 save
pm2 startup
```

**Expected Output:**
```
┌─────────────────┬────┬─────────┬──────┬───────┬────────┐
│ Name            │ id │ status  │ cpu  │ mem   │ watch  │
├─────────────────┼────┼─────────┼──────┼───────┼────────┤
│ pisowifi-app    │ 0  │ online  │ 0%   │ 45.2mb│ false  │
│ pisowifi-gpio   │ 1  │ online  │ 0%   │ 22.1mb│ false  │
└─────────────────┴────┴─────────┴──────┴───────┴────────┘
```

---

## 🧪 Testing & Verification

### **Step 9: Verify Installation**

```bash
# Check PM2 services status
pm2 status

# Check network services
sudo systemctl status hostapd
sudo systemctl status dnsmasq
sudo systemctl status nginx

# Test application endpoints
curl http://localhost:3000                    # Next.js app
curl http://localhost:3001/status            # GPIO service
curl http://192.168.100.1:3000/portal       # Portal via network IP
```

### **Step 10: Test Captive Portal**

1. **Connect a device** to "PISOWifi-Free" WiFi network
2. **Open any website** in browser - should redirect to portal automatically
3. **Access admin panel:** `http://192.168.100.1:3000/admin`
4. **Login credentials:** 
   - Username: `admin`
   - Password: `admin123`

### **Step 11: Test Coin Detection (Optional)**

```bash
# Test GPIO coin detection
curl -X POST http://localhost:3001/test-coin

# Check GPIO service logs
pm2 logs pisowifi-gpio
```

---

## 🛠️ Management Commands

### **Service Management**
```bash
# PM2 Application Management
pm2 status                      # Check service status
pm2 restart all                 # Restart all services
pm2 logs pisowifi-app           # View app logs
pm2 logs pisowifi-gpio          # View GPIO logs
pm2 monit                       # Real-time monitoring

# Network Services
sudo systemctl restart hostapd dnsmasq nginx
sudo systemctl status hostapd
sudo systemctl status dnsmasq
```

### **Client Management**
```bash
# Allow client internet access
pisowifi-allow-client aa:bb:cc:dd:ee:ff

# Block client access
pisowifi-block-client aa:bb:cc:dd:ee:ff

# List authenticated clients
pisowifi-list-clients
```

### **Network Debugging**
```bash
# Check network connectivity
ping 8.8.8.8                    # Internet connectivity
iwconfig wlan0                  # WiFi interface status
sudo iptables -t nat -L -n -v   # Firewall rules
cat /var/lib/dhcp/dhcpd.leases  # DHCP leases

# Monitor traffic
sudo tcpdump -i wlan0           # Monitor WiFi traffic
sudo journalctl -f -u hostapd   # Monitor hostapd logs
```

---

## 🚨 Troubleshooting

### **Common Issues & Solutions**

#### **1. WiFi Access Point Not Broadcasting**
```bash
# Check WiFi interface
iwconfig
sudo systemctl status hostapd
sudo systemctl restart hostapd

# Check interface configuration
ip addr show wlan0
```

#### **2. Clients Can't Get IP Address**
```bash
# Check DHCP service
sudo systemctl status dnsmasq
sudo systemctl restart dnsmasq

# Check DHCP leases
sudo cat /var/lib/dhcp/dhcpd.leases
```

#### **3. Portal Not Redirecting**
```bash
# Check nginx configuration
sudo nginx -t
sudo systemctl restart nginx

# Check iptables rules
sudo iptables -t nat -L CAPTIVE_PORTAL -n -v
```

#### **4. App Won't Start**
```bash
# Check logs for errors
pm2 logs pisowifi-app
npm run build  # Rebuild if needed

# Check port availability
netstat -tlnp | grep :3000
```

#### **5. GPIO Service Issues**
```bash
# Check GPIO service logs
pm2 logs pisowifi-gpio

# Test GPIO manually
python3 -c "import OPi.GPIO as GPIO; print('GPIO OK')"
```

### **Reset Network Configuration**
```bash
# Stop all services
sudo systemctl stop hostapd dnsmasq nginx

# Clear iptables rules
sudo iptables -F
sudo iptables -X
sudo iptables -t nat -F
sudo iptables -t nat -X

# Re-run setup script
sudo bash scripts/setup-captive-portal.sh
```

---

## 📊 System Information

### **Network Configuration**
- **Gateway IP:** 192.168.100.1
- **Client Range:** 192.168.100.10 - 192.168.100.100
- **WiFi Network:** PISOWifi-Free (Open)
- **Portal URL:** http://192.168.100.1:3000/portal
- **Admin Panel:** http://192.168.100.1:3000/admin

### **Default Credentials**
- **Admin Username:** admin
- **Admin Password:** admin123
- **Admin Email:** admin@pisowifi.local

### **Service Ports**
- **Next.js App:** 3000
- **GPIO Service:** 3001
- **PostgreSQL:** 5432
- **Nginx:** 80
- **SSH:** 22

---

## 🔐 Security Recommendations

1. **Change default admin password** immediately after installation
2. **Update JWT_SECRET** in .env file with a strong random key
3. **Enable SSH key authentication** and disable password login
4. **Setup firewall rules** for external access if needed
5. **Regular system updates:** `sudo apt update && sudo apt upgrade`

---

## 🎯 Next Steps

1. **Customize portal branding** and themes
2. **Configure coin denominations** and rates  
3. **Setup voucher system** for prepaid codes
4. **Install monitoring** and reporting tools
5. **Setup backup system** for database and configuration

---

## 📞 Support

If you encounter issues during installation:

1. **Check logs:** `pm2 logs` and `sudo journalctl -f`
2. **Verify network:** `ping`, `iwconfig`, `iptables -L`
3. **Review troubleshooting** section above
4. **Check GitHub issues** for known problems

---

**🎉 Installation Complete!** 

Your PISOWifi system is now ready to serve clients. Connect devices to "PISOWifi-Free" and they'll be redirected to your coin-operated internet portal.