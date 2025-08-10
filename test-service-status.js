#!/usr/bin/env node

// Test service status detection

const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

async function testServiceStatus() {
  console.log('=== Testing Service Status Detection ===');
  console.log('');

  // Test dnsmasq
  try {
    console.log('1. Testing dnsmasq...');
    const { stdout } = await execAsync('systemctl is-active dnsmasq');
    console.log(`   systemctl result: "${stdout.trim()}"`);
    console.log(`   Active: ${stdout.trim() === 'active'}`);
  } catch (error) {
    console.log(`   systemctl failed: ${error.message}`);
    
    try {
      const { stdout } = await execAsync('pgrep dnsmasq');
      console.log(`   pgrep result: PID ${stdout.trim()}`);
      console.log(`   Process running: true`);
    } catch (processError) {
      console.log(`   pgrep failed: ${processError.message}`);
    }
  }
  console.log('');

  // Test iptables
  try {
    console.log('2. Testing iptables NAT rules...');
    const { stdout: natRules } = await execAsync('sudo iptables -t nat -L PREROUTING -n 2>/dev/null || echo ""');
    console.log(`   NAT rules length: ${natRules.length}`);
    console.log(`   Contains DNAT: ${natRules.includes('DNAT')}`);
    console.log(`   Contains 3000: ${natRules.includes('3000')}`);
    console.log(`   Has redirect rules: ${natRules.includes('DNAT') && natRules.includes('3000')}`);
    
    console.log('3. Testing iptables INPUT rules...');
    const { stdout: inputRules } = await execAsync('sudo iptables -L INPUT -n 2>/dev/null || echo ""');
    console.log(`   INPUT rules length: ${inputRules.length}`);
    console.log(`   Contains tcp: ${inputRules.includes('tcp')}`);
    console.log(`   Contains 3000: ${inputRules.includes('3000')}`);
    console.log(`   Has input rules: ${inputRules.includes('tcp') && inputRules.includes('3000')}`);
  } catch (error) {
    console.log(`   iptables check failed: ${error.message}`);
  }
  console.log('');

  // Test pisowifi services
  console.log('4. Testing pisowifi services...');
  
  try {
    const { stdout } = await execAsync('systemctl is-active pisowifi-dynamic');
    console.log(`   pisowifi-dynamic: ${stdout.trim()}`);
  } catch (error) {
    console.log(`   pisowifi-dynamic: failed (${error.message.split('\n')[0]})`);
  }
  
  try {
    const { stdout } = await execAsync('systemctl is-active pisowifi-final');
    console.log(`   pisowifi-final: ${stdout.trim()}`);
  } catch (error) {
    console.log(`   pisowifi-final: failed (${error.message.split('\n')[0]})`);
  }
  console.log('');

  // Test the actual NetworkManager class
  console.log('5. Testing NetworkManager class...');
  try {
    const NetworkManager = require('./server/services/network-manager');
    const networkManager = new NetworkManager();
    const status = await networkManager.getServiceStatus();
    
    console.log('   Service status results:');
    console.log(`   - dnsmasq: ${status.dnsmasq?.active ? 'Active' : 'Inactive'} (${status.dnsmasq?.info})`);
    console.log(`   - hostapd: ${status.hostapd?.active ? 'Active' : 'Inactive'} (${status.hostapd?.info})`);
    console.log(`   - iptables: ${status.iptables?.active ? 'Active' : 'Inactive'} (${status.iptables?.info})`);
    console.log(`   - pisowifi: ${status.pisowifi?.active ? 'Active' : 'Inactive'} (${status.pisowifi?.info})`);
  } catch (error) {
    console.log(`   NetworkManager test failed: ${error.message}`);
  }
  
  console.log('');
  console.log('=== Test Complete ===');
}

testServiceStatus().catch(console.error);