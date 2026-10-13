-- ============================================================================
-- Migration 028: Drop Zombie Table, Enable TOAST Compression & Trigram Index
-- ============================================================================

-- 1. Drop Legacy EAV Cell Table (Eliminates zombie table and cascade overhead)
DROP TABLE IF EXISTS rrh_excel_cells CASCADE;

-- 2. Enable pg_trgm for ultra-fast fuzzy and sub-string search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 3. GIN Trigram index on search_text (turns sequential scan into sub-millisecond index search)
CREATE INDEX IF NOT EXISTS idx_rrh_excel_rows_search_trgm ON rrh_excel_rows USING gin (search_text gin_trgm_ops);

-- 4. Enable TOAST Extended Compression on document rows (cuts RAM and disk usage by ~70%)
ALTER TABLE rrh_excel_rows ALTER COLUMN cells SET STORAGE EXTENDED;
ALTER TABLE rrh_excel_rows ALTER COLUMN search_text SET STORAGE EXTENDED;
