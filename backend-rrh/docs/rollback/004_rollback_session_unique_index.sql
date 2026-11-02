-- ROLLBACK FOR 004_session_unique_index.sql
DROP INDEX CONCURRENTLY IF EXISTS uq_rrh_inward_sessions_active_side;
