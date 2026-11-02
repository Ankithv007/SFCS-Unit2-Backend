-- 014_add_missing_sl_no_and_updated_at.sql
-- Add missing sl_no and updated_at columns to rrh_ipqc_inspections, rrh_inward_scans, and rrh_ivi_inspections

ALTER TABLE rrh_ipqc_inspections ADD COLUMN IF NOT EXISTS sl_no VARCHAR(100);
ALTER TABLE rrh_ipqc_inspections ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE rrh_inward_scans ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE rrh_ivi_inspections ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_inspections_sl_no ON rrh_ipqc_inspections(sl_no);
