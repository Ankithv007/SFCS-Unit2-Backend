-- ====================================================================================================
-- ROLLBACK: 005_rollback_structural_uniques.sql
-- DESCRIPTION: Drops concurrently created unique indexes and restores plain index on excel cells.
-- ====================================================================================================
-- no-transaction

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rrh_excel_cells_row_id ON rrh_excel_cells(row_id);

DROP INDEX CONCURRENTLY IF EXISTS uq_idx_rrh_excel_cells_row_col;
DROP INDEX CONCURRENTLY IF EXISTS uq_idx_rrh_excel_rows_sheet_row_num;
DROP INDEX CONCURRENTLY IF EXISTS uq_idx_rrh_excel_imports_wo_revision;

DELETE FROM schema_migrations WHERE migration_name = '005_structural_uniques.sql';
