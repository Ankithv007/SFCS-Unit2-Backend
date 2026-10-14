-- Migration 041: Fix Non-ECN Post-Burn-In Uniqueness
-- Non-ECN units undergo Post-Burn-In TWICE: once at INITIAL stage and once at FINAL stage.
-- The previous index uq_rrh_post_bi_wo_pass_active omitted post_burn_in_type, causing INITIAL pass records
-- to collide with and reject FINAL pass records for the same serial and work order.

-- 1. Drop the colliding unique index
DROP INDEX IF EXISTS uq_rrh_post_bi_wo_pass_active;

-- 2. Restore any valid INITIAL pass records that were falsely marked is_deleted = true by 040
UPDATE rrh_post_burn_in_inspections
SET is_deleted = false
WHERE is_deleted = true
  AND post_burn_in_type = 'INITIAL'
  AND status IN ('PASS', 'COMPLETED');

-- 3. Create the corrected unique index partitioned by work_order_id, serial, and post_burn_in_type
CREATE UNIQUE INDEX IF NOT EXISTS uq_rrh_post_bi_wo_pass_active
ON rrh_post_burn_in_inspections (work_order_id, UPPER(TRIM(serial_number)), COALESCE(post_burn_in_type, 'STANDARD'))
WHERE is_deleted = false AND status IN ('PASS', 'COMPLETED');
