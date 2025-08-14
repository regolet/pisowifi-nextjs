# Windows Captive Portal Setup Script for PISOWifi
# Run as Administrator

Write-Host "PISOWifi Windows Captive Portal Setup" -ForegroundColor Green
Write-Host "======================================" -ForegroundColor Green

# Check if running as administrator
if (-NOT ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host "This script requires Administrator privileges. Please run as Administrator." -ForegroundColor Red
    exit 1
}

# Get network adapter information
$adapter = Get-NetAdapter | Where-Object {$_.Status -eq "Up" -and $_.Name -like "*Wi-Fi*"}

if ($adapter) {
    Write-Host "Found WiFi adapter: $($adapter.Name)" -ForegroundColor Cyan
} else {
    $adapter = Get-NetAdapter | Where-Object {$_.Status -eq "Up" -and $_.Name -like "*Ethernet*"}
    if ($adapter) {
        Write-Host "Found Ethernet adapter: $($adapter.Name)" -ForegroundColor Cyan
    } else {
        Write-Host "No active network adapter found!" -ForegroundColor Red
        exit 1
    }
}

# Function to add hosts file entry
function Add-HostsEntry {
    param(
        [string]$IPAddress,
        [string]$Hostname
    )
    
    $hostsFile = "$env:windir\System32\drivers\etc\hosts"
    $entry = "$IPAddress`t$Hostname"
    
    # Check if entry already exists
    $content = Get-Content $hostsFile
    if ($content -notcontains $entry) {
        Add-Content -Path $hostsFile -Value $entry
        Write-Host "Added hosts entry: $entry" -ForegroundColor Green
    } else {
        Write-Host "Hosts entry already exists: $entry" -ForegroundColor Yellow
    }
}

# Setup hosts file for common connectivity check domains
Write-Host "`nSetting up hosts file entries for captive portal detection..." -ForegroundColor Cyan

$pisowifiIP = "192.168.100.1"

# Add common connectivity check domains
$domains = @(
    "connectivitycheck.gstatic.com",
    "clients3.google.com",
    "captive.apple.com",
    "www.apple.com",
    "www.msftconnecttest.com",
    "www.msftncsi.com",
    "detectportal.firefox.com"
)

foreach ($domain in $domains) {
    Add-HostsEntry -IPAddress $pisowifiIP -Hostname $domain
}

# Setup Windows Firewall rules
Write-Host "`nSetting up Windows Firewall rules..." -ForegroundColor Cyan

# Remove existing rules if they exist
Remove-NetFirewallRule -DisplayName "PISOWifi Captive Portal*" -ErrorAction SilentlyContinue

# Allow inbound HTTP traffic
New-NetFirewallRule -DisplayName "PISOWifi Captive Portal HTTP" `
    -Direction Inbound -Protocol TCP -LocalPort 80,3000 -Action Allow `
    -Profile Any -Enabled True | Out-Null
Write-Host "Created firewall rule for HTTP traffic" -ForegroundColor Green

# Allow WebSocket traffic
New-NetFirewallRule -DisplayName "PISOWifi Captive Portal WebSocket" `
    -Direction Inbound -Protocol TCP -LocalPort 3001,3002 -Action Allow `
    -Profile Any -Enabled True | Out-Null
Write-Host "Created firewall rule for WebSocket traffic" -ForegroundColor Green

# Setup HTTP Server certificate binding (for development)
Write-Host "`nChecking HTTP bindings..." -ForegroundColor Cyan

# Check if URL ACL exists
$urlAcl = netsh http show urlacl url=http://+:3000/ 2>$null
if ($LASTEXITCODE -ne 0) {
    netsh http add urlacl url=http://+:3000/ user=Everyone | Out-Null
    Write-Host "Added URL ACL for port 3000" -ForegroundColor Green
} else {
    Write-Host "URL ACL already exists for port 3000" -ForegroundColor Yellow
}

# Flush DNS cache
Write-Host "`nFlushing DNS cache..." -ForegroundColor Cyan
ipconfig /flushdns | Out-Null
Write-Host "DNS cache flushed" -ForegroundColor Green

# Set network profile to private (allows local network discovery)
Write-Host "`nSetting network profile to Private..." -ForegroundColor Cyan
Set-NetConnectionProfile -InterfaceIndex $adapter.InterfaceIndex -NetworkCategory Private
Write-Host "Network profile set to Private" -ForegroundColor Green

# Display current network configuration
Write-Host "`nCurrent Network Configuration:" -ForegroundColor Cyan
Get-NetIPConfiguration -InterfaceIndex $adapter.InterfaceIndex | Format-List

# Test connectivity
Write-Host "`nTesting captive portal detection..." -ForegroundColor Cyan

$testUrls = @(
    "http://192.168.100.1:3000/generate_204",
    "http://192.168.100.1:3000/hotspot-detect.html",
    "http://192.168.100.1:3000/connecttest.txt"
)

foreach ($url in $testUrls) {
    try {
        $response = Invoke-WebRequest -Uri $url -Method Head -MaximumRedirection 0 -ErrorAction SilentlyContinue
        if ($response.StatusCode -eq 302) {
            Write-Host "✓ $url - Redirect detected (Working)" -ForegroundColor Green
        } else {
            Write-Host "✗ $url - Status: $($response.StatusCode)" -ForegroundColor Yellow
        }
    } catch {
        if ($_.Exception.Response.StatusCode -eq 302) {
            Write-Host "✓ $url - Redirect detected (Working)" -ForegroundColor Green
        } else {
            Write-Host "✗ $url - Error: $($_.Exception.Message)" -ForegroundColor Red
        }
    }
}

Write-Host "`n======================================" -ForegroundColor Green
Write-Host "Captive Portal Setup Complete!" -ForegroundColor Green
Write-Host "Please restart your PISOWifi server for changes to take effect." -ForegroundColor Yellow
Write-Host ""
Write-Host "To test:" -ForegroundColor Cyan
Write-Host "1. Start the PISOWifi server: npm run server" -ForegroundColor White
Write-Host "2. Connect a device to the WiFi network" -ForegroundColor White
Write-Host "3. The device should automatically show the captive portal" -ForegroundColor White