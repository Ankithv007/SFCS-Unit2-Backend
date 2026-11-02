-- Migration: 017_fix_programming_debug_status_default.sql
-- Description: Drop default 'PENDING' from debug_status and set NULL for COMPLETED inspections

ALTER TABLE rrh_programming_inspections ALTER COLUMN debug_status DROP DEFAULT;

UPDATE rrh_programming_inspections 
SET debug_status = NULL 
WHERE status = 'COMPLETED' AND is_reinspected = false AND defect_fixed IS NULL;
