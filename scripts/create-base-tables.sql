-- Base PISOWifi Database Tables
-- Run this to ensure all required tables exist

-- Users table for admin authentication
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'admin',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Clients table for device tracking
CREATE TABLE IF NOT EXISTS clients (
    id SERIAL PRIMARY KEY,
    mac_address VARCHAR(17) UNIQUE NOT NULL,
    ip_address VARCHAR(45),
    device_name VARCHAR(100),
    device_type VARCHAR(20),
    os VARCHAR(50),
    browser VARCHAR(50),
    user_agent TEXT,
    platform VARCHAR(50),
    language VARCHAR(10),
    screen_resolution VARCHAR(20),
    timezone VARCHAR(50),
    status VARCHAR(20) DEFAULT 'DISCONNECTED',
    time_remaining INTEGER DEFAULT 0,
    total_amount_paid DECIMAL(10,2) DEFAULT 0.00,
    session_start TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Sessions table for tracking connections
CREATE TABLE IF NOT EXISTS sessions (
    id SERIAL PRIMARY KEY,
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    mac_address VARCHAR(17) NOT NULL,
    ip_address VARCHAR(45),
    duration INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'ACTIVE',
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP
);

-- Transactions table for payment tracking
CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY,
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
    amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    coins_used INTEGER DEFAULT 0,
    payment_method VARCHAR(20) DEFAULT 'COIN',
    status VARCHAR(20) DEFAULT 'COMPLETED',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Rates table for pricing
CREATE TABLE IF NOT EXISTS rates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    duration INTEGER NOT NULL,
    coins_required INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Portal settings
CREATE TABLE IF NOT EXISTS portal_settings (
    id INTEGER PRIMARY KEY DEFAULT 1,
    coin_timeout INTEGER DEFAULT 60,
    portal_title VARCHAR(200) DEFAULT 'PISOWifi Portal',
    portal_subtitle VARCHAR(200) DEFAULT 'Insert coins for internet access',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- System logs
CREATE TABLE IF NOT EXISTS system_logs (
    id SERIAL PRIMARY KEY,
    level VARCHAR(10) NOT NULL,
    message TEXT NOT NULL,
    category VARCHAR(50),
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default admin user (password: admin123)
INSERT INTO users (username, email, password, role) VALUES 
('admin', 'admin@pisowifi.local', '$2a$10$vXqPPz9bGkdLQkFZ.fJdOeKhpJNc6ZcQyOlBdVnBnNEqwA1J6MfCS', 'admin')
ON CONFLICT (username) DO NOTHING;

-- Insert default rates
INSERT INTO rates (name, price, duration, coins_required, is_active) VALUES
('30 Minutes', 5.00, 1800, 1, true),
('1 Hour', 10.00, 3600, 2, true),
('2 Hours', 20.00, 7200, 4, true)
ON CONFLICT DO NOTHING;

-- Insert default portal settings
INSERT INTO portal_settings (id, coin_timeout, portal_title, portal_subtitle) VALUES 
(1, 300, 'PISOWifi Portal', 'Insert coins for internet access')
ON CONFLICT (id) DO NOTHING;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_clients_mac ON clients(mac_address);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
CREATE INDEX IF NOT EXISTS idx_sessions_client ON sessions(client_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_client ON transactions(client_id);
CREATE INDEX IF NOT EXISTS idx_system_logs_level ON system_logs(level);
CREATE INDEX IF NOT EXISTS idx_system_logs_category ON system_logs(category);
CREATE INDEX IF NOT EXISTS idx_system_logs_created ON system_logs(created_at);

-- Add missing columns that might not exist
ALTER TABLE clients ADD COLUMN IF NOT EXISTS upload_limit INTEGER DEFAULT 0;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS download_limit INTEGER DEFAULT 0;