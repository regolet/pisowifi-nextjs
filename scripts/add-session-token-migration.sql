-- Migration to add session_token for random MAC address handling
-- This allows the system to identify clients even when their MAC address changes

-- Add session_token column to clients table
ALTER TABLE clients ADD COLUMN session_token VARCHAR(64);

-- Create index for fast session token lookups
CREATE INDEX IF NOT EXISTS idx_clients_session_token ON clients(session_token);

-- Create index for IP-based lookups
CREATE INDEX IF NOT EXISTS idx_clients_ip_address ON clients(ip_address);

-- Add session_token column to coin_queues table for backup identification
ALTER TABLE coin_queues ADD COLUMN session_token VARCHAR(64);

-- Create index for session token in coin_queues
CREATE INDEX IF NOT EXISTS idx_coin_queues_session_token ON coin_queues(session_token);

-- Add session_token to sessions table
ALTER TABLE sessions ADD COLUMN session_token VARCHAR(64);

-- Create index for session token in sessions
CREATE INDEX IF NOT EXISTS idx_sessions_session_token ON sessions(session_token);
