-- Migration 003_solder_paste_management.sql
-- Centralized SMT Schema Extension for Solder Paste Management

-- Add columns to smt_work_orders for current state tracking
ALTER TABLE smt_work_orders ADD COLUMN IF NOT EXISTS solder_paste_barcode VARCHAR(255);
ALTER TABLE smt_work_orders DROP CONSTRAINT IF EXISTS smt_work_orders_solder_paste_barcode_key;
ALTER TABLE smt_work_orders ADD COLUMN IF NOT EXISTS solder_paste_stage1_operator VARCHAR(255);
ALTER TABLE smt_work_orders ADD COLUMN IF NOT EXISTS solder_paste_stage1_employee_code VARCHAR(255);
ALTER TABLE smt_work_orders ADD COLUMN IF NOT EXISTS solder_paste_stage1_at TIMESTAMP;
ALTER TABLE smt_work_orders ADD COLUMN IF NOT EXISTS solder_paste_stage1_status VARCHAR(50);
ALTER TABLE smt_work_orders ADD COLUMN IF NOT EXISTS solder_paste_stage2_start_at TIMESTAMP;
ALTER TABLE smt_work_orders ADD COLUMN IF NOT EXISTS solder_paste_stage2_status VARCHAR(50);
ALTER TABLE smt_work_orders ADD COLUMN IF NOT EXISTS solder_paste_stage3_start_at TIMESTAMP;
ALTER TABLE smt_work_orders ADD COLUMN IF NOT EXISTS solder_paste_stage3_completed_at TIMESTAMP;
ALTER TABLE smt_work_orders ADD COLUMN IF NOT EXISTS solder_paste_stage3_operator VARCHAR(255);
ALTER TABLE smt_work_orders ADD COLUMN IF NOT EXISTS solder_paste_stage3_employee_code VARCHAR(255);
ALTER TABLE smt_work_orders ADD COLUMN IF NOT EXISTS solder_paste_stage3_status VARCHAR(50);
ALTER TABLE smt_work_orders ADD COLUMN IF NOT EXISTS solder_paste_status VARCHAR(50) DEFAULT 'Pending';

-- Add work_order_id to smt_inspections for tracking historical logs at the Work Order level
ALTER TABLE smt_inspections ADD COLUMN IF NOT EXISTS work_order_id VARCHAR(255) REFERENCES smt_work_orders(id) ON DELETE CASCADE;

-- Create index on work_order_id inside smt_inspections for optimized queries
CREATE INDEX IF NOT EXISTS idx_smt_inspections_work_order_id ON smt_inspections(work_order_id);
