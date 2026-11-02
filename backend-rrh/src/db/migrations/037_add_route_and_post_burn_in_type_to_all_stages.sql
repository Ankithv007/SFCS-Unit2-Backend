-- Migration: 037_add_route_and_post_burn_in_type_to_all_stages.sql
-- Description: Adds route and post_burn_in_type columns with indexes for explicit ECN and Non-ECN partitioning

ALTER TABLE rrh_programming_sessions ADD COLUMN IF NOT EXISTS route VARCHAR(50) DEFAULT 'ECN';
ALTER TABLE rrh_programming_inspections ADD COLUMN IF NOT EXISTS route VARCHAR(50) DEFAULT 'ECN';

ALTER TABLE rrh_pre_burn_in_sessions ADD COLUMN IF NOT EXISTS route VARCHAR(50) DEFAULT 'ECN';
ALTER TABLE rrh_pre_burn_in_inspections ADD COLUMN IF NOT EXISTS route VARCHAR(50) DEFAULT 'ECN';

ALTER TABLE rrh_hipot_sessions ADD COLUMN IF NOT EXISTS route VARCHAR(50) DEFAULT 'ECN';
ALTER TABLE rrh_hipot_inspections ADD COLUMN IF NOT EXISTS route VARCHAR(50) DEFAULT 'ECN';

ALTER TABLE rrh_post_burn_in_sessions ADD COLUMN IF NOT EXISTS route VARCHAR(50) DEFAULT 'ECN';
ALTER TABLE rrh_post_burn_in_sessions ADD COLUMN IF NOT EXISTS post_burn_in_type VARCHAR(50) DEFAULT 'STANDARD';

ALTER TABLE rrh_post_burn_in_inspections ADD COLUMN IF NOT EXISTS route VARCHAR(50) DEFAULT 'ECN';
ALTER TABLE rrh_post_burn_in_inspections ADD COLUMN IF NOT EXISTS post_burn_in_type VARCHAR(50) DEFAULT 'STANDARD';

CREATE INDEX IF NOT EXISTS idx_rrh_prog_inspections_route ON rrh_programming_inspections(route) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_pbi_inspections_route ON rrh_pre_burn_in_inspections(route) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_hipot_inspections_route ON rrh_hipot_inspections(route) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_post_bi_inspections_route_type ON rrh_post_burn_in_inspections(route, post_burn_in_type) WHERE is_deleted = false;
