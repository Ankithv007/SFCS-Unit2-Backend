-- Migration: 007_add_defect_fixed_to_rrh_ivi_inspections.sql
-- Description: Add defect_fixed column to rrh_ivi_inspections to track resolved defect remarks on re-inspected units

ALTER TABLE rrh_ivi_inspections ADD COLUMN IF NOT EXISTS defect_fixed TEXT;
