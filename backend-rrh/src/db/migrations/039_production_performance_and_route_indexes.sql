-- Migration: 039_production_performance_and_route_indexes.sql
-- Description: Composite route-aware session indexes, fail-lookup indexes, and inventory covering indexes for sub-millisecond production queries.

-- Ensure route column exists uniformly across all session tables
ALTER TABLE rrh_ivi_sessions ADD COLUMN IF NOT EXISTS route VARCHAR(50) DEFAULT 'ECN';
ALTER TABLE rrh_ipqc_sessions ADD COLUMN IF NOT EXISTS route VARCHAR(50) DEFAULT 'ECN';
ALTER TABLE rrh_programming_sessions ADD COLUMN IF NOT EXISTS route VARCHAR(50) DEFAULT 'ECN';
ALTER TABLE rrh_pre_burn_in_sessions ADD COLUMN IF NOT EXISTS route VARCHAR(50) DEFAULT 'ECN';
ALTER TABLE rrh_hipot_sessions ADD COLUMN IF NOT EXISTS route VARCHAR(50) DEFAULT 'ECN';
ALTER TABLE rrh_post_burn_in_sessions ADD COLUMN IF NOT EXISTS route VARCHAR(50) DEFAULT 'ECN';

-- 1. Route-aware composite indexes for session listing & status filtering across all RRH modules
CREATE INDEX IF NOT EXISTS idx_rrh_ivi_sess_route_status_created 
ON rrh_ivi_sessions (REPLACE(COALESCE(route, 'ECN'), '-', '_'), status, created_at DESC) 
WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_sess_route_status_created 
ON rrh_ipqc_sessions (REPLACE(COALESCE(route, 'ECN'), '-', '_'), status, created_at DESC) 
WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_rrh_prog_sess_route_status_created 
ON rrh_programming_sessions (REPLACE(COALESCE(route, 'ECN'), '-', '_'), status, created_at DESC) 
WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_rrh_pbi_sess_route_status_created 
ON rrh_pre_burn_in_sessions (REPLACE(COALESCE(route, 'ECN'), '-', '_'), status, created_at DESC) 
WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_rrh_hipot_sess_route_status_created 
ON rrh_hipot_sessions (REPLACE(COALESCE(route, 'ECN'), '-', '_'), status, created_at DESC) 
WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_rrh_post_bi_sess_route_status_created 
ON rrh_post_burn_in_sessions (REPLACE(COALESCE(route, 'ECN'), '-', '_'), status, created_at DESC) 
WHERE is_deleted = false;

-- 2. Fast Session Work Order Prefix/Search Indexes
CREATE INDEX IF NOT EXISTS idx_rrh_ivi_sess_wo_ci 
ON rrh_ivi_sessions (work_order_id varchar_pattern_ops, created_at DESC) 
WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_sess_wo_ci 
ON rrh_ipqc_sessions (work_order_id varchar_pattern_ops, created_at DESC) 
WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_rrh_prog_sess_wo_ci 
ON rrh_programming_sessions (work_order_id varchar_pattern_ops, created_at DESC) 
WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_rrh_pbi_sess_wo_ci 
ON rrh_pre_burn_in_sessions (work_order_id varchar_pattern_ops, created_at DESC) 
WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_rrh_hipot_sess_wo_ci 
ON rrh_hipot_sessions (work_order_id varchar_pattern_ops, created_at DESC) 
WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_rrh_post_bi_sess_wo_ci 
ON rrh_post_burn_in_sessions (work_order_id varchar_pattern_ops, created_at DESC) 
WHERE is_deleted = false;

-- 3. Previous FAIL Re-Inspection Hot Path Lookup Indexes
CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_sess_fail_serial 
ON rrh_ipqc_inspections (session_id, UPPER(TRIM(serial_number)), id DESC) 
WHERE is_deleted = false AND status = 'FAIL';

CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_sess_fail_band 
ON rrh_ipqc_inspections (session_id, UPPER(TRIM(COALESCE(band_serial_no, ''))), id DESC) 
WHERE is_deleted = false AND status = 'FAIL';

CREATE INDEX IF NOT EXISTS idx_rrh_prog_sess_fail_serial 
ON rrh_programming_inspections (session_id, UPPER(TRIM(serial_number)), id DESC) 
WHERE is_deleted = false AND status = 'FAIL';

CREATE INDEX IF NOT EXISTS idx_rrh_hipot_sess_fail_serial 
ON rrh_hipot_inspections (session_id, UPPER(TRIM(serial_number)), id DESC) 
WHERE is_deleted = false AND status = 'FAIL';

CREATE INDEX IF NOT EXISTS idx_rrh_pbi_sess_fail_serial 
ON rrh_pre_burn_in_inspections (session_id, UPPER(TRIM(serial_number)), id DESC) 
WHERE is_deleted = false AND status = 'FAIL';

CREATE INDEX IF NOT EXISTS idx_rrh_post_bi_sess_fail_serial 
ON rrh_post_burn_in_inspections (session_id, UPPER(TRIM(serial_number)), id DESC) 
WHERE is_deleted = false AND status = 'FAIL';

-- 4. Inventory & Inward Scan Covering Indexes
CREATE INDEX IF NOT EXISTS idx_rrh_inventory_import_band_covering 
ON rrh_inventory (import_id, UPPER(TRIM(band_serial_no))) 
INCLUDE (sl_no, physical_tpn, tejas_dc_no, tejas_obd_no, lot);

CREATE INDEX IF NOT EXISTS idx_rrh_inward_wo_active_covering 
ON rrh_inward_scans (UPPER(TRIM(work_order_id)), scanned_at DESC, id DESC) 
WHERE is_deleted = false;
