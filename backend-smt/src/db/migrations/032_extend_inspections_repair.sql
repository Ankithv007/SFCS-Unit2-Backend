-- Migration: 032_extend_inspections_repair.sql
-- Description: Extend smt_inspections table for Repair Workflow in Printing.

ALTER TABLE smt_inspections ADD COLUMN IF NOT EXISTS repair_time TIMESTAMP;
ALTER TABLE smt_inspections ADD COLUMN IF NOT EXISTS repair_remark TEXT;
