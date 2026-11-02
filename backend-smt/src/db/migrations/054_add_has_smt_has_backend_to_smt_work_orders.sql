-- Migration 054: Add has_smt and has_backend columns to smt_work_orders

ALTER TABLE smt_work_orders ADD COLUMN IF NOT EXISTS has_smt BOOLEAN DEFAULT TRUE;
ALTER TABLE smt_work_orders ADD COLUMN IF NOT EXISTS has_backend BOOLEAN DEFAULT TRUE;
