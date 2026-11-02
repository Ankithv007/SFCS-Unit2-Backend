-- Migration: 010_add_remark_columns_to_rrh_inward_scans.sql
-- Purpose: Add remark, repair_time, repair_remark columns to rrh_inward_scans table.

ALTER TABLE rrh_inward_scans ADD COLUMN IF NOT EXISTS remark TEXT;
ALTER TABLE rrh_inward_scans ADD COLUMN IF NOT EXISTS repair_time TIMESTAMP;
ALTER TABLE rrh_inward_scans ADD COLUMN IF NOT EXISTS repair_remark TEXT;
