const express = require('express');
const router = express.Router();
const os = require('os');
const fs = require('fs');
const path = require('path');
const { authenticateAdmin } = require('../../middleware/security');

// Get device information
router.get('/info', authenticateAdmin, async (req, res) => {
  try {
    const cpus = os.cpus();
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    const memoryUsage = (usedMemory / totalMemory) * 100;

    // Get network interfaces
    const networkInterfaces = [];
    const interfaces = os.networkInterfaces();
    for (const [name, addrs] of Object.entries(interfaces)) {
      if (addrs) {
        for (const addr of addrs) {
          if (addr.family === 'IPv4' && !addr.internal) {
            networkInterfaces.push({
              name: name,
              ip: addr.address,
              mac: addr.mac,
              type: name.toLowerCase().includes('wlan') || name.toLowerCase().includes('wifi') ? 'wifi' : 'ethernet'
            });
          }
        }
      }
    }

    // Get CPU usage (average over all cores)
    let cpuUsage = 0;
    try {
      const cpuInfo = cpus[0];
      if (cpuInfo && cpuInfo.times) {
        const total = Object.values(cpuInfo.times).reduce((a, b) => a + b, 0);
        const idle = cpuInfo.times.idle;
        cpuUsage = ((total - idle) / total) * 100;
      }
    } catch (e) {
      cpuUsage = 0;
    }

    // Get disk usage
    let diskInfo = { total: 0, free: 0, used: 0, usage: 0 };
    try {
      if (process.platform === 'win32') {
        // Windows - use approximate values or run wmic
        const { execSync } = require('child_process');
        try {
          const output = execSync('wmic logicaldisk get size,freespace,caption', { encoding: 'utf8' });
          const lines = output.trim().split('\n').slice(1);
          for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 3 && parts[0] === 'C:') {
              diskInfo.free = parseInt(parts[1]) || 0;
              diskInfo.total = parseInt(parts[2]) || 0;
              diskInfo.used = diskInfo.total - diskInfo.free;
              diskInfo.usage = diskInfo.total > 0 ? (diskInfo.used / diskInfo.total) * 100 : 0;
            }
          }
        } catch (e) {
          // Fallback values
          diskInfo = { total: 100 * 1024 * 1024 * 1024, free: 50 * 1024 * 1024 * 1024, used: 50 * 1024 * 1024 * 1024, usage: 50 };
        }
      } else {
        // Linux/Mac
        const { execSync } = require('child_process');
        try {
          const output = execSync('df -B1 / | tail -1', { encoding: 'utf8' });
          const parts = output.trim().split(/\s+/);
          if (parts.length >= 4) {
            diskInfo.total = parseInt(parts[1]) || 0;
            diskInfo.used = parseInt(parts[2]) || 0;
            diskInfo.free = parseInt(parts[3]) || 0;
            diskInfo.usage = diskInfo.total > 0 ? (diskInfo.used / diskInfo.total) * 100 : 0;
          }
        } catch (e) {
          diskInfo = { total: 0, free: 0, used: 0, usage: 0 };
        }
      }
    } catch (e) {
      console.error('Error getting disk info:', e);
    }

    // Get database size
    let dbSize = 0;
    try {
      const dbPath = path.join(__dirname, '../../db/pisowifi.db');
      if (fs.existsSync(dbPath)) {
        const stats = fs.statSync(dbPath);
        dbSize = stats.size;
      }
    } catch (e) {
      console.error('Error getting database size:', e);
    }

    // Get serial number (platform specific)
    let serialNumber = 'N/A';
    try {
      const { execSync } = require('child_process');
      if (process.platform === 'win32') {
        const output = execSync('wmic bios get serialnumber', { encoding: 'utf8' });
        const lines = output.trim().split('\n');
        if (lines.length > 1) {
          serialNumber = lines[1].trim() || 'N/A';
        }
      } else if (process.platform === 'linux') {
        // Try Raspberry Pi serial first
        try {
          const cpuInfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
          const serialMatch = cpuInfo.match(/Serial\s*:\s*(\w+)/i);
          if (serialMatch) {
            serialNumber = serialMatch[1];
          }
        } catch (e) {
          // Try dmidecode
          try {
            serialNumber = execSync('sudo dmidecode -s system-serial-number 2>/dev/null', { encoding: 'utf8' }).trim() || 'N/A';
          } catch (e2) {
            serialNumber = 'N/A';
          }
        }
      } else if (process.platform === 'darwin') {
        serialNumber = execSync('system_profiler SPHardwareDataType | grep Serial', { encoding: 'utf8' }).split(':')[1]?.trim() || 'N/A';
      }
    } catch (e) {
      serialNumber = 'N/A';
    }

    const deviceInfo = {
      // System info
      hostname: os.hostname(),
      platform: os.platform(),
      osRelease: os.release(),
      arch: os.arch(),
      nodeVersion: process.version,
      
      // Hardware info
      cpuModel: cpus[0]?.model || 'Unknown',
      cpuCores: cpus.length,
      totalMemory: totalMemory,
      freeMemory: freeMemory,
      serialNumber: serialNumber,
      
      // Usage stats
      cpuUsage: cpuUsage,
      memoryUsage: memoryUsage,
      diskUsage: diskInfo.usage,
      uptime: os.uptime(),
      
      // Storage
      totalDisk: diskInfo.total,
      usedDisk: diskInfo.used,
      freeDisk: diskInfo.free,
      dbSize: dbSize,
      
      // Network
      networkInterfaces: networkInterfaces
    };

    res.json(deviceInfo);
  } catch (error) {
    console.error('Error getting device info:', error);
    res.status(500).json({ error: 'Failed to get device information' });
  }
});

module.exports = router;
