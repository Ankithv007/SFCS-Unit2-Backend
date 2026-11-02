-- Migration: Add detailed employee info columns and create bom_split_items table

-- 1. Alter bom_history to add uploaded_by_code, uploaded_date, uploaded_time columns if not present
ALTER TABLE bom_history ADD COLUMN IF NOT EXISTS uploaded_by_code VARCHAR(100);
ALTER TABLE bom_history ADD COLUMN IF NOT EXISTS uploaded_date DATE DEFAULT CURRENT_DATE;
ALTER TABLE bom_history ADD COLUMN IF NOT EXISTS uploaded_time TIME DEFAULT CURRENT_TIME;

-- Update existing records if any
UPDATE bom_history SET uploaded_date = upload_date WHERE uploaded_date IS NULL;
UPDATE bom_history SET uploaded_time = upload_time WHERE uploaded_time IS NULL;

-- 2. Alter bom_split_audit_logs to add employee_code, action_date, action_time
ALTER TABLE bom_split_audit_logs ADD COLUMN IF NOT EXISTS employee_code VARCHAR(100);
ALTER TABLE bom_split_audit_logs ADD COLUMN IF NOT EXISTS action_date DATE DEFAULT CURRENT_DATE;
ALTER TABLE bom_split_audit_logs ADD COLUMN IF NOT EXISTS action_time TIME DEFAULT CURRENT_TIME;

-- Update existing logs
UPDATE bom_split_audit_logs SET action_date = log_date WHERE action_date IS NULL;
UPDATE bom_split_audit_logs SET action_time = log_time WHERE action_time IS NULL;

-- 3. Create bom_split_items table
CREATE TABLE IF NOT EXISTS bom_split_items (
    id SERIAL PRIMARY KEY,
    bom_history_id INTEGER REFERENCES bom_history(id) ON DELETE CASCADE,
    cpn VARCHAR(255) NOT NULL,
    description TEXT,
    mfr VARCHAR(255),
    mfr_part_no VARCHAR(255),
    qty VARCHAR(255),
    ref TEXT,
    display_order INTEGER NOT NULL,
    created_by VARCHAR(255) NOT NULL,
    created_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by_id VARCHAR(100),
    updated_by_name VARCHAR(255),
    updated_by_code VARCHAR(100),
    updated_date DATE DEFAULT CURRENT_DATE,
    updated_time TIME DEFAULT CURRENT_TIME
);

-- Indexing for lookup speed
CREATE INDEX IF NOT EXISTS idx_bom_split_items_history_id ON bom_split_items(bom_history_id);
CREATE INDEX IF NOT EXISTS idx_bom_split_items_display_order ON bom_split_items(display_order);
