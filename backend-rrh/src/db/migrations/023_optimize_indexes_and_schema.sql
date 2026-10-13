-- ============================================================================
-- Migration 023: Optimize Indexes, Deduplicate Unique Guards, and Latency Tuning
-- ============================================================================

-- 1. Remove redundant prefix index on rrh_inventory
-- (idx_rrh_inventory_import_band_ci and idx_rrh_inventory_import_sl_ci already have import_id as leading column)
DROP INDEX IF EXISTS idx_rrh_inventory_import_id;

-- 2. Exact Foreign Key Joins & Cascading Indexes on work_order_id
-- (Accelerates JOIN ... ON a.work_order_id = b.work_order_id and FK validation checks)
CREATE INDEX IF NOT EXISTS idx_inward_sessions_exact_wo ON rrh_inward_sessions(work_order_id);
CREATE INDEX IF NOT EXISTS idx_ivi_sessions_exact_wo ON rrh_ivi_sessions(work_order_id);
CREATE INDEX IF NOT EXISTS idx_ipqc_sessions_exact_wo ON rrh_ipqc_sessions(work_order_id);

CREATE INDEX IF NOT EXISTS idx_inward_scans_exact_wo ON rrh_inward_scans(work_order_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_ivi_inspections_exact_wo ON rrh_ivi_inspections(work_order_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_ipqc_inspections_exact_wo ON rrh_ipqc_inspections(work_order_id) WHERE is_deleted = false;

-- 3. Harmonize sl_no column lengths to VARCHAR(255) across all scan/inspection tables
ALTER TABLE rrh_inward_scans ALTER COLUMN sl_no TYPE VARCHAR(255);
ALTER TABLE rrh_ivi_inspections ALTER COLUMN sl_no TYPE VARCHAR(255);
ALTER TABLE rrh_ipqc_inspections ALTER COLUMN sl_no TYPE VARCHAR(255);

-- 4. Guaranteed Duplicate-Scan Prevention with Safe Historical Deduplication
-- Safely resolve any historical duplicates before enforcing unique active serial guards
WITH ivi_duplicates AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY session_id, UPPER(TRIM(serial_number))
               ORDER BY scanned_at DESC, id DESC
           ) as rn
    FROM rrh_ivi_inspections
    WHERE is_deleted = false
)
UPDATE rrh_ivi_inspections
SET is_deleted = true
WHERE id IN (SELECT id FROM ivi_duplicates WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS uq_rrh_ivi_active_serial
    ON rrh_ivi_inspections(session_id, UPPER(TRIM(serial_number)))
    WHERE is_deleted = false;

WITH ipqc_duplicates AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY session_id, UPPER(TRIM(serial_number))
               ORDER BY scanned_at DESC, id DESC
           ) as rn
    FROM rrh_ipqc_inspections
    WHERE is_deleted = false
)
UPDATE rrh_ipqc_inspections
SET is_deleted = true
WHERE id IN (SELECT id FROM ipqc_duplicates WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS uq_rrh_ipqc_active_serial
    ON rrh_ipqc_inspections(session_id, UPPER(TRIM(serial_number)))
    WHERE is_deleted = false;
