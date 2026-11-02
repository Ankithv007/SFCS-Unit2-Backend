-- Migration 060: Production Scan Performance Indexes
-- 
-- Comprehensive indexes designed to optimize all 5 SMT stages on the critical scan path:
-- 1. Serial number lookup by Work Order + upper-trimmed serial.
-- 2. Fast duplicate check and previous stage validation using (serial_id, process_step).
-- 3. Fast session + side lookups for previous stage verification without sequential scans.
-- 4. Fast single-pass FILTER aggregate stats calculation.

-- 1. Composite functional index for serial number lookup (Serial Gen, Printing, SPI, Pre AOI, Post AOI)
CREATE INDEX IF NOT EXISTS idx_smt_serial_numbers_wo_upper_serial
    ON smt_serial_numbers (work_order_id, UPPER(BTRIM(serial_number)));

-- 2. Fast lookup for previous stage validation & duplicate checks on inspections
CREATE INDEX IF NOT EXISTS idx_smt_insp_serial_step
    ON smt_inspections (serial_id, process_step);

CREATE INDEX IF NOT EXISTS idx_smt_insp_wo_step_status
    ON smt_inspections (work_order_id, process_step, status);

-- 3. Session-scoped partial indexes for index-only stats aggregation
CREATE INDEX IF NOT EXISTS idx_smt_insp_spi_session_status
    ON smt_inspections (spi_session_id, status)
    WHERE spi_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_smt_insp_printing_session_status
    ON smt_inspections (printing_session_id, status)
    WHERE printing_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_smt_insp_pre_aoi_session_status
    ON smt_inspections (pre_aoi_session_id, status)
    WHERE pre_aoi_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_smt_insp_post_aoi_session_status
    ON smt_inspections (post_aoi_session_id, status)
    WHERE post_aoi_session_id IS NOT NULL;

-- 4. Session side indexes to eliminate sequential scans during previous stage validation
CREATE INDEX IF NOT EXISTS idx_smt_printing_sessions_wo_side
    ON smt_printing_sessions (work_order_id, LOWER(side));

CREATE INDEX IF NOT EXISTS idx_smt_spi_sessions_wo_side
    ON smt_spi_sessions (work_order_id, LOWER(side));

CREATE INDEX IF NOT EXISTS idx_smt_pre_aoi_sessions_wo_side
    ON smt_pre_aoi_sessions (work_order_id, LOWER(side));

CREATE INDEX IF NOT EXISTS idx_smt_post_aoi_sessions_wo_side
    ON smt_post_aoi_sessions (work_order_id, LOWER(side));
