-- ============================================================================
-- Down Migration 033: Rollback Canonical Identity & Lossless Archival
-- ============================================================================

DROP FUNCTION IF EXISTS restore_archived_work_order(VARCHAR);
DROP TABLE IF EXISTS rrh_inward_session_master_consumption_archive;
DROP INDEX IF EXISTS uq_rrh_work_orders_canonical_wo_id;
DROP TRIGGER IF EXISTS trg_validate_wo_active_import ON rrh_work_orders;
DROP FUNCTION IF EXISTS validate_rrh_work_order_active_import();
