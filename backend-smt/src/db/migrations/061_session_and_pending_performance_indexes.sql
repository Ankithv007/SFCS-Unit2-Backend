-- ==============================================================================
-- Migration 061: Performance Indexes for Session Listing, History & Pending Views
-- Description: Composite and partial indexes on session and inspection tables
--              to optimize Active Session queries, Completed Session history,
--              session stats calculation, and Pending at Current Stage queries.
-- ==============================================================================

-- 1. Session Status and Created_At Composite Indexes (Active & Completed lists)
CREATE INDEX IF NOT EXISTS idx_smt_printing_sess_status_created 
ON smt_printing_sessions (status, created_at DESC) 
WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_smt_spi_sess_status_created 
ON smt_spi_sessions (status, created_at DESC) 
WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_smt_pre_aoi_sess_status_created 
ON smt_pre_aoi_sessions (status, created_at DESC) 
WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_smt_post_aoi_sess_status_created 
ON smt_post_aoi_sessions (status, created_at DESC) 
WHERE is_deleted = false;

-- 2. Serial Batches Listing Index
CREATE INDEX IF NOT EXISTS idx_smt_serial_batches_created 
ON smt_serial_batches (created_at DESC) 
WHERE is_deleted = false;

-- 3. Inspection Scans List by Session & Scanned_At (Active Session table)
CREATE INDEX IF NOT EXISTS idx_smt_insp_printing_scanned_at 
ON smt_inspections (printing_session_id, scanned_at DESC) 
WHERE printing_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_smt_insp_spi_scanned_at 
ON smt_inspections (spi_session_id, scanned_at DESC) 
WHERE spi_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_smt_insp_pre_aoi_scanned_at 
ON smt_inspections (pre_aoi_session_id, scanned_at DESC) 
WHERE pre_aoi_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_smt_insp_post_aoi_scanned_at 
ON smt_inspections (post_aoi_session_id, scanned_at DESC) 
WHERE post_aoi_session_id IS NOT NULL;
