#!/usr/bin/env node
/**
 * PISOWifi GPIO Bridge Service
 * ============================
 * 
 * This service provides GPIO access for the Next.js PISOWifi system.
 * It interfaces with Orange Pi hardware and provides REST API + WebSocket.
 */

const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3000", "http://192.168.100.1:3000"],
    methods: ["GET", "POST"]
  }
});

// Configuration
const CONFIG = {
  PORT: process.env.GPIO_SERVICE_PORT || 3001,
  COIN_PIN: process.env.GPIO_PIN_COIN || '3',
  LED_PIN: process.env.GPIO_PIN_LED || '5',
  DEBOUNCE_TIME: 50, // milliseconds
  PULSE_DURATION: 200, // milliseconds for LED pulse
};

// State management
let gpioState = {
  available: false,
// Valid coin values (Standard Philippine Coins + Dynamic Rates)
let validCoinValues = [1, 5, 10, 20]; // Defaults

  library: null,
  coinPin: null,
  ledPin: null,
  status: 'Initializing',
  lastCoinTime: 0,
  coinCount: 0,
  isMonitoring: false
};

let connectedClients = new Set();

// Middleware
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

/**
 * Initialize GPIO pins
 */
async function initializeGPIO() {
  console.log('🔧 Initializing GPIO...');
  if (db && typeof db.query === 'function') {
      await updateCoinRates();
    }
    
    
  try {
    // Check if we're on Orange Pi with OPi.GPIO
    const gpioTest = spawn('python3', ['-c', 'import OPi.GPIO as GPIO; print("OPi_GPIO_OK")'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    gpioTest.stdout.on('data', (data) => {
      if (data.toString().includes('OPi_GPIO_OK')) {
        gpioState.library = 'OPi';
        gpioState.available = true;
        gpioState.status = 'Ready';
        console.log('✅ Orange Pi GPIO library detected');
        setupGPIOPins();
      }
    });

    gpioTest.stderr.on('data', (data) => {
      console.log('⚠️ Orange Pi GPIO not available, trying alternatives...');
      // Could add RPi.GPIO or mock GPIO here
      setupMockGPIO();
    });

    gpioTest.on('close', (code) => {
      if (code !== 0 && !gpioState.available) {
        console.log('🔄 Setting up mock GPIO for development...');
        setupMockGPIO();
      }
    });

    setTimeout(() => {
      if (!gpioState.available) {
        console.log('🔄 GPIO timeout, using mock mode...');
        setupMockGPIO();
      }
    }, 3000);

  }Fetch active coin rates from database to support "Smart Pulse Adjustment"
 */
async function updateCoinRates() {
  if (!db) return;
  
  try {
    console.log('🔄 Fetching active coin rates for pulse calibration...');
    const result = await db.query('SELECT DISTINCT price FROM rates WHERE is_active = true');
    
    // Merge standard coins with any custom rate prices (treating price as potential pulse count)
    const dbRates = result.rows.map(r => Math.round(parseFloat(r.price)));
    const allRates = new Set([...validCoinValues, ...dbRates]);
    
    validCoinValues = Array.from(allRates).sort((a, b) => a - b);
    console.log('✅ Calibrated Coin Values:', validCoinValues);
    
  } catch (error) {
    console.warn('⚠️ Failed to update coin rates:', error.message);
  }
}

/**
 *  catch (error) {
    console.error('❌ GPIO initialization error:', error);
    setupMockGPIO();
  }
}

/**
 * Setup real GPIO pins
 */
function setupGPIOPins() {
  console.log(`🔌 Setting up GPIO pins - Coin: ${CONFIG.COIN_PIN}, LED: ${CONFIG.LED_PIN}`);
  
  const gpioScript = `
import OPi.GPIO as GPIO
import time
import sys
import json

def setup_pins():
    try:
        GPIO.cleanup()
        GPIO.setmode(GPIO.BOARD)
        GPIO.setup(${CONFIG.COIN_PIN}, GPIO.IN, pull_up_down=GPIO.PUD_UP)
        GPIO.setup(${CONFIG.LED_PIN}, GPIO.OUT)
        GPIO.output(${CONFIG.LED_PIN}, False)
        print(json.dumps({"status": "success", "message": "GPIO pins configured"}))
        return True
    except Exception as e:
        print(json.dumps({"status": "error", "message": str(e)}))
        return False

if setup_pins():
    # Keep process alive for monitoring
    try:
        while True:
            time.sleep(0.1)
    except KeyboardInterrupt:
        GPIO.cleanup()
        print(json.dumps({"status": "cleanup", "message": "GPIO cleaned up"}))
`;

  // Write and execute GPIO setup script
  fs.writeFileSync('/tmp/gpio_setup.py', gpioScript);
  
  gpioState.coinPin = spawn('python3', ['/tmp/gpio_setup.py'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  gpioState.coinPin.stdout.on('data', (data) => {
    try {
      const result = JSON.parse(data.toString());
      if (result.status === 'success') {
        console.log('✅ GPIO pins configured successfully');
        startCoinMonitoring();
      }
    } catch (e) {
      console.log('GPIO output:', data.toString());
    }
  });

  gpioState.coinPin.stderr.on('data', (data) => {
    console.error('GPIO error:', data.toString());
  });
}

/**
 * Setup mock GPIO for development
 */
function setupMockGPIO() {
  console.log('🔄 Setting up mock GPIO for development...');
  gpioState.available = true;
  gpioState.library = 'Mock';
  gpioState.status = 'Mock Ready';
  
  // Simulate coin detection every 10 seconds in dev mode
  if (process.env.NODE_ENV === 'development') {
    setInterval(() => {
      if (Math.random() < 0.1) { // 10% chance every interval
        handleCoinDetection();
      }
    }, 2000);
  }
}

/**
 * Start monitoring for coin detection
 */
function startCoinMonitoring() {
  if (gpioState.isMonitoring) return;
  
  console.log('👁️ Starting coin detection monitoring...');
  gpioState.isMonitoring = true;

  const monitorScript = `
import OPi.GPIO as GPIO
import time
import json
import sys
Send raw pulse batch to Node.js for Smart Processing
                print(json.dumps({
                    "type": "pulse_batch",
                    "timestamp": now,
                    "count LED immediately for visual feedback
                    GPIO.output(${CONFIG.LED_PIN}, True)
                    time.sleep(0.05) # Short blink
                    GPIO.output(${CONFIG.LED_PIN}, False)
            
            # Check if pulse batch is complete
            if pulse_count > 0 and (now - last_pulse_time) > BATCH_TIMEOUT:
                # Analyze pulse count and determine value
                final_value = pulse_count # Default 1 pulse = 1 peso
                
                # Smart correction logic (The "Coin Rate" adjustment)
                if pulse_count == 4:
                    final_value = 5 # Fix 4 pulses -> 5 pesos
                elif pulse_count == 5:
                    final_value = 5
                elif pulse_count >= 9 and pulse_count <= 10:
                    final_value = 10
                elif pulse_count >= 19 and pulse_count <= 20:
                    final_value = 20
                
                # Send processed coin event
                print(json.dumps({
                    "type": "coin_detected",
                    "timestamp": now,
                    "count": 1, 
                    "value": final_value,
                    "pulses": pulse_count
                }))
                sys.stdout.flush()
                
                pulse_count = 0 
            
            last_state = current_state
            time.sleep(0.01)  # 10ms loop
            
        except Exception as e:
            print(json.dumps({
                "type": "error",
                "message": str(e)
            }))
            time.sleep(1)

if __name__ == "__main__":
    monitor_output = data.toString().trim();
      // Handle multiple JSON objects in one chunk
      const lines = output.split('\n');
      
      lines.forEach(line => {
        if (!line) return;
        try {
          const event = JSON.parse(line);
          if (event.type === 'pulse_batch' || event.type === 'coin_detected') {
            handleCoinDetection(event);
          }
        } catch (parseErr) {
           // ignore partial lines
        }
      });
    } catch (e) {
      console.log('Monitor output error, ['/tmp/coin_monitor.py'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  monitor.stdout.on('data', (data) => {
    try {
      const event = JSON.parse(data.toString());
      if (event.type === 'coin_detected') {
        handleCoinDetection(event);
      }
    } catch (e) {
      console.log('Monitor output:', data.toString());
    }
  });

  monitor.stderr.on('data', (data) => {
    console.error('Monitor error:', data.toString());
  });

  monitor.on('close', (code) => {
    console.log(`Coin monitor exited with code ${code}`);
    gpioState.isMonitoring = false;
    // Restart monitoring after delay
    setTimeout(startCoinMonitoring, 5000);
  });
}

/**
 * Handle coin detection event
 */
function handleCoinDetection(event = {}) {
  const now = Date.now();
  
  let pulses = event.count || 1;
  let finalValue = pulses;
  let detectionType = 'raw';
  let adjustmentApplied = false;

  // 1. Check User-Defined Rules FIRST (Override Everything)
  if (pulseAdjustments.length > 0) {
    const rule = pulseAdjustments.find(r => r.pulse_count === pulses);
    if (rule) {
      finalValue = parseFloat(rule.actual_value);
      detectionType = 'calibrated';
      adjustmentApplied = true;
      console.log(`🔧 Rule Applied: ${pulses} pulses -> ₱${finalValue} (${rule.note})`);
    }
  }

  // 2. Strict Coin Matching (Fallback if no user rule)
  if (!adjustmentApplied) {
    if (STANDARD_COINS.includes(pulses)) {
      finalValue = pulses;
      detectionType = 'exact';
    } else {
       // Only default/raw if no rule exists
       // For strict safety, you might want to IGNORE unknown pulses?
       // user requested: "what if credit is 2,3,4...?" -> user should define rule.
       // But we keep raw as last resort.
       finalValue = pulses;
       detectionType = 'raw';
    }
  }
  
  gpioState.lastCoinTime = now;
  gpioState.coinCount++; 
  
  const coinEvent = {
    type: 'coin_detected',
    timestamp: now,
    count: gpioState.coinCount,
    value: finalValue,   
    pulses: pulses,      
    method: detectionType,
    pin: CONFIG.COIN_PIN,
    library: gpioState.library
  };
  
  console.log(`🪙 Coin processed: ₱${finalValue} (Raw: ${pulses}, Method: ${detectionType})`);
  
  // Broadcast to all connected WebSocket clients
  io.emit('coin_detected', coinEvent);
  
  // Log for debugging
  logEvent('coin', coinEvent);
}

/**
 * Pulse LED indicator
 */
function pulseLED() {
  if (gpioState.library === 'Mock') {
    console.log('💡 LED pulse (mock)');
    return;
  }
  
  const pulseScript = `
import OPi.GPIO as GPIO
import time

try:
    GPIO.output(${CONFIG.LED_PIN}, True)
    time.sleep(0.2)
    GPIO.output(${CONFIG.LED_PIN}, False)
    print("LED pulsed")
except Exception as e:
    print(f"LED error: {e}")
`;
  
  fs.writeFileSync('/tmp/led_pulse.py', pulseScript);
  spawn('python3', ['/tmp/led_pulse.py']);
}

/**
 * Log events for debugging
 */
function logEvent(category, data) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    category,
    data
  };
  
  // Could save to file or database here
  console.log('📝 Event logged:', logEntry);
}

// REST API Routes
app.get('/status', (req, res) => {
  res.json({
    success: true,
    gpio: gpioState,
    config: {
      coinPin: CONFIG.COIN_PIN,
      ledPin: CONFIG.LED_PIN,
      port: CONFIG.PORT
    },
    connections: connectedClients.size
  });
});

app.post('/test-coin', (req, res) => {
  console.log('🧪 Manual coin test triggered');
  handleCoinDetection();
  pulseLED();
  
  res.json({
    success: true,
    message: 'Test coin detection triggered',
    count: gpioState.coinCount
  });
});

app.post('/pulse-led', (req, res) => {
  pulseLED();
  res.json({
    success: true,
    message: 'LED pulse triggered'
  });
});

app.get('/reset-counter', (req, res) => {
  gpioState.coinCount = 0;
  res.json({
    success: true,
    message: 'Coin counter reset',
    count: gpioState.coinCount
  });
});

// WebSocket handling
io.on('connection', (socket) => {
  connectedClients.add(socket.id);
  console.log(`🔌 Client connected: ${socket.id} (${connectedClients.size} total)`);
  
  // Send current status to new client
  socket.emit('gpio_status', gpioState);
  
  socket.on('disconnect', () => {
    connectedClients.delete(socket.id);
    console.log(`🔌 Client disconnected: ${socket.id} (${connectedClients.size} total)`);
  });
  
  socket.on('test_coin', () => {
    handleCoinDetection();
    pulseLED();
  });
});

// Cleanup on exit
process.on('SIGINT', () => {
  console.log('🔄 Shutting down GPIO service...');
  
  if (gpioState.coinPin) {
    gpioState.coinPin.kill();
  }
  
  // Cleanup GPIO
  if (gpioState.library === 'OPi') {
    const cleanup = spawn('python3', ['-c', 'import OPi.GPIO as GPIO; GPIO.cleanup()']);
    cleanup.on('close', () => {
      console.log('✅ GPIO cleanup completed');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});

// Start the service
async function startService() {
  console.log('🚀 Starting PISOWifi GPIO Bridge Service...');
  console.log(`🔧 Configuration:`, CONFIG);
  
  await initializeGPIO();
  
  server.listen(CONFIG.PORT, () => {
    console.log(`⚡ GPIO Bridge Service running on port ${CONFIG.PORT}`);
    console.log(`🌐 WebSocket endpoint: ws://localhost:${CONFIG.PORT}`);
    console.log(`🔗 REST API: http://localhost:${CONFIG.PORT}/status`);
    console.log('📡 Ready for coin detection!');
  });
}

// Start the service
startService().catch(error => {
  console.error('❌ Failed to start GPIO service:', error);
  process.exit(1);
});