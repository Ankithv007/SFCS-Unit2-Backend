-- Migration: 004_add_inward_scan_id_to_rrh_ivi_inspections.sql
-- Description: Add inward_scan_id foreign key to rrh_ivi_inspections

ALTER TABLE rrh_ivi_inspections 
ADD COLUMN IF NOT EXISTS inward_scan_id INTEGER REFERENCES rrh_inward_scans(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_rrh_ivi_inspections_inward_scan_id 
ON rrh_ivi_inspections(inward_scan_id);
