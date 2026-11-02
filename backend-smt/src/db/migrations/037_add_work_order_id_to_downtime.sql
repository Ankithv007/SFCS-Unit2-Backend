-- Migration: 037_add_work_order_id_to_downtime.sql
-- Description: Add work_order_id column to smt_downtime_records table if not exists

ALTER TABLE smt_downtime_records ADD COLUMN IF NOT EXISTS work_order_id VARCHAR(255);
