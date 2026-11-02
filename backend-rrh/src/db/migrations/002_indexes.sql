-- ====================================================================================================
-- MIGRATION: 002_indexes.sql
-- DESCRIPTION: High-performance expression indexes matching exact production queries.
-- EXECUTION: Runs CONCURRENTLY outside transaction block.
-- ====================================================================================================
-- no-transaction

-- 1. Expression Indexes on rrh_inventory (Used during inward scanning barcode matching)
-- Code Query 1: WHERE import_id = $1 AND TRIM(band_serial_no) = $2
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rrh_inventory_import_band_trim 
ON rrh_inventory(import_id, TRIM(band_serial_no));

-- Code Query 2: WHERE import_id = $1 AND UPPER(TRIM(band_serial_no)) = $2
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rrh_inventory_import_band_upper_trim 
ON rrh_inventory(import_id, UPPER(TRIM(band_serial_no)));

-- Code Query 3: WHERE import_id = $1 AND UPPER(TRIM(sl_no)) = $2
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rrh_inventory_import_sl_upper_trim 
ON rrh_inventory(import_id, UPPER(TRIM(sl_no)));

-- 2. Expression Index on rrh_ivi_inspections (Used during IVI lookup & duplicate checks)
-- Code Query: WHERE work_order_id = $1 AND UPPER(TRIM(serial_number)) = $2 AND is_deleted = false
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rrh_ivi_inspections_wo_serial_upper_trim 
ON rrh_ivi_inspections(work_order_id, UPPER(TRIM(serial_number))) 
WHERE is_deleted = false;
