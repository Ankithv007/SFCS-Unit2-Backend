-- ============================================================================
-- Migration Rollback: 029_enterprise_hot_paths_and_microbatch_archiving.down.sql
-- ============================================================================

-- Revert synchronization triggers to standard execution without WHEN bypass
DO $$
DECLARE
    tbl text;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'rrh_inward_sessions', 'rrh_inward_scans',
        'rrh_ivi_sessions', 'rrh_ivi_inspections',
        'rrh_ipqc_sessions', 'rrh_ipqc_inspections',
        'rrh_programming_sessions', 'rrh_programming_inspections',
        'rrh_pre_burn_in_sessions', 'rrh_pre_burn_in_inspections',
        'rrh_hipot_sessions', 'rrh_hipot_inspections',
        'rrh_post_burn_in_sessions', 'rrh_post_burn_in_inspections'
    ] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_sync_wo_internal_%I ON %I;', tbl, tbl);
        EXECUTE format('CREATE TRIGGER trg_sync_wo_internal_%I 
                        BEFORE INSERT OR UPDATE ON %I 
                        FOR EACH ROW 
                        EXECUTE FUNCTION sync_rrh_work_order_internal_id();', tbl, tbl);
    END LOOP;
END $$;

DROP FUNCTION IF EXISTS archive_closed_work_orders_history(INT, INT);
