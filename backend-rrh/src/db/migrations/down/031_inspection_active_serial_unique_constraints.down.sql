-- ============================================================================
-- Migration Rollback: 031_inspection_active_serial_unique_constraints.down.sql
-- ============================================================================

DROP INDEX IF EXISTS uq_rrh_prog_active_serial;
DROP INDEX IF EXISTS uq_rrh_pre_burn_in_active_serial;
DROP INDEX IF EXISTS uq_rrh_hipot_active_serial;
DROP INDEX IF EXISTS uq_rrh_post_burn_in_active_serial;
