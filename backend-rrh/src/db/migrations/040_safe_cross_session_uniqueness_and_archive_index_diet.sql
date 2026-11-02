-- Migration 040: Safe Cross-Session Work Order Uniqueness & Archive Index Diet

-- 1. Deduplicate any existing duplicate active scans across different sessions for the same work order,
-- keeping the latest scan active and marking earlier ones as is_deleted = true.
WITH ranked_dups AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY work_order_id, UPPER(TRIM(serial_number)), COALESCE(post_burn_in_type, 'STANDARD')
               ORDER BY scanned_at DESC, id DESC
           ) as rn
    FROM rrh_post_burn_in_inspections
    WHERE is_deleted = false AND status IN ('PASS', 'COMPLETED')
)
UPDATE rrh_post_burn_in_inspections
SET is_deleted = true
WHERE id IN (SELECT id FROM ranked_dups WHERE rn > 1);

-- Deduplicate IVI if any
WITH ranked_dups AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY work_order_id, UPPER(TRIM(serial_number))
               ORDER BY scanned_at DESC, id DESC
           ) as rn
    FROM rrh_ivi_inspections
    WHERE is_deleted = false AND status IN ('PASS', 'COMPLETED')
)
UPDATE rrh_ivi_inspections
SET is_deleted = true
WHERE id IN (SELECT id FROM ranked_dups WHERE rn > 1);

-- Deduplicate IPQC if any
WITH ranked_dups AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY work_order_id, UPPER(TRIM(serial_number))
               ORDER BY scanned_at DESC, id DESC
           ) as rn
    FROM rrh_ipqc_inspections
    WHERE is_deleted = false AND status IN ('PASS', 'COMPLETED')
)
UPDATE rrh_ipqc_inspections
SET is_deleted = true
WHERE id IN (SELECT id FROM ranked_dups WHERE rn > 1);

-- Deduplicate Programming if any
WITH ranked_dups AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY work_order_id, UPPER(TRIM(serial_number))
               ORDER BY scanned_at DESC, id DESC
           ) as rn
    FROM rrh_programming_inspections
    WHERE is_deleted = false AND status IN ('PASS', 'COMPLETED')
)
UPDATE rrh_programming_inspections
SET is_deleted = true
WHERE id IN (SELECT id FROM ranked_dups WHERE rn > 1);

-- Deduplicate Pre-Burn-In if any
WITH ranked_dups AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY work_order_id, UPPER(TRIM(serial_number))
               ORDER BY scanned_at DESC, id DESC
           ) as rn
    FROM rrh_pre_burn_in_inspections
    WHERE is_deleted = false AND status IN ('PASS', 'COMPLETED')
)
UPDATE rrh_pre_burn_in_inspections
SET is_deleted = true
WHERE id IN (SELECT id FROM ranked_dups WHERE rn > 1);

-- Deduplicate Hipot if any
WITH ranked_dups AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY work_order_id, UPPER(TRIM(serial_number))
               ORDER BY scanned_at DESC, id DESC
           ) as rn
    FROM rrh_hipot_inspections
    WHERE is_deleted = false AND status IN ('PASS', 'COMPLETED')
)
UPDATE rrh_hipot_inspections
SET is_deleted = true
WHERE id IN (SELECT id FROM ranked_dups WHERE rn > 1);

-- 2. Enforce True Work Order Level Uniqueness for Passing Units (Cross-Session Protection)
CREATE UNIQUE INDEX IF NOT EXISTS uq_rrh_ivi_wo_pass_active
ON rrh_ivi_inspections (work_order_id, UPPER(TRIM(serial_number)))
WHERE is_deleted = false AND status IN ('PASS', 'COMPLETED');

CREATE UNIQUE INDEX IF NOT EXISTS uq_rrh_ipqc_wo_pass_active
ON rrh_ipqc_inspections (work_order_id, UPPER(TRIM(serial_number)))
WHERE is_deleted = false AND status IN ('PASS', 'COMPLETED');

CREATE UNIQUE INDEX IF NOT EXISTS uq_rrh_prog_wo_pass_active
ON rrh_programming_inspections (work_order_id, UPPER(TRIM(serial_number)))
WHERE is_deleted = false AND status IN ('PASS', 'COMPLETED');

CREATE UNIQUE INDEX IF NOT EXISTS uq_rrh_pbi_wo_pass_active
ON rrh_pre_burn_in_inspections (work_order_id, UPPER(TRIM(serial_number)))
WHERE is_deleted = false AND status IN ('PASS', 'COMPLETED');

CREATE UNIQUE INDEX IF NOT EXISTS uq_rrh_hipot_wo_pass_active
ON rrh_hipot_inspections (work_order_id, UPPER(TRIM(serial_number)))
WHERE is_deleted = false AND status IN ('PASS', 'COMPLETED');

CREATE UNIQUE INDEX IF NOT EXISTS uq_rrh_post_bi_wo_pass_active
ON rrh_post_burn_in_inspections (work_order_id, UPPER(TRIM(serial_number)), COALESCE(post_burn_in_type, 'STANDARD'))
WHERE is_deleted = false AND status IN ('PASS', 'COMPLETED');

-- 3. Archive Index Diet: Prune duplicate/redundant indexes on cold archive tables
DROP INDEX IF EXISTS rrh_ivi_inspections_archive_upper_idx;
DROP INDEX IF EXISTS rrh_ivi_inspections_archive_upper_idx1;
DROP INDEX IF EXISTS rrh_ivi_inspections_archive_upper_idx3;
DROP INDEX IF EXISTS rrh_ivi_inspections_archive_upper_idx4;

DROP INDEX IF EXISTS rrh_ipqc_inspections_archive_upper_idx;
DROP INDEX IF EXISTS rrh_ipqc_inspections_archive_upper_idx1;
DROP INDEX IF EXISTS rrh_ipqc_inspections_archive_upper_idx3;
DROP INDEX IF EXISTS rrh_ipqc_inspections_archive_upper_idx4;

DROP INDEX IF EXISTS rrh_programming_inspections_archive_upper_idx;
DROP INDEX IF EXISTS rrh_programming_inspections_archive_upper_idx1;
DROP INDEX IF EXISTS rrh_programming_inspections_archive_upper_idx3;
DROP INDEX IF EXISTS rrh_programming_inspections_archive_upper_idx4;

DROP INDEX IF EXISTS rrh_hipot_inspections_archive_upper_idx;
DROP INDEX IF EXISTS rrh_hipot_inspections_archive_upper_idx1;
DROP INDEX IF EXISTS rrh_hipot_inspections_archive_upper_idx3;
DROP INDEX IF EXISTS rrh_hipot_inspections_archive_upper_idx4;

DROP INDEX IF EXISTS rrh_post_burn_in_inspections_archive_upper_idx;
DROP INDEX IF EXISTS rrh_post_burn_in_inspections_archive_upper_idx1;
DROP INDEX IF EXISTS rrh_post_burn_in_inspections_archive_upper_idx3;
DROP INDEX IF EXISTS rrh_post_burn_in_inspections_archive_upper_idx4;
