# Clear Browser HTTPS Cache for PISOWifi

## The Issue
Your browser has cached HTTPS preferences for your Orange Pi IP address, causing it to automatically redirect HTTP requests to HTTPS.

## Solutions (try in order):

### 1. Clear Browser Data (Recommended)
**Chrome/Edge:**
1. Press `Ctrl+Shift+Delete`
2. Select "All time" from time range
3. Check "Cookies and other site data"
4. Check "Cached images and files"
5. Click "Clear data"

**Firefox:**
1. Press `Ctrl+Shift+Delete`
2. Select "Everything" from time range
3. Check all boxes
4. Click "Clear Now"

### 2. Use Incognito/Private Mode
- Open a new incognito/private window
- Navigate to: `http://192.168.1.105:3000/admin/bypass`

### 3. Use Different Browser
- Try Firefox if using Chrome, or vice versa
- Fresh browser with no cached preferences

### 4. Clear HSTS Settings (Chrome)
1. Go to: `chrome://net-internals/#hsts`
2. In "Delete domain security policies" section
3. Enter: `192.168.1.105`
4. Click "Delete"

### 5. Reset Network Settings
```bash
# On your computer (Windows)
ipconfig /flushdns

# On Linux
sudo systemctl flush-dns
```

## After Clearing Cache:
1. Navigate directly to: `http://192.168.1.105:3000/admin/bypass`
2. Should work without HTTPS errors
3. All admin pages should now load properly over HTTP