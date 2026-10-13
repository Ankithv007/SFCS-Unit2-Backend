-- Migration: 017_add_missing_programming_columns.sql
-- Description: Ensure inspection_date, ivi_inspection_id, and checkpoints columns exist in rrh_programming_inspections

ALTER TABLE rrh_programming_inspections 
ADD COLUMN IF NOT EXISTS inspection_date DATE DEFAULT CURRENT_DATE,
ADD COLUMN IF NOT EXISTS ivi_inspection_id INTEGER REFERENCES rrh_ivi_inspections(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS checkpoints JSONB DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_rrh_prog_inspections_ivi_id ON rrh_programming_inspections(ivi_inspection_id);
