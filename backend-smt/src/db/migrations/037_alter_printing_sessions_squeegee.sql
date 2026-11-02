-- Migration: 037_alter_printing_sessions_squeegee.sql
-- Description: Add squeegee_front_number and squeegee_rear_number columns to smt_printing_sessions table.

ALTER TABLE smt_printing_sessions ADD COLUMN IF NOT EXISTS squeegee_front_number VARCHAR(255);
ALTER TABLE smt_printing_sessions ADD COLUMN IF NOT EXISTS squeegee_rear_number VARCHAR(255);
