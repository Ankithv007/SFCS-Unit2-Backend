-- Migration 055: Add performance indexes for barcode scanning hot paths
-- All indexes use IF NOT EXISTS and are purely additive.
-- NOTE: This migration runs inside a transaction (BEGIN/COMMIT) via runMigrations.ts.
-- CREATE INDEX CONCURRENTLY is NOT used here because it cannot run inside a transaction.
-- For very large tables (>1M rows), run the CONCURRENTLY variant manually out-of-band.

-- Index 1: Composite index for the core scan duplicate-check and validation query.
-- Speeds up: WHERE serial_id = $1 AND process_step = $2 AND status IN (...)
-- Also covers: ORDER BY scanned_at DESC LIMIT 1 after filtering serial_id + process_step.
CREATE INDEX IF NOT EXISTS idx_smt_insp_serial_step_status
    ON smt_inspections (serial_id, process_step, status);

-- Index 2: Composite index for serial number validation during a barcode scan.
-- Speeds up: WHERE serial_number = $1 AND work_order_id = $2
-- Also speeds up: WHERE work_order_id = $2 (prefix match).
CREATE INDEX IF NOT EXISTS idx_smt_serial_numbers_wo_serial
    ON smt_serial_numbers (work_order_id, serial_number);

-- Index 3: Index for work-order-level inspection queries (solder paste logs, tracking).
-- Speeds up: WHERE work_order_id = $1 AND serial_id IS NULL
-- Also helps: WHERE work_order_id = $1 AND process_step = ... AND status = ...
CREATE INDEX IF NOT EXISTS idx_smt_insp_work_order
    ON smt_inspections (work_order_id);
