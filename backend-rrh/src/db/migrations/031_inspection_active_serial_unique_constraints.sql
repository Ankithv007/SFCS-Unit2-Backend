-- ============================================================================
-- Migration 031: Active Serial Concurrency & Duplicate Inspection Prevention
-- Enforces partial unique constraints across Programming, Pre-Burn-In,
-- Hipot, and Post-Burn-In active inspections.
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_rrh_prog_active_serial
ON rrh_programming_inspections (session_id, UPPER(TRIM(serial_number)))
WHERE is_deleted = false;

CREATE UNIQUE INDEX IF NOT EXISTS uq_rrh_pre_burn_in_active_serial
ON rrh_pre_burn_in_inspections (session_id, UPPER(TRIM(serial_number)))
WHERE is_deleted = false;

CREATE UNIQUE INDEX IF NOT EXISTS uq_rrh_hipot_active_serial
ON rrh_hipot_inspections (session_id, UPPER(TRIM(serial_number)))
WHERE is_deleted = false;

CREATE UNIQUE INDEX IF NOT EXISTS uq_rrh_post_burn_in_active_serial
ON rrh_post_burn_in_inspections (session_id, UPPER(TRIM(serial_number)))
WHERE is_deleted = false;
