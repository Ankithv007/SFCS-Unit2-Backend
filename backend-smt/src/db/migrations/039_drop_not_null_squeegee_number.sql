-- Migration: 039_drop_not_null_squeegee_number.sql
-- Description: Drop NOT NULL constraint on squeegee_number column in all SMT sessions tables.

ALTER TABLE smt_printing_sessions ALTER COLUMN squeegee_number DROP NOT NULL;
ALTER TABLE smt_pre_aoi_sessions ALTER COLUMN squeegee_number DROP NOT NULL;
ALTER TABLE smt_post_aoi_sessions ALTER COLUMN squeegee_number DROP NOT NULL;
ALTER TABLE smt_rework_sessions ALTER COLUMN squeegee_number DROP NOT NULL;
ALTER TABLE smt_fg_sessions ALTER COLUMN squeegee_number DROP NOT NULL;
