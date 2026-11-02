-- Migration: 019_programming_latency_indexes.sql
-- Description: Add composite and functional indexes for maximum query throughput and minimum latency in RRH Programming

-- 1. Compound filter & sort indexes
CREATE INDEX IF NOT EXISTS idx_rrh_prog_session_status_scanned 
ON rrh_programming_inspections(session_id, status, scanned_at DESC, id DESC) 
WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_rrh_prog_session_scanned_id 
ON rrh_programming_inspections(session_id, scanned_at DESC, id DESC) 
WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_rrh_prog_wo_status_scanned 
ON rrh_programming_inspections(work_order_id, status, scanned_at DESC) 
WHERE is_deleted = false;

-- 2. Functional uppercase trimmed indexes for fast lookups & anti-joins (NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_rrh_prog_upper_serial 
ON rrh_programming_inspections(UPPER(TRIM(serial_number))) 
WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_rrh_prog_upper_band_serial 
ON rrh_programming_inspections(UPPER(TRIM(COALESCE(band_serial_no, '')))) 
WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_rrh_prog_wo_upper 
ON rrh_programming_inspections(UPPER(TRIM(work_order_id))) 
WHERE is_deleted = false;

-- 3. Sessions composite index for quick status listings
CREATE INDEX IF NOT EXISTS idx_rrh_prog_sessions_wo_upper 
ON rrh_programming_sessions(UPPER(TRIM(work_order_id)), status) 
WHERE is_deleted = false;
