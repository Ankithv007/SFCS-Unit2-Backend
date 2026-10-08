-- 010_add_pass_to_next_stage.sql
-- Add pass to next stage columns to rrh_ivi_inspections

ALTER TABLE rrh_ivi_inspections 
ADD COLUMN IF NOT EXISTS passed_to_next_stage BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS passed_to_next_stage_at TIMESTAMP WITHOUT TIME ZONE,
ADD COLUMN IF NOT EXISTS passed_to_next_stage_by VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_rrh_ivi_inspections_passed_stage ON rrh_ivi_inspections (passed_to_next_stage) WHERE passed_to_next_stage = TRUE;
