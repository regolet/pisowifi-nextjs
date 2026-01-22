-- TTL (Time To Live) Anti-Tethering Detection Tables
-- Detects clients sharing/tethering internet through multiple devices

-- TTL Detection Settings
CREATE TABLE IF NOT EXISTS ttl_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  enabled BOOLEAN DEFAULT false,
  sensitivity TEXT DEFAULT 'medium', -- low, medium, high
  auto_block BOOLEAN DEFAULT false,
  alert_threshold INTEGER DEFAULT 3,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(id)
);

-- TTL Baseline for each client (for comparison)
CREATE TABLE IF NOT EXISTS ttl_baselines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_mac TEXT UNIQUE NOT NULL,
  baseline_ttl INTEGER NOT NULL,
  established_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_verified TIMESTAMP,
  confidence REAL DEFAULT 0.8, -- How confident we are in this baseline
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- TTL Anomalies detected
CREATE TABLE IF NOT EXISTS ttl_anomalies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_mac TEXT NOT NULL,
  anomaly_type TEXT NOT NULL, -- ttl_variance, ttl_decrement, multiple_devices
  details JSON,
  severity TEXT DEFAULT 'medium', -- low, medium, high
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_mac) REFERENCES clients(mac_address)
);

-- TTL Violations (significant anomalies)
CREATE TABLE IF NOT EXISTS ttl_violations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_mac TEXT NOT NULL,
  violation_count INTEGER DEFAULT 1,
  severity TEXT DEFAULT 'high',
  status TEXT DEFAULT 'pending', -- pending, investigating, resolved, blocked
  first_detected TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_detected TIMESTAMP,
  resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMP,
  admin_notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_mac) REFERENCES clients(mac_address)
);

-- TTL Detection logs (for debugging)
CREATE TABLE IF NOT EXISTS ttl_detection_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_mac TEXT NOT NULL,
  packet_ttl INTEGER NOT NULL,
  baseline_ttl INTEGER,
  ttl_diff INTEGER,
  is_anomaly BOOLEAN DEFAULT false,
  anomaly_type TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_mac) REFERENCES clients(mac_address)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_ttl_anomalies_mac ON ttl_anomalies(client_mac);
CREATE INDEX IF NOT EXISTS idx_ttl_anomalies_type ON ttl_anomalies(anomaly_type);
CREATE INDEX IF NOT EXISTS idx_ttl_violations_mac ON ttl_violations(client_mac);
CREATE INDEX IF NOT EXISTS idx_ttl_violations_status ON ttl_violations(status);
CREATE INDEX IF NOT EXISTS idx_ttl_detection_logs_mac ON ttl_detection_logs(client_mac);
CREATE INDEX IF NOT EXISTS idx_ttl_baselines_mac ON ttl_baselines(client_mac);
