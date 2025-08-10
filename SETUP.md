# 🍊 Orange Pi PISOWifi Installation Guide

This guide walks you through installing and configuring the PISOWifi Express.js application on your Orange Pi to create a complete coin-operated WiFi hotspot system.

## 📋 Prerequisites

- Orange Pi with fresh SD card installation
- SSH access to your Orange Pi
- Internet connection via Ethernet (built-in port)
- USB-to-LAN adapter connected to WiFi router (for hotspot network)
- WiFi router configured in AP mode

---

## 🚀 Installation Steps

### **Step 1: System Preparation**

```bash
# SSH into your Orange Pi (as root or with sudo)
ssh root@your-orange-pi-ip

# Update system packages
sudo apt update && sudo apt upgrade -y

# Install required system packages
sudo apt install -y git curl build-essential python3 python3-pip net-tools

# Clone the repository
cd ~
git clone <your-repo-url> pisowifi-nextjs
cd pisowifi-nextjs

# Pull latest changes
git pull
```

### **Step 2: Install Node.js**

```bash
# Install Node.js 18.x (works with ARM architecture)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version  # Should show v18.x.x
npm --version   # Should show 9.x.x or higher
```

### **Step 3: Switch to Express.js and Install Dependencies**

```bash
# Use the Express.js package configuration
cp package-express.json package.json

# Install Express.js dependencies (ARM compatible)
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

### **Step 5: Create Database Schema**

```bash
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
```

### **Step 6: Configure Network Interfaces**

```bash
# Check your network interfaces
ip link show
# You should see:
# - end0 or eth0 (built-in Ethernet for internet)
# - enx... (USB-to-LAN adapter for hotspot network)

# Set static IP on USB-LAN interface (replace enx00e04c68276e with your interface name)
sudo ip addr add 192.168.100.1/24 dev enx00e04c68276e
sudo ip link set enx00e04c68276e up

# Verify IP is assigned
ip addr show enx00e04c68276e
```

### **Step 7: Setup DHCP and DNS (dnsmasq)**

```bash
# Install dnsmasq
sudo apt install dnsmasq -y

# Stop systemd-resolved (conflicts with dnsmasq on port 53)
sudo systemctl stop systemd-resolved
sudo systemctl disable systemd-resolved

# Fix DNS resolution
sudo rm -f /etc/resolv.conf
echo "nameserver 8.8.8.8" | sudo tee /etc/resolv.conf
echo "nameserver 8.8.4.4" | sudo tee -a /etc/resolv.conf

# Configure dnsmasq
sudo nano /etc/dnsmasq.conf
```

Add this configuration (replace interface name with yours):
```
interface=enx00e04c68276e
dhcp-range=192.168.100.10,192.168.100.100,12h
dhcp-option=3,192.168.100.1
dhcp-option=6,192.168.100.1
address=/#/192.168.100.1
domain-needed
bogus-priv
no-resolv
log-queries
log-dhcp
```

```bash
# Start dnsmasq
sudo systemctl start dnsmasq
sudo systemctl enable dnsmasq
```

### **Step 8: Setup HTTP Redirection (nginx)**

```bash
# Install nginx
sudo apt install nginx -y

# Create captive portal redirect configuration
sudo nano /etc/nginx/sites-available/portal
```

Add this configuration:
```nginx
server {
    listen 80;
    server_name _;
    
    location / {
        return 302 http://192.168.100.1:3000/portal;
    }
    
    location = /generate_204 {
        return 302 http://192.168.100.1:3000/portal;
    }
    
    location = /connecttest.txt {
        return 302 http://192.168.100.1:3000/portal;
    }
}
```

```bash
# Enable the configuration
sudo ln -s /etc/nginx/sites-available/portal /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Test and start nginx
sudo nginx -t
sudo systemctl start nginx
sudo systemctl enable nginx
```

### **Step 9: Enable IP Forwarding**

```bash
# Enable IP forwarding for internet sharing
sudo sysctl -w net.ipv4.ip_forward=1
echo "net.ipv4.ip_forward=1" | sudo tee -a /etc/sysctl.conf
```

### **Step 10: Environment Configuration**

```bash
# Copy environment file
cp .env.example .env

# Edit environment variables
nano .env
```

Update with these values:
```env
# Database (PostgreSQL for ARM compatibility)
DATABASE_URL="postgresql://pisowifi_user:pisowifi123@localhost:5432/pisowifi"

# Authentication
JWT_SECRET="your-super-secret-jwt-key-change-this-in-production"

# GPIO Service
GPIO_SERVICE_URL="http://localhost:3001"
```

### **Step 11: Start the Application**

```bash
# Start Express app with PM2
cd ~/pisowifi-nextjs
pm2 start npm --name "pisowifi" -- run dev

# Start GPIO service (optional)
pm2 start npm --name "pisowifi-gpio" -- run gpio

# Save PM2 configuration
pm2 save
pm2 startup

# Check status
pm2 status
```

### **Step 12: Configure Your WiFi Router**

Connect your WiFi router to the USB-LAN adapter and configure:

1. **Set Router to AP Mode** (Access Point/Bridge mode)
2. **Disable DHCP** on the router (Orange Pi handles DHCP)
3. **Set Router IP:** 192.168.100.2
4. **Connect router's LAN port** (not WAN) to USB-LAN adapter
5. **Set WiFi SSID:** "PISOWifi-Free" (or your preferred name)

---

## 🧪 Testing & Verification

### **Verify All Services**

```bash
# Check services are running
sudo systemctl status dnsmasq
sudo systemctl status nginx
pm2 status

# Check network ports
sudo ss -tlnp | grep -E ':53|:67|:80|:3000'
# Should show:
# :53 (DNS - dnsmasq)
# :67 (DHCP - dnsmasq)
# :80 (HTTP - nginx)
# :3000 (Express app)
```

### **Test Captive Portal**

1. **Connect a device** to your WiFi router's network
2. **Device should get IP** in range 192.168.100.10-100
3. **Open browser** and visit any http:// website
4. **Should redirect** to http://192.168.100.1:3000/portal

### **Test Portal Features**

1. **Portal Access:** http://192.168.100.1:3000/portal
2. **Admin Panel:** http://192.168.100.1:3000/admin
   - Username: `admin`
   - Password: `admin123`
3. **Test coin detection:** Click "Test Coin" button on portal

---

## 🛠️ Management Commands

### **Service Management**
```bash
# PM2 Application Management
pm2 status                      # Check service status
pm2 restart all                 # Restart all services
pm2 logs pisowifi               # View app logs
pm2 logs pisowifi-gpio          # View GPIO logs
pm2 monit                       # Real-time monitoring

# System Services
sudo systemctl restart dnsmasq nginx
sudo systemctl status dnsmasq
sudo systemctl status nginx
```

### **Network Monitoring**
```bash
# Check connected clients
arp -a | grep 192.168.100

# Monitor DHCP leases
sudo journalctl -f -u dnsmasq

# Check DNS queries
sudo tail -f /var/log/syslog | grep dnsmasq

# Test DNS hijacking
dig @192.168.100.1 google.com
```

---

## 🚨 Troubleshooting

### **Common Issues & Solutions**

#### **1. No WiFi Network Visible**
This setup uses Ethernet with an external WiFi router. Make sure:
- Router is powered on and in AP mode
- Router is connected to USB-LAN adapter
- Router DHCP is disabled

#### **2. Portal Not Redirecting**
```bash
# Check dnsmasq is running
sudo systemctl status dnsmasq

# Check nginx is running
sudo systemctl status nginx

# Test DNS hijacking
nslookup google.com 192.168.100.1
# Should return 192.168.100.1

# Test HTTP redirect
curl -I http://192.168.100.1/
# Should show 302 redirect
```

#### **3. Express App Not Starting**
```bash
# Check logs
pm2 logs pisowifi

# Make sure you're in the right directory
cd ~/pisowifi-nextjs

# Restart the app
pm2 restart pisowifi
```

#### **4. Port 53 Already in Use**
```bash
# Check what's using port 53
sudo ss -tlnup | grep :53

# Stop systemd-resolved if running
sudo systemctl stop systemd-resolved
sudo systemctl disable systemd-resolved

# Restart dnsmasq
sudo systemctl restart dnsmasq
```

#### **5. Network Interface Not Found**
```bash
# List all interfaces
ip link show

# Find your USB-LAN adapter (usually starts with enx)
# Update all configurations with the correct interface name
```

---

## 📊 System Information

### **Network Configuration**
- **Gateway IP:** 192.168.100.1
- **Client Range:** 192.168.100.10 - 192.168.100.100
- **Portal URL:** http://192.168.100.1:3000/portal
- **Admin Panel:** http://192.168.100.1:3000/admin

### **Network Topology**
```
Internet → [end0/eth0] Orange Pi [enx...] → WiFi Router → Clients
              ↓                        ↓
         (WAN Interface)        (LAN Interface)
                              192.168.100.1/24
```

### **Default Credentials**
- **Admin Username:** admin
- **Admin Password:** admin123
- **Database User:** pisowifi_user
- **Database Password:** pisowifi123

### **Service Ports**
- **Express App:** 3000
- **GPIO Service:** 3001
- **PostgreSQL:** 5432
- **Nginx:** 80
- **DNS (dnsmasq):** 53
- **DHCP (dnsmasq):** 67
- **SSH:** 22

---

## 🔐 Security Recommendations

1. **Change default admin password** immediately after installation
2. **Update JWT_SECRET** in .env file with a strong random key
3. **Enable SSH key authentication** and disable password login
4. **Setup firewall rules** for external access if needed
5. **Regular system updates:** `sudo apt update && sudo apt upgrade`
6. **Secure PostgreSQL** with strong passwords
7. **Monitor access logs** regularly

---

## 🎯 Next Steps

1. **Install real coin acceptor** hardware on GPIO pins
2. **Customize portal design** and branding
3. **Configure different rate packages** and pricing
4. **Implement voucher system** for prepaid codes
5. **Add usage reporting** and analytics
6. **Setup automated backups** for database

---

## 📞 Support

If you encounter issues:

1. **Check logs:** 
   - `pm2 logs pisowifi`
   - `sudo journalctl -f -u dnsmasq`
   - `sudo journalctl -f -u nginx`
2. **Verify network:** 
   - `ip addr show`
   - `sudo ss -tlnp`
   - `ping 192.168.100.1`
3. **Test services:**
   - `curl http://localhost:3000/portal`
   - `dig @192.168.100.1 google.com`
4. **Review this guide** for troubleshooting steps

---

## 🎉 **Installation Complete!**

Your PISOWifi system is now ready! The captive portal will automatically redirect connected devices to the payment portal where they can purchase internet access with coins.

**Portal Features:**
- ✅ Automatic portal redirection
- ✅ Coin detection simulation
- ✅ Multiple rate packages
- ✅ Admin dashboard
- ✅ Real-time client monitoring
- ✅ ARM architecture compatibility with Express.js

Connect devices to your WiFi router and they'll be redirected to the coin-operated internet portal!