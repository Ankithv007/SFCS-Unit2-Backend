-- 002_add_missing_columns.sql
-- Add missing repair_remark and repair_time to all scan tables based on localhost DB schema

ALTER TABLE pth_scans ADD COLUMN IF NOT EXISTS repair_remark TEXT;
ALTER TABLE pth_scans ADD COLUMN IF NOT EXISTS repair_time TIMESTAMP;
ALTER TABLE pth_scans ADD COLUMN IF NOT EXISTS reason VARCHAR(255);

ALTER TABLE vi_scans ADD COLUMN IF NOT EXISTS repair_remark TEXT;
ALTER TABLE vi_scans ADD COLUMN IF NOT EXISTS repair_time TIMESTAMP;
ALTER TABLE vi_scans ADD COLUMN IF NOT EXISTS reason VARCHAR(255);

ALTER TABLE qa_scans ADD COLUMN IF NOT EXISTS repair_remark TEXT;
ALTER TABLE qa_scans ADD COLUMN IF NOT EXISTS repair_time TIMESTAMP;

ALTER TABLE flashing_scans ADD COLUMN IF NOT EXISTS repair_remark TEXT;
ALTER TABLE flashing_scans ADD COLUMN IF NOT EXISTS repair_time TIMESTAMP;

ALTER TABLE pcba_fct_scans ADD COLUMN IF NOT EXISTS repair_remark TEXT;
ALTER TABLE pcba_fct_scans ADD COLUMN IF NOT EXISTS repair_time TIMESTAMP;

ALTER TABLE assembly_scans ADD COLUMN IF NOT EXISTS repair_remark TEXT;
ALTER TABLE assembly_scans ADD COLUMN IF NOT EXISTS repair_time TIMESTAMP;

ALTER TABLE unit_testing_scans ADD COLUMN IF NOT EXISTS repair_remark TEXT;
ALTER TABLE unit_testing_scans ADD COLUMN IF NOT EXISTS repair_time TIMESTAMP;

ALTER TABLE qi_scans ADD COLUMN IF NOT EXISTS repair_remark TEXT;
ALTER TABLE qi_scans ADD COLUMN IF NOT EXISTS repair_time TIMESTAMP;

ALTER TABLE packing_scans ADD COLUMN IF NOT EXISTS repair_remark TEXT;
ALTER TABLE packing_scans ADD COLUMN IF NOT EXISTS repair_time TIMESTAMP;

ALTER TABLE rework_scans ADD COLUMN IF NOT EXISTS repair_remark TEXT;
ALTER TABLE rework_scans ADD COLUMN IF NOT EXISTS repair_time TIMESTAMP;

ALTER TABLE debug_scans ADD COLUMN IF NOT EXISTS repair_remark TEXT;
ALTER TABLE debug_scans ADD COLUMN IF NOT EXISTS repair_time TIMESTAMP;
