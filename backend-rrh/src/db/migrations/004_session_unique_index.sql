-- ====================================================================================================
-- MIGRATION: 004_session_unique_index.sql
-- DESCRIPTION: Prevent concurrent duplicate active inward session creation for the same work order & side.
-- EXECUTION: Runs CONCURRENTLY outside transaction block.
-- ====================================================================================================
-- no-transaction

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_rrh_inward_sessions_active_side 
ON rrh_inward_sessions (work_order_id, COALESCE(side, '')) 
WHERE is_deleted = false AND status IN ('Pending', 'In Progress', 'Paused');
