-- ============================================================================
-- Down Migration 032: Rollback Enterprise Archival & Sync Hardening
-- ============================================================================

DROP FUNCTION IF EXISTS generate_inspection_duplicate_audit_report(BOOLEAN);
DROP TABLE IF EXISTS rrh_migration_duplicate_quarantine;
DROP INDEX IF EXISTS idx_rrh_work_orders_archival;

-- Revert status constraint on rrh_work_orders
DO $$
BEGIN
    ALTER TABLE rrh_work_orders DROP CONSTRAINT IF EXISTS chk_rrh_work_orders_status;
    ALTER TABLE rrh_work_orders 
        ADD CONSTRAINT chk_rrh_work_orders_status 
        CHECK (status IN ('CREATED', 'IMPORTING', 'IN_PROGRESS', 'COMPLETED', 'PAUSED', 'CANCELLED', 'CLOSED'));
END $$;
