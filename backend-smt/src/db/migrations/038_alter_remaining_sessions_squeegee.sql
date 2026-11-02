-- Migration: 038_alter_remaining_sessions_squeegee.sql
-- Description: Add squeegee_front_number and squeegee_rear_number columns to pre-aoi, post-aoi, rework, and SMT FG sessions tables.

ALTER TABLE smt_pre_aoi_sessions ADD COLUMN IF NOT EXISTS squeegee_front_number VARCHAR(255);
ALTER TABLE smt_pre_aoi_sessions ADD COLUMN IF NOT EXISTS squeegee_rear_number VARCHAR(255);

ALTER TABLE smt_post_aoi_sessions ADD COLUMN IF NOT EXISTS squeegee_front_number VARCHAR(255);
ALTER TABLE smt_post_aoi_sessions ADD COLUMN IF NOT EXISTS squeegee_rear_number VARCHAR(255);

ALTER TABLE smt_rework_sessions ADD COLUMN IF NOT EXISTS squeegee_front_number VARCHAR(255);
ALTER TABLE smt_rework_sessions ADD COLUMN IF NOT EXISTS squeegee_rear_number VARCHAR(255);

ALTER TABLE smt_fg_sessions ADD COLUMN IF NOT EXISTS squeegee_front_number VARCHAR(255);
ALTER TABLE smt_fg_sessions ADD COLUMN IF NOT EXISTS squeegee_rear_number VARCHAR(255);
