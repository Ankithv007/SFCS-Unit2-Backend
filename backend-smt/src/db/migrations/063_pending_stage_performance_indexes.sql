-- ==============================================================================
-- Migration 063: Performance Indexes for Pending at Current Stage Queries
-- Description: Composite and expression indexes to optimize set-difference joins
--              between previous stage passed units and current stage inspections.
-- ==============================================================================

-- 1. Functional indexes on work order & side for fast session resolution
CREATE INDEX IF NOT EXISTS idx_smt_printing_sess_wo_side_ci 
ON smt_printing_sessions (UPPER(TRIM(work_order_id)), LOWER(TRIM(side))) 
WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_smt_spi_sess_wo_side_ci 
ON smt_spi_sessions (UPPER(TRIM(work_order_id)), LOWER(TRIM(side))) 
WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_smt_pre_aoi_sess_wo_side_ci 
ON smt_pre_aoi_sessions (UPPER(TRIM(work_order_id)), LOWER(TRIM(side))) 
WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_smt_post_aoi_sess_wo_side_ci 
ON smt_post_aoi_sessions (UPPER(TRIM(work_order_id)), LOWER(TRIM(side))) 
WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_smt_rework_sess_wo_side_ci 
ON smt_rework_sessions (UPPER(TRIM(work_order_id)), LOWER(TRIM(side))) 
WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_smt_fg_sess_wo_side_ci 
ON smt_fg_sessions (UPPER(TRIM(work_order_id)), LOWER(TRIM(side))) 
WHERE is_deleted = false;

-- 2. Composite indexes on smt_inspections by session ID, step & status
CREATE INDEX IF NOT EXISTS idx_smt_insp_printing_step_status 
ON smt_inspections (printing_session_id, process_step, UPPER(TRIM(status)), scanned_at DESC) 
WHERE printing_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_smt_insp_spi_step_status 
ON smt_inspections (spi_session_id, process_step, UPPER(TRIM(status)), scanned_at DESC) 
WHERE spi_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_smt_insp_pre_aoi_step_status 
ON smt_inspections (pre_aoi_session_id, process_step, UPPER(TRIM(status)), scanned_at DESC) 
WHERE pre_aoi_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_smt_insp_post_aoi_step_status 
ON smt_inspections (post_aoi_session_id, process_step, UPPER(TRIM(status)), scanned_at DESC) 
WHERE post_aoi_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_smt_insp_rework_step_status 
ON smt_inspections (rework_session_id, process_step, UPPER(TRIM(status)), scanned_at DESC) 
WHERE rework_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_smt_insp_fg_step_status 
ON smt_inspections (fg_session_id, process_step, UPPER(TRIM(status)), scanned_at DESC) 
WHERE fg_session_id IS NOT NULL;

-- 3. Expression index on scanned_barcode and serial_id for instant clean serial lookups
CREATE INDEX IF NOT EXISTS idx_smt_insp_scanned_barcode_upper_trim 
ON smt_inspections (UPPER(TRIM(scanned_barcode))) 
WHERE scanned_barcode IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_smt_insp_serial_id_active 
ON smt_inspections (serial_id, process_step, UPPER(TRIM(status))) 
WHERE serial_id IS NOT NULL;
