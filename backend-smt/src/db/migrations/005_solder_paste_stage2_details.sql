-- Migration 005_solder_paste_stage2_details.sql
-- Extend smt_work_orders for Stage 2 Thawing metadata

ALTER TABLE smt_work_orders ADD COLUMN IF NOT EXISTS solder_paste_stage2_operator VARCHAR(255);
ALTER TABLE smt_work_orders ADD COLUMN IF NOT EXISTS solder_paste_stage2_employee_code VARCHAR(255);
ALTER TABLE smt_work_orders ADD COLUMN IF NOT EXISTS solder_paste_stage2_completed_at TIMESTAMP;
