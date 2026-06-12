-- Migration to add po_id and remark fields to smt_work_orders table
ALTER TABLE smt_work_orders ADD COLUMN IF NOT EXISTS po_id VARCHAR(255);
ALTER TABLE smt_work_orders ADD COLUMN IF NOT EXISTS remark TEXT;
