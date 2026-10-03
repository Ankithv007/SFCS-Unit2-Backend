-- Migration: 005_add_band_serial_no_to_rrh_ivi_inspections.sql
-- Description: Add band_serial_no to rrh_ivi_inspections for complete parity with inward scans

ALTER TABLE rrh_ivi_inspections 
ADD COLUMN IF NOT EXISTS band_serial_no VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_rrh_ivi_inspections_band_serial 
ON rrh_ivi_inspections(band_serial_no);
