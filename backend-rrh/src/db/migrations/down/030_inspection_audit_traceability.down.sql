-- ============================================================================
-- Migration Rollback: 030_inspection_audit_traceability.down.sql
-- ============================================================================

DO $$
DECLARE
    tbl text;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'rrh_ivi_inspections',
        'rrh_ipqc_inspections',
        'rrh_programming_inspections',
        'rrh_pre_burn_in_inspections',
        'rrh_hipot_inspections',
        'rrh_post_burn_in_inspections'
    ] LOOP
        EXECUTE format('DROP INDEX IF EXISTS idx_%I_superseded;', tbl);
        EXECUTE format('ALTER TABLE %I DROP COLUMN IF EXISTS superseded_by_id;', tbl);
        EXECUTE format('ALTER TABLE %I DROP COLUMN IF EXISTS superseded_at;', tbl);
    END LOOP;
END $$;
