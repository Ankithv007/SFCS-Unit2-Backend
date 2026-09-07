-- Migration 052: Add customer_name, model_name, and selected_stages columns to smt_work_orders

ALTER TABLE smt_work_orders ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255);
ALTER TABLE smt_work_orders ADD COLUMN IF NOT EXISTS model_name VARCHAR(255);
ALTER TABLE smt_work_orders ADD COLUMN IF NOT EXISTS selected_stages JSONB DEFAULT '["PTH", "VI", "QA", "Flashing", "PCBA-FCT", "Assembly", "Unit Testing", "QI"]'::jsonb;
