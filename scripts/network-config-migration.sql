-- Network Configuration Table
CREATE TABLE IF NOT EXISTS network_config (
    id INTEGER PRIMARY KEY DEFAULT 1,
    dhcp_enabled BOOLEAN DEFAULT true,
    dhcp_range_start VARCHAR(15) DEFAULT '192.168.100.10',
    dhcp_range_end VARCHAR(15) DEFAULT '192.168.100.200',
    subnet_mask VARCHAR(15) DEFAULT '255.255.255.0',
    gateway VARCHAR(15) DEFAULT '192.168.100.1',
    dns_primary VARCHAR(15) DEFAULT '8.8.8.8',
    dns_secondary VARCHAR(15) DEFAULT '8.8.4.4',
    lease_time INTEGER DEFAULT 3600,
    wifi_interface VARCHAR(20) DEFAULT 'wlan0',
    ethernet_interface VARCHAR(20) DEFAULT 'eth0',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add bandwidth limiting columns to clients table
ALTER TABLE clients 
ADD COLUMN IF NOT EXISTS upload_limit INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS download_limit INTEGER DEFAULT 0;

-- Network monitoring table for storing traffic statistics
CREATE TABLE IF NOT EXISTS network_traffic_logs (
    id SERIAL PRIMARY KEY,
    interface_name VARCHAR(20) NOT NULL,
    rx_bytes BIGINT DEFAULT 0,
    tx_bytes BIGINT DEFAULT 0,
    rx_packets BIGINT DEFAULT 0,
    tx_packets BIGINT DEFAULT 0,
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Client bandwidth usage tracking
CREATE TABLE IF NOT EXISTS client_bandwidth_logs (
    id SERIAL PRIMARY KEY,
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    upload_bytes BIGINT DEFAULT 0,
    download_bytes BIGINT DEFAULT 0,
    upload_rate VARCHAR(20),
    download_rate VARCHAR(20),
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default network configuration
INSERT INTO network_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_network_traffic_interface ON network_traffic_logs(interface_name);
CREATE INDEX IF NOT EXISTS idx_network_traffic_time ON network_traffic_logs(recorded_at);
CREATE INDEX IF NOT EXISTS idx_bandwidth_client ON client_bandwidth_logs(client_id);
CREATE INDEX IF NOT EXISTS idx_bandwidth_time ON client_bandwidth_logs(recorded_at);