-- PISOWifi Coin Slots & Queues System Migration
-- Adds coin slot claiming and coin queue stacking functionality

-- Coin Slots Table
CREATE TABLE IF NOT EXISTS coin_slots (
    id SERIAL PRIMARY KEY,
    slot_number INTEGER UNIQUE NOT NULL,
    status VARCHAR(20) DEFAULT 'available' CHECK (status IN ('available', 'claimed', 'active')),
    claimed_by_client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    claimed_by_ip VARCHAR(45),
    claimed_by_mac VARCHAR(17),
    claimed_at TIMESTAMP,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Coin Queues Table  
CREATE TABLE IF NOT EXISTS coin_queues (
    id SERIAL PRIMARY KEY,
    slot_id INTEGER REFERENCES coin_slots(id) ON DELETE CASCADE,
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    client_ip VARCHAR(45),
    client_mac VARCHAR(17),
    coin_value DECIMAL(10,2) NOT NULL,
    coin_count INTEGER DEFAULT 1,
    total_value DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'redeemed', 'expired')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default coin slot for Orange Pi standalone (single physical coin slot)
INSERT INTO coin_slots (slot_number, status) VALUES 
(1, 'available')
ON CONFLICT (slot_number) DO NOTHING;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_coin_slots_status ON coin_slots(status);
CREATE INDEX IF NOT EXISTS idx_coin_slots_claimed_by ON coin_slots(claimed_by_client_id, claimed_by_ip);
CREATE INDEX IF NOT EXISTS idx_coin_queues_client ON coin_queues(client_id, client_ip, client_mac);
CREATE INDEX IF NOT EXISTS idx_coin_queues_slot_status ON coin_queues(slot_id, status);

-- Add trigger for auto-updating timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_coin_slots_updated_at 
    BEFORE UPDATE ON coin_slots 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_coin_queues_updated_at 
    BEFORE UPDATE ON coin_queues 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to auto-release expired coin slots
CREATE OR REPLACE FUNCTION release_expired_coin_slots()
RETURNS INTEGER AS $$
DECLARE
    released_count INTEGER;
BEGIN
    UPDATE coin_slots 
    SET status = 'available',
        claimed_by_client_id = NULL,
        claimed_by_ip = NULL,
        claimed_by_mac = NULL,
        claimed_at = NULL,
        expires_at = NULL
    WHERE status = 'claimed' 
    AND expires_at < CURRENT_TIMESTAMP;
    
    GET DIAGNOSTICS released_count = ROW_COUNT;
    RETURN released_count;
END;
$$ LANGUAGE plpgsql;

-- Function to get total queued coins for a client
CREATE OR REPLACE FUNCTION get_client_queued_total(client_ip_param VARCHAR(45), client_mac_param VARCHAR(17))
RETURNS TABLE(
    total_coins INTEGER,
    total_value DECIMAL(10,2),
    queue_count INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(SUM(cq.coin_count), 0)::INTEGER as total_coins,
        COALESCE(SUM(cq.total_value), 0.00)::DECIMAL(10,2) as total_value,
        COUNT(cq.id)::INTEGER as queue_count
    FROM coin_queues cq
    WHERE cq.status = 'queued'
    AND (cq.client_ip = client_ip_param OR cq.client_mac = client_mac_param);
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE coin_slots IS 'Physical coin slot management to prevent concurrent access';
COMMENT ON TABLE coin_queues IS 'Queue system for stacking multiple coin insertions per client';
COMMENT ON FUNCTION release_expired_coin_slots() IS 'Auto-release expired coin slot claims';
COMMENT ON FUNCTION get_client_queued_total(VARCHAR, VARCHAR) IS 'Get total queued coins and value for a client';