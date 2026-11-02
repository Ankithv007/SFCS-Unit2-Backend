-- Migration: 038_add_route_to_rrh_ipqc_tables.sql
-- Description: Adds route column to rrh_ipqc_sessions and rrh_ipqc_inspections for uniform schema and query compatibility

ALTER TABLE rrh_ipqc_sessions ADD COLUMN IF NOT EXISTS route VARCHAR(50) DEFAULT 'ECN';
ALTER TABLE rrh_ipqc_inspections ADD COLUMN IF NOT EXISTS route VARCHAR(50) DEFAULT 'ECN';

CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_sessions_route ON rrh_ipqc_sessions(route) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_inspections_route ON rrh_ipqc_inspections(route) WHERE is_deleted = false;
