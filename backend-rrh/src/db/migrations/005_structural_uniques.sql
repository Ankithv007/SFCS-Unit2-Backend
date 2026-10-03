-- ====================================================================================================
-- MIGRATION: 005_structural_uniques.sql
-- DESCRIPTION: High-concurrency unique indexes on raw Excel tables built CONCURRENTLY.
--              Removes redundant plain index once unique index is established.
-- EXECUTION: Runs CONCURRENTLY outside transaction block.
-- ====================================================================================================
-- no-transaction

-- 1. Unique revisions per work order
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_idx_rrh_excel_imports_wo_revision 
ON rrh_excel_imports (work_order_id, revision);

-- 2. Unique rows per sheet
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_idx_rrh_excel_rows_sheet_row_num 
ON rrh_excel_rows (sheet_id, row_number);

-- 3. Unique cells per row/column
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_idx_rrh_excel_cells_row_col 
ON rrh_excel_cells (row_id, column_number);

-- 4. Drop duplicate plain index now covered by leading column of unique index
DROP INDEX CONCURRENTLY IF EXISTS idx_rrh_excel_cells_row_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_rrh_excel_cells_row_col;
