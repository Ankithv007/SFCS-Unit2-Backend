-- Migration: 060_remove_invalid_duplicate_smt_inspections.sql
-- Description: Purge legacy INVALID inspection records from smt_inspections and enforce valid statuses

BEGIN;

-- 1. Remove all legacy INVALID records from smt_inspections
DELETE FROM smt_inspections WHERE status = 'INVALID';

-- 2. Drop existing check constraint on smt_inspections status if present
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.constraint_column_usage 
        WHERE table_name = 'smt_inspections' AND constraint_name = 'smt_inspections_status_check'
    ) THEN
        ALTER TABLE smt_inspections DROP CONSTRAINT smt_inspections_status_check;
    END IF;
END $$;

-- 3. Add constraint ensuring only PASS, FAIL, PENDING statuses are recorded in smt_inspections
ALTER TABLE smt_inspections 
ADD CONSTRAINT smt_inspections_status_check 
CHECK (status IN ('PASS', 'FAIL', 'PENDING'));

-- 4. Reset duplicate scan counters across SMT session tables
UPDATE smt_printing_sessions SET duplicate_scan_count = 0 WHERE duplicate_scan_count IS NOT NULL AND duplicate_scan_count > 0;
UPDATE smt_spi_sessions SET duplicate_scan_count = 0 WHERE duplicate_scan_count IS NOT NULL AND duplicate_scan_count > 0;
UPDATE smt_pre_aoi_sessions SET duplicate_scan_count = 0 WHERE duplicate_scan_count IS NOT NULL AND duplicate_scan_count > 0;
UPDATE smt_post_aoi_sessions SET duplicate_scan_count = 0 WHERE duplicate_scan_count IS NOT NULL AND duplicate_scan_count > 0;
UPDATE smt_rework_sessions SET duplicate_scan_count = 0 WHERE duplicate_scan_count IS NOT NULL AND duplicate_scan_count > 0;
UPDATE smt_fg_sessions SET duplicate_scan_count = 0 WHERE duplicate_scan_count IS NOT NULL AND duplicate_scan_count > 0;

COMMIT;
