-- Migration 042: Add duplexer_sl_no to IVI inspection tables
ALTER TABLE rrh_ivi_inspections ADD COLUMN IF NOT EXISTS duplexer_sl_no VARCHAR(255);
ALTER TABLE rrh_ivi_inspections_archive ADD COLUMN IF NOT EXISTS duplexer_sl_no VARCHAR(255);
ALTER TABLE rrh_ivi_scrap_inspections ADD COLUMN IF NOT EXISTS duplexer_sl_no VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_rrh_ivi_inspections_duplexer_sl_no 
ON rrh_ivi_inspections(UPPER(TRIM(duplexer_sl_no))) 
WHERE is_deleted = false;
