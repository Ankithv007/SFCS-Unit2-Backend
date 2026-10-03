-- Migration: 008_add_checkpoints_and_reinspected.sql
-- Description: Add checkpoints JSONB and is_reinspected BOOLEAN to rrh_ivi_inspections

ALTER TABLE rrh_ivi_inspections ADD COLUMN IF NOT EXISTS checkpoints JSONB;
ALTER TABLE rrh_ivi_inspections ADD COLUMN IF NOT EXISTS is_reinspected BOOLEAN DEFAULT false;
