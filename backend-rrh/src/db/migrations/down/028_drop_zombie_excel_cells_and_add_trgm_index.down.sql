-- ============================================================================
-- Migration Rollback: 028_drop_zombie_excel_cells_and_add_trgm_index.down.sql
-- ============================================================================

DROP INDEX IF EXISTS idx_rrh_excel_rows_search_trgm;
ALTER TABLE rrh_excel_rows ALTER COLUMN cells SET STORAGE DEFAULT;
ALTER TABLE rrh_excel_rows ALTER COLUMN search_text SET STORAGE DEFAULT;
