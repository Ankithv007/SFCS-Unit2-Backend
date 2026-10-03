-- Migration: 002_enhance_rrh_inward_scans_and_consumption.sql
-- Description: Add audit columns to rrh_inward_scans and create master consumption tracking table

-- 1. Enhance rrh_inward_scans for full auditability and traceability
ALTER TABLE rrh_inward_scans ADD COLUMN IF NOT EXISTS original_serial_number VARCHAR(255);
ALTER TABLE rrh_inward_scans ADD COLUMN IF NOT EXISTS corrected_serial_number VARCHAR(255);
ALTER TABLE rrh_inward_scans ADD COLUMN IF NOT EXISTS physical_tpn VARCHAR(255);
ALTER TABLE rrh_inward_scans ADD COLUMN IF NOT EXISTS band_serial_no VARCHAR(255);
ALTER TABLE rrh_inward_scans ADD COLUMN IF NOT EXISTS matched_inventory_id INTEGER REFERENCES rrh_inventory(id) ON DELETE SET NULL;
ALTER TABLE rrh_inward_scans ADD COLUMN IF NOT EXISTS remark TEXT;
ALTER TABLE rrh_inward_scans ADD COLUMN IF NOT EXISTS repair_remark TEXT;
ALTER TABLE rrh_inward_scans ADD COLUMN IF NOT EXISTS repair_time TIMESTAMP;
ALTER TABLE rrh_inward_scans ADD COLUMN IF NOT EXISTS repaired_by VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_inward_scans_session_id ON rrh_inward_scans(rrh_inward_session_id);
CREATE INDEX IF NOT EXISTS idx_inward_scans_serial ON rrh_inward_scans(serial_number);

-- 2. Non-destructive master data consumption tracking table
CREATE TABLE IF NOT EXISTS rrh_inward_session_master_consumption (
    id SERIAL PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES rrh_inward_sessions(id) ON DELETE CASCADE,
    inventory_id INTEGER NOT NULL REFERENCES rrh_inventory(id) ON DELETE CASCADE,
    scan_id INTEGER REFERENCES rrh_inward_scans(id) ON DELETE SET NULL,
    consumed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_session_inventory UNIQUE (session_id, inventory_id)
);

CREATE INDEX IF NOT EXISTS idx_inward_consumption_session_id ON rrh_inward_session_master_consumption(session_id);
CREATE INDEX IF NOT EXISTS idx_inward_consumption_inventory_id ON rrh_inward_session_master_consumption(inventory_id);
