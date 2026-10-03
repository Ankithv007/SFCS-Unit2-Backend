-- ====================================================================================================
-- ROLLBACK: 006_rollback_foreign_keys_validate.sql
-- DESCRIPTION: Drops added foreign key constraints safely.
-- ====================================================================================================

ALTER TABLE rrh_ivi_inspections DROP CONSTRAINT IF EXISTS fk_rrh_ivi_inspections_session;
ALTER TABLE rrh_ivi_inspections DROP CONSTRAINT IF EXISTS fk_rrh_ivi_inspections_wo_id;
ALTER TABLE rrh_ivi_sessions DROP CONSTRAINT IF EXISTS fk_rrh_ivi_sessions_wo_id;
ALTER TABLE rrh_inward_scans DROP CONSTRAINT IF EXISTS fk_rrh_inward_scans_wo_id;
ALTER TABLE rrh_inward_sessions DROP CONSTRAINT IF EXISTS fk_rrh_inward_sessions_wo_id;
ALTER TABLE rrh_inward_scans DROP CONSTRAINT IF EXISTS fk_rrh_inward_scans_matched_inv;
ALTER TABLE rrh_inward_scans DROP CONSTRAINT IF EXISTS fk_rrh_inward_scans_session;

DELETE FROM schema_migrations WHERE migration_name = '006_foreign_keys_validate.sql';
