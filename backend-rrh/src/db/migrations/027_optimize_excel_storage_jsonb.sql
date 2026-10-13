-- ============================================================================
-- Migration 027: Optimize Excel Master Data Storage to Document-Row JSONB
-- ============================================================================

-- 1. Add cells JSONB array and search_text column directly to rrh_excel_rows
ALTER TABLE rrh_excel_rows ADD COLUMN IF NOT EXISTS cells JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE rrh_excel_rows ADD COLUMN IF NOT EXISTS search_text TEXT DEFAULT '';

-- 2. Backfill existing rows from rrh_excel_cells
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM rrh_excel_cells LIMIT 1) THEN
        UPDATE rrh_excel_rows r
        SET cells = sub.cells_json,
            search_text = sub.search_txt
        FROM (
            SELECT 
                row_id,
                jsonb_agg(
                    jsonb_build_object(
                        'columnNumber', column_number,
                        'c', column_number,
                        'columnLetter', COALESCE(column_letter, ''),
                        'rawValue', raw_value,
                        'displayValue', display_value,
                        'v', display_value,
                        'dataType', COALESCE(data_type, 'string'),
                        't', COALESCE(data_type, 'string'),
                        'isMerged', false,
                        'mergeType', 'NONE',
                        'rowSpan', 1,
                        'colSpan', 1
                    ) ORDER BY column_number ASC
                ) AS cells_json,
                string_agg(COALESCE(display_value, raw_value, ''), ' ') AS search_txt
            FROM rrh_excel_cells
            GROUP BY row_id
        ) sub
        WHERE r.id = sub.row_id AND (r.cells IS NULL OR r.cells = '[]'::jsonb);
    END IF;
END $$;

-- 3. Targeted high-performance index on rrh_excel_rows
CREATE INDEX IF NOT EXISTS idx_rrh_excel_rows_sheet_row_type ON rrh_excel_rows(sheet_id, row_type);
