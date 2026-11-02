-- 002_add_barcode_source.sql
-- Adds missing barcode_source column to production

ALTER TABLE smt_work_orders ADD COLUMN IF NOT EXISTS barcode_source VARCHAR(100) DEFAULT 'Generate Barcode';
ALTER TABLE smt_work_orders ADD COLUMN IF NOT EXISTS is_registered BOOLEAN DEFAULT false;
