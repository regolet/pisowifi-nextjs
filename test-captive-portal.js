#!/usr/bin/env node

/**
 * Captive Portal Testing Script
 * Tests various device detection endpoints
 */

const http = require('http');
const https = require('https');

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m'
};

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'localhost';

console.log(`${colors.cyan}${colors.bright}PISOWifi Captive Portal Test${colors.reset}`);
console.log(`${colors.cyan}Testing server at: http://${HOST}:${PORT}${colors.reset}\n`);

// Test endpoints for different devices
const tests = [
  {
    name: 'Android - generate_204',
    path: '/generate_204',
    expectedStatus: [204, 302],
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36'
    }
  },
  {
    name: 'iOS/macOS - hotspot-detect.html',
    path: '/hotspot-detect.html',
    expectedStatus: [200, 302],
    headers: {
      'User-Agent': 'CaptiveNetworkSupport/1.0 wispr'
    }
  },
  {
    name: 'Windows - connecttest.txt',
    path: '/connecttest.txt',
    expectedStatus: [200, 302],
    headers: {
      'User-Agent': 'Microsoft NCSI'
    }
  },
  {
    name: 'Firefox - canonical.html',
    path: '/canonical.html',
    expectedStatus: [200, 302],
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:91.0) Gecko/20100101 Firefox/91.0'
    }
  },
  {
    name: 'Chrome - connectivity check',
    path: '/connectivity-check.html',
    expectedStatus: [200, 302],
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/91.0.4472.124'
    }
  },
  {
    name: 'Portal Page',
    path: '/portal',
    expectedStatus: [200],
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  }
];

let passed = 0;
let failed = 0;

function makeRequest(test) {
  return new Promise((resolve) => {
    const options = {
      hostname: HOST,
      port: PORT,
      path: test.path,
      method: 'GET',
      headers: test.headers,
      timeout: 5000
    };

    const req = http.request(options, (res) => {
      let body = '';
      
      res.on('data', (chunk) => {
        body += chunk;
      });
      
      res.on('end', () => {
        const success = test.expectedStatus.includes(res.statusCode);
        
        if (success) {
          console.log(`${colors.green}✓${colors.reset} ${test.name}`);
          console.log(`  Status: ${res.statusCode}`);
          
          if (res.statusCode === 302) {
            console.log(`  Redirect: ${res.headers.location || 'N/A'}`);
          }
          
          passed++;
        } else {
          console.log(`${colors.red}✗${colors.reset} ${test.name}`);
          console.log(`  Expected: ${test.expectedStatus.join(' or ')}, Got: ${res.statusCode}`);
          failed++;
        }
        
        console.log('');
        resolve();
      });
    });

    req.on('error', (err) => {
      console.log(`${colors.red}✗${colors.reset} ${test.name}`);
      console.log(`  Error: ${err.message}`);
      console.log('');
      failed++;
      resolve();
    });

    req.on('timeout', () => {
      req.destroy();
      console.log(`${colors.red}✗${colors.reset} ${test.name}`);
      console.log(`  Error: Request timeout`);
      console.log('');
      failed++;
      resolve();
    });

    req.end();
  });
}

async function runTests() {
  console.log(`${colors.bright}Running Captive Portal Tests...${colors.reset}\n`);
  
  // Check if server is running
  try {
    await makeRequest({ 
      name: 'Server Health Check', 
      path: '/', 
      expectedStatus: [200, 302, 404],
      headers: {}
    });
  } catch (error) {
    console.log(`${colors.red}Error: Server is not running at http://${HOST}:${PORT}${colors.reset}`);
    console.log(`Please start the server with: npm run server\n`);
    process.exit(1);
  }
  
  // Run all tests
  for (const test of tests) {
    await makeRequest(test);
  }
  
  // Summary
  console.log(`${colors.bright}Test Summary:${colors.reset}`);
  console.log(`${colors.green}Passed: ${passed}${colors.reset}`);
  console.log(`${colors.red}Failed: ${failed}${colors.reset}`);
  
  if (failed === 0) {
    console.log(`\n${colors.green}${colors.bright}✓ All tests passed! Captive portal is working correctly.${colors.reset}`);
  } else {
    console.log(`\n${colors.yellow}${colors.bright}⚠ Some tests failed. Check your captive portal configuration.${colors.reset}`);
  }
  
  // Additional recommendations
  console.log(`\n${colors.cyan}${colors.bright}Recommendations:${colors.reset}`);
  console.log('1. Ensure the server is bound to all interfaces (0.0.0.0)');
  console.log('2. Check firewall rules allow traffic on port 3000');
  console.log('3. For production, use port 80 instead of 3000');
  console.log('4. Configure your router/AP to redirect DNS queries');
  console.log('5. Set up iptables rules to redirect HTTP traffic\n');
}

// Run tests
runTests().catch(console.error);