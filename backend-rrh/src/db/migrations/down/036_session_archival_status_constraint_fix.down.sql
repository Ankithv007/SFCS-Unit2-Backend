-- Rollback Migration 036: Revert status check constraints to pre-036 values

BEGIN;

ALTER TABLE rrh_inward_sessions DROP CONSTRAINT IF EXISTS chk_rrh_inward_sessions_status;
ALTER TABLE rrh_inward_sessions ADD CONSTRAINT chk_rrh_inward_sessions_status 
    CHECK (status IN ('Pending', 'In Progress', 'Paused', 'Completed', 'Cancelled', 'Aborted'));

ALTER TABLE rrh_ivi_sessions DROP CONSTRAINT IF EXISTS chk_rrh_ivi_sessions_status;
ALTER TABLE rrh_ivi_sessions ADD CONSTRAINT chk_rrh_ivi_sessions_status 
    CHECK (status IN ('In Progress', 'Completed', 'Cancelled', 'Aborted'));

COMMIT;
