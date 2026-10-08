-- 011_add_scrap_inspections.sql
-- Create dedicated table for IVI scrap inspections

CREATE TABLE IF NOT EXISTS rrh_ivi_scrap_inspections (
    id SERIAL PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES rrh_ivi_sessions(id) ON DELETE CASCADE,
    work_order_id VARCHAR(100) NOT NULL,
    serial_number VARCHAR(100) NOT NULL,
    band_serial_no VARCHAR(100),
    sl_no VARCHAR(50),
    tejas_dc_no VARCHAR(100),
    tejas_obd_no VARCHAR(100),
    bat_lot_no VARCHAR(100),
    physical_tpn VARCHAR(100),
    band VARCHAR(50),
    duplexer_main VARCHAR(100),
    duplexer_part_no VARCHAR(100),
    remarks TEXT,
    scanned_by VARCHAR(100),
    scanned_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_rrh_ivi_scrap_session ON rrh_ivi_scrap_inspections(session_id);
CREATE INDEX IF NOT EXISTS idx_rrh_ivi_scrap_wo ON rrh_ivi_scrap_inspections(work_order_id);
CREATE INDEX IF NOT EXISTS idx_rrh_ivi_scrap_serial ON rrh_ivi_scrap_inspections(UPPER(TRIM(serial_number)));
CREATE INDEX IF NOT EXISTS idx_rrh_ivi_scrap_band ON rrh_ivi_scrap_inspections(UPPER(TRIM(COALESCE(band_serial_no, ''))));
