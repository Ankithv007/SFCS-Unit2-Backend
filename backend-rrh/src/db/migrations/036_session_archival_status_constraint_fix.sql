-- =====================================================================================
-- Migration 036: Session Archival Status Constraint Alignment
-- Description:
--   Expands status check constraints on rrh_inward_sessions and rrh_ivi_sessions
--   to permit 'ARCHIVED', allowing the session lifecycle transitions in
--   archive_closed_work_orders_history() to succeed without constraint violations.
-- =====================================================================================

BEGIN;

ALTER TABLE rrh_inward_sessions DROP CONSTRAINT IF EXISTS chk_rrh_inward_sessions_status;
ALTER TABLE rrh_inward_sessions ADD CONSTRAINT chk_rrh_inward_sessions_status 
    CHECK (status IN ('Pending', 'In Progress', 'Paused', 'Completed', 'Cancelled', 'Aborted', 'ARCHIVED'));

ALTER TABLE rrh_ivi_sessions DROP CONSTRAINT IF EXISTS chk_rrh_ivi_sessions_status;
ALTER TABLE rrh_ivi_sessions ADD CONSTRAINT chk_rrh_ivi_sessions_status 
    CHECK (status IN ('In Progress', 'Completed', 'Cancelled', 'Aborted', 'ARCHIVED'));

COMMIT;
