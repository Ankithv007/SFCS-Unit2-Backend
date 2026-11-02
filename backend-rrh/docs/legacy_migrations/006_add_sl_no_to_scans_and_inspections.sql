-- Migration: 006_add_sl_no_to_scans_and_inspections.sql
-- Description: Add sl_no to rrh_inward_scans and rrh_ivi_inspections for consistent S.No tracking across RRH Inward, Remaining Inward Master Data, and Recent IVI Inspections

ALTER TABLE rrh_inward_scans ADD COLUMN IF NOT EXISTS sl_no VARCHAR(255);
ALTER TABLE rrh_ivi_inspections ADD COLUMN IF NOT EXISTS sl_no VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_inward_scans_sl_no ON rrh_inward_scans(sl_no);
CREATE INDEX IF NOT EXISTS idx_ivi_inspections_sl_no ON rrh_ivi_inspections(sl_no);

-- Backfill existing rrh_inward_scans.sl_no from matched rrh_inventory
UPDATE rrh_inward_scans s
SET sl_no = i.sl_no
FROM rrh_inventory i
WHERE s.matched_inventory_id = i.id AND (s.sl_no IS NULL OR s.sl_no = '');

-- Backfill existing rrh_ivi_inspections.sl_no from linked inward scan or inventory
UPDATE rrh_ivi_inspections rii
SET sl_no = COALESCE(ins.sl_no, i.sl_no)
FROM rrh_inward_scans ins
LEFT JOIN rrh_inventory i ON ins.matched_inventory_id = i.id
WHERE (
    rii.inward_scan_id = ins.id 
    OR (rii.inward_scan_id IS NULL AND (UPPER(TRIM(ins.serial_number)) = UPPER(TRIM(rii.serial_number)) OR UPPER(TRIM(ins.band_serial_no)) = UPPER(TRIM(rii.serial_number))))
)
AND (rii.sl_no IS NULL OR rii.sl_no = '');
