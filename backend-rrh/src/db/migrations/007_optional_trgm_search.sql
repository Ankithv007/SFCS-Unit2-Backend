-- ====================================================================================================
-- MIGRATION: 007_optional_trgm_search.sql
-- DESCRIPTION: Creates pg_trgm extension and GIN trigram index on rrh_excel_cells(display_value) 
--              to optimize ILIKE substring queries in /master-view.
-- EXECUTION: Runs CONCURRENTLY outside transaction block.
-- ====================================================================================================
-- no-transaction

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rrh_excel_cells_display_trgm 
ON rrh_excel_cells USING gin (display_value gin_trgm_ops);
