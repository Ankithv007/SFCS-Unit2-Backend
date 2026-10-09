-- 0. Ensure soft-delete and tracking columns exist
ALTER TABLE rrh_work_orders ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE rrh_work_orders ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE rrh_work_orders ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(100);

ALTER TABLE rrh_excel_imports ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE rrh_excel_imports ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

ALTER TABLE rrh_inventory ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;

-- 1. RRH Work Orders
CREATE INDEX IF NOT EXISTS idx_rrh_wo_id_upper_active ON rrh_work_orders(UPPER(TRIM(work_order_id))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_wo_status_date ON rrh_work_orders(status, created_at DESC) WHERE is_deleted = false;

-- 2. RRH Inventory
CREATE INDEX IF NOT EXISTS idx_rrh_inv_import_upper_band ON rrh_inventory(import_id, UPPER(TRIM(COALESCE(band_serial_no, ''))));
CREATE INDEX IF NOT EXISTS idx_rrh_inv_import_upper_sl ON rrh_inventory(import_id, UPPER(TRIM(COALESCE(sl_no, ''))));

-- 3. RRH Inward Scans
CREATE INDEX IF NOT EXISTS idx_rrh_inward_scans_upper_serial ON rrh_inward_scans(UPPER(TRIM(serial_number))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_inward_scans_upper_band ON rrh_inward_scans(UPPER(TRIM(COALESCE(band_serial_no, '')))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_inward_scans_wo_upper ON rrh_inward_scans(UPPER(TRIM(work_order_id)), status) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_inward_scans_session_perf ON rrh_inward_scans(rrh_inward_session_id, id ASC) WHERE is_deleted = false;

-- 4. RRH IVI Sessions
CREATE INDEX IF NOT EXISTS idx_rrh_ivi_sessions_wo_upper_active ON rrh_ivi_sessions(UPPER(TRIM(work_order_id))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ivi_sessions_status_active ON rrh_ivi_sessions(status, created_at DESC) WHERE is_deleted = false;

-- 5. RRH IVI Inspections
CREATE INDEX IF NOT EXISTS idx_rrh_ivi_wo_upper_status_route ON rrh_ivi_inspections(UPPER(TRIM(work_order_id)), status, passed_to_next_stage, COALESCE(route, 'ECN')) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ivi_session_status_scanned ON rrh_ivi_inspections(session_id, status, scanned_at DESC, id DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ivi_upper_serial ON rrh_ivi_inspections(UPPER(TRIM(serial_number))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ivi_upper_band ON rrh_ivi_inspections(UPPER(TRIM(COALESCE(band_serial_no, '')))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ivi_wo_upper_serial ON rrh_ivi_inspections(UPPER(TRIM(work_order_id)), UPPER(TRIM(serial_number))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ivi_wo_upper_band ON rrh_ivi_inspections(UPPER(TRIM(work_order_id)), UPPER(TRIM(COALESCE(band_serial_no, '')))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ivi_session_upper_serial ON rrh_ivi_inspections(session_id, UPPER(TRIM(serial_number))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ivi_session_upper_band ON rrh_ivi_inspections(session_id, UPPER(TRIM(COALESCE(band_serial_no, '')))) WHERE is_deleted = false;

-- 6. RRH IVI Scrap Inspections
CREATE INDEX IF NOT EXISTS idx_rrh_ivi_scrap_session_perf ON rrh_ivi_scrap_inspections(session_id, scanned_at DESC, id DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ivi_scrap_wo_upper ON rrh_ivi_scrap_inspections(UPPER(TRIM(work_order_id))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ivi_scrap_upper_serial ON rrh_ivi_scrap_inspections(UPPER(TRIM(serial_number))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ivi_scrap_upper_band ON rrh_ivi_scrap_inspections(UPPER(TRIM(COALESCE(band_serial_no, '')))) WHERE is_deleted = false;

-- 7. RRH IPQC Sessions
CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_sessions_wo_upper_active ON rrh_ipqc_sessions(UPPER(TRIM(work_order_id))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_sessions_status_active ON rrh_ipqc_sessions(status, created_at DESC) WHERE is_deleted = false;

-- 8. RRH IPQC Inspections
CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_session_status_scanned ON rrh_ipqc_inspections(session_id, status, scanned_at DESC, id DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_wo_upper_status ON rrh_ipqc_inspections(UPPER(TRIM(work_order_id)), status) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_upper_serial ON rrh_ipqc_inspections(UPPER(TRIM(serial_number))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_upper_band ON rrh_ipqc_inspections(UPPER(TRIM(COALESCE(band_serial_no, '')))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_wo_upper_serial ON rrh_ipqc_inspections(UPPER(TRIM(work_order_id)), UPPER(TRIM(serial_number))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_wo_upper_band ON rrh_ipqc_inspections(UPPER(TRIM(work_order_id)), UPPER(TRIM(COALESCE(band_serial_no, '')))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_session_upper_serial ON rrh_ipqc_inspections(session_id, UPPER(TRIM(serial_number))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_session_upper_band ON rrh_ipqc_inspections(session_id, UPPER(TRIM(COALESCE(band_serial_no, '')))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_ivi_id_active ON rrh_ipqc_inspections(ivi_inspection_id) WHERE is_deleted = false AND ivi_inspection_id IS NOT NULL;
