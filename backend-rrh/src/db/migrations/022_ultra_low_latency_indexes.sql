-- ============================================================================
-- Migration 022: Ultra-Low Latency Indexes for SFCS RRH High-Throughput Scans
-- ============================================================================

-- 1. Covering indexes for Feeder Stage Passing Units (Index-Only Scan)
CREATE INDEX IF NOT EXISTS idx_rrh_ivi_wo_pass_covering 
ON rrh_ivi_inspections(UPPER(TRIM(work_order_id))) 
WHERE is_deleted = false AND status IN ('COMPLETED', 'PASS');

CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_wo_pass_covering 
ON rrh_ipqc_inspections(UPPER(TRIM(work_order_id))) 
WHERE is_deleted = false AND status IN ('COMPLETED', 'PASS');

CREATE INDEX IF NOT EXISTS idx_rrh_prog_wo_pass_covering 
ON rrh_programming_inspections(UPPER(TRIM(work_order_id))) 
WHERE is_deleted = false AND status IN ('COMPLETED', 'PASS');

CREATE INDEX IF NOT EXISTS idx_rrh_pbi_wo_pass_covering 
ON rrh_pre_burn_in_inspections(UPPER(TRIM(work_order_id))) 
WHERE is_deleted = false AND status IN ('COMPLETED', 'PASS');

CREATE INDEX IF NOT EXISTS idx_rrh_hipot_wo_pass_covering 
ON rrh_hipot_inspections(UPPER(TRIM(work_order_id))) 
WHERE is_deleted = false AND status IN ('COMPLETED', 'PASS');

CREATE INDEX IF NOT EXISTS idx_rrh_post_bi_wo_pass_covering 
ON rrh_post_burn_in_inspections(UPPER(TRIM(work_order_id))) 
WHERE is_deleted = false AND status IN ('COMPLETED', 'PASS');

-- 2. Ultra-Fast Barcode Lookup Partial Indexes (Targets Valid Passed Units in previous stage)
CREATE INDEX IF NOT EXISTS idx_rrh_ivi_lookup_serial_pass 
ON rrh_ivi_inspections(UPPER(TRIM(serial_number))) 
WHERE is_deleted = false AND status IN ('COMPLETED', 'PASS');

CREATE INDEX IF NOT EXISTS idx_rrh_ivi_lookup_band_pass 
ON rrh_ivi_inspections(UPPER(TRIM(COALESCE(band_serial_no, '')))) 
WHERE is_deleted = false AND status IN ('COMPLETED', 'PASS');

CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_lookup_serial_pass 
ON rrh_ipqc_inspections(UPPER(TRIM(serial_number))) 
WHERE is_deleted = false AND status IN ('COMPLETED', 'PASS');

CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_lookup_band_pass 
ON rrh_ipqc_inspections(UPPER(TRIM(COALESCE(band_serial_no, '')))) 
WHERE is_deleted = false AND status IN ('COMPLETED', 'PASS');

CREATE INDEX IF NOT EXISTS idx_rrh_prog_lookup_serial_pass 
ON rrh_programming_inspections(UPPER(TRIM(serial_number))) 
WHERE is_deleted = false AND status IN ('COMPLETED', 'PASS');

CREATE INDEX IF NOT EXISTS idx_rrh_prog_lookup_band_pass 
ON rrh_programming_inspections(UPPER(TRIM(COALESCE(band_serial_no, '')))) 
WHERE is_deleted = false AND status IN ('COMPLETED', 'PASS');

CREATE INDEX IF NOT EXISTS idx_rrh_prog_lookup_phys_pass 
ON rrh_programming_inspections(UPPER(TRIM(COALESCE(physical_serial_number, '')))) 
WHERE is_deleted = false AND status IN ('COMPLETED', 'PASS');

CREATE INDEX IF NOT EXISTS idx_rrh_pbi_lookup_serial_pass 
ON rrh_pre_burn_in_inspections(UPPER(TRIM(serial_number))) 
WHERE is_deleted = false AND status IN ('COMPLETED', 'PASS');

CREATE INDEX IF NOT EXISTS idx_rrh_pbi_lookup_band_pass 
ON rrh_pre_burn_in_inspections(UPPER(TRIM(COALESCE(band_serial_no, '')))) 
WHERE is_deleted = false AND status IN ('COMPLETED', 'PASS');

CREATE INDEX IF NOT EXISTS idx_rrh_pbi_lookup_phys_pass 
ON rrh_pre_burn_in_inspections(UPPER(TRIM(COALESCE(physical_serial_number, '')))) 
WHERE is_deleted = false AND status IN ('COMPLETED', 'PASS');

CREATE INDEX IF NOT EXISTS idx_rrh_hipot_lookup_serial_pass 
ON rrh_hipot_inspections(UPPER(TRIM(serial_number))) 
WHERE is_deleted = false AND status IN ('COMPLETED', 'PASS');

CREATE INDEX IF NOT EXISTS idx_rrh_hipot_lookup_band_pass 
ON rrh_hipot_inspections(UPPER(TRIM(COALESCE(band_serial_no, '')))) 
WHERE is_deleted = false AND status IN ('COMPLETED', 'PASS');

CREATE INDEX IF NOT EXISTS idx_rrh_hipot_lookup_phys_pass 
ON rrh_hipot_inspections(UPPER(TRIM(COALESCE(physical_serial_number, '')))) 
WHERE is_deleted = false AND status IN ('COMPLETED', 'PASS');

CREATE INDEX IF NOT EXISTS idx_rrh_post_bi_lookup_serial_pass 
ON rrh_post_burn_in_inspections(UPPER(TRIM(serial_number))) 
WHERE is_deleted = false AND status IN ('COMPLETED', 'PASS');

CREATE INDEX IF NOT EXISTS idx_rrh_post_bi_lookup_band_pass 
ON rrh_post_burn_in_inspections(UPPER(TRIM(COALESCE(band_serial_no, '')))) 
WHERE is_deleted = false AND status IN ('COMPLETED', 'PASS');

CREATE INDEX IF NOT EXISTS idx_rrh_post_bi_lookup_phys_pass 
ON rrh_post_burn_in_inspections(UPPER(TRIM(COALESCE(physical_serial_number, '')))) 
WHERE is_deleted = false AND status IN ('COMPLETED', 'PASS');

-- 3. Composite session pagination & real-time inspection log indexes
CREATE INDEX IF NOT EXISTS idx_rrh_prog_sess_pagination 
ON rrh_programming_inspections(session_id, id DESC) 
WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_rrh_pbi_sess_pagination 
ON rrh_pre_burn_in_inspections(session_id, id DESC) 
WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_rrh_hipot_sess_pagination 
ON rrh_hipot_inspections(session_id, id DESC) 
WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_rrh_post_bi_sess_pagination 
ON rrh_post_burn_in_inspections(session_id, id DESC) 
WHERE is_deleted = false;

-- 4. High-Performance Work Order Aggregation Covering Indexes
CREATE INDEX IF NOT EXISTS idx_rrh_prog_wo_status_covering 
ON rrh_programming_inspections(UPPER(TRIM(work_order_id)), status) 
WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_rrh_pbi_wo_status_covering 
ON rrh_pre_burn_in_inspections(UPPER(TRIM(work_order_id)), status) 
WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_rrh_hipot_wo_status_covering 
ON rrh_hipot_inspections(UPPER(TRIM(work_order_id)), status) 
WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_rrh_post_bi_wo_status_covering 
ON rrh_post_burn_in_inspections(UPPER(TRIM(work_order_id)), status) 
WHERE is_deleted = false;
