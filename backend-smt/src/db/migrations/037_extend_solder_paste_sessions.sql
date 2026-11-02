-- Migration 037: Extend Solder Paste Sessions with Snapshot, Audit and Soft Delete
-- Add snapshot columns for traceability and auditing

ALTER TABLE smt_solder_paste_sessions ADD COLUMN IF NOT EXISTS model_id UUID;
ALTER TABLE smt_solder_paste_sessions ADD COLUMN IF NOT EXISTS model_name VARCHAR(255);
ALTER TABLE smt_solder_paste_sessions ADD COLUMN IF NOT EXISTS make VARCHAR(255);
ALTER TABLE smt_solder_paste_sessions ADD COLUMN IF NOT EXISTS can_barcode VARCHAR(255);
ALTER TABLE smt_solder_paste_sessions ADD COLUMN IF NOT EXISTS manufacturing_date DATE;
ALTER TABLE smt_solder_paste_sessions ADD COLUMN IF NOT EXISTS expiry_date DATE;
ALTER TABLE smt_solder_paste_sessions ADD COLUMN IF NOT EXISTS total_weight_g NUMERIC(10,2);
ALTER TABLE smt_solder_paste_sessions ADD COLUMN IF NOT EXISTS min_thawing_hours NUMERIC(5,2);
ALTER TABLE smt_solder_paste_sessions ADD COLUMN IF NOT EXISTS max_working_hours NUMERIC(5,2);

-- Add lifecycle and audit columns
ALTER TABLE smt_solder_paste_sessions ADD COLUMN IF NOT EXISTS working_start_time TIMESTAMP;
ALTER TABLE smt_solder_paste_sessions ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'THAWING';
ALTER TABLE smt_solder_paste_sessions ADD COLUMN IF NOT EXISTS created_by VARCHAR(255);
ALTER TABLE smt_solder_paste_sessions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE smt_solder_paste_sessions ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255);
ALTER TABLE smt_solder_paste_sessions ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;
ALTER TABLE smt_solder_paste_sessions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE smt_solder_paste_sessions ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(255);

-- Create optimization indexes
CREATE INDEX IF NOT EXISTS idx_smt_sp_sessions_can_id ON smt_solder_paste_sessions(can_id);
CREATE INDEX IF NOT EXISTS idx_smt_sp_sessions_model_id ON smt_solder_paste_sessions(model_id);
CREATE INDEX IF NOT EXISTS idx_smt_sp_sessions_removed_at ON smt_solder_paste_sessions(removed_at);
CREATE INDEX IF NOT EXISTS idx_smt_sp_sessions_status ON smt_solder_paste_sessions(status);
CREATE INDEX IF NOT EXISTS idx_smt_sp_sessions_is_deleted ON smt_solder_paste_sessions(is_deleted);
