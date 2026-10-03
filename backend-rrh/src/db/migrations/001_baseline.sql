-- ====================================================================================================
-- MIGRATION: 001_baseline.sql
-- DESCRIPTION: Consolidated idempotent baseline schema for RRH (Remote Radio Head) Module.
-- SAFE ON: Empty DB and Existing Live Database (no data changes).
-- ====================================================================================================

-- 1. RRH Work Orders
CREATE TABLE IF NOT EXISTS rrh_work_orders (
    id SERIAL PRIMARY KEY,
    work_order_id VARCHAR(100) UNIQUE NOT NULL,
    work_order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    date DATE,
    lot_quantity INT NOT NULL CHECK (lot_quantity > 0),
    status VARCHAR(50) DEFAULT 'CREATED',
    active_import_id INTEGER,
    excel_filename VARCHAR(255),
    excel_file_path VARCHAR(500),
    excel_file_size BIGINT,
    excel_columns JSONB DEFAULT '[]'::jsonb,
    excel_data JSONB DEFAULT '[]'::jsonb,
    total_excel_rows INT DEFAULT 0,
    created_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rrh_work_orders_wo_id ON rrh_work_orders(work_order_id);
CREATE INDEX IF NOT EXISTS idx_rrh_work_orders_date ON rrh_work_orders(work_order_date);

-- 2. RRH Excel Imports
CREATE TABLE IF NOT EXISTS rrh_excel_imports (
    id SERIAL PRIMARY KEY,
    work_order_id INTEGER REFERENCES rrh_work_orders(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL DEFAULT 1,
    original_filename VARCHAR(255) NOT NULL,
    stored_filename VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL,
    file_hash VARCHAR(255),
    status VARCHAR(50) DEFAULT 'PENDING',
    confirmed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rrh_excel_imports_work_order_id ON rrh_excel_imports(work_order_id);
CREATE INDEX IF NOT EXISTS idx_rrh_excel_imports_status ON rrh_excel_imports(status);

-- Guarded Foreign Key from rrh_work_orders to rrh_excel_imports (fk_active_import)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_active_import'
    ) THEN
        ALTER TABLE rrh_work_orders
        ADD CONSTRAINT fk_active_import
        FOREIGN KEY (active_import_id)
        REFERENCES rrh_excel_imports(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rrh_work_orders_active_import_id ON rrh_work_orders(active_import_id);

-- 3. Raw Structural Excel Staging Tables
CREATE TABLE IF NOT EXISTS rrh_excel_sheets (
    id SERIAL PRIMARY KEY,
    import_id INTEGER REFERENCES rrh_excel_imports(id) ON DELETE CASCADE,
    sheet_name VARCHAR(255) NOT NULL,
    sheet_index INTEGER,
    total_rows INTEGER,
    total_columns INTEGER
);

CREATE INDEX IF NOT EXISTS idx_rrh_excel_sheets_import_id ON rrh_excel_sheets(import_id);

CREATE TABLE IF NOT EXISTS rrh_excel_rows (
    id SERIAL PRIMARY KEY,
    sheet_id INTEGER REFERENCES rrh_excel_sheets(id) ON DELETE CASCADE,
    row_number INTEGER NOT NULL,
    row_type VARCHAR(50) -- HEADER, SUB_HEADER, DATA, BLANK
);

CREATE INDEX IF NOT EXISTS idx_rrh_excel_rows_sheet_id ON rrh_excel_rows(sheet_id);
CREATE INDEX IF NOT EXISTS idx_rrh_excel_rows_sheet_row_num ON rrh_excel_rows(sheet_id, row_number);

CREATE TABLE IF NOT EXISTS rrh_excel_cells (
    id SERIAL PRIMARY KEY,
    row_id INTEGER REFERENCES rrh_excel_rows(id) ON DELETE CASCADE,
    column_number INTEGER NOT NULL,
    column_letter VARCHAR(10),
    raw_value TEXT,
    display_value TEXT,
    data_type VARCHAR(50)
);

CREATE INDEX IF NOT EXISTS idx_rrh_excel_cells_row_id ON rrh_excel_cells(row_id);

CREATE TABLE IF NOT EXISTS rrh_excel_merged_cells (
    id SERIAL PRIMARY KEY,
    sheet_id INTEGER REFERENCES rrh_excel_sheets(id) ON DELETE CASCADE,
    range_reference VARCHAR(50) NOT NULL,
    start_row INTEGER NOT NULL,
    start_column INTEGER NOT NULL,
    end_row INTEGER NOT NULL,
    end_column INTEGER NOT NULL,
    row_span INTEGER,
    column_span INTEGER
);

CREATE INDEX IF NOT EXISTS idx_rrh_excel_merged_cells_sheet_id ON rrh_excel_merged_cells(sheet_id);

-- 4. Normalized Business Master Tables
CREATE TABLE IF NOT EXISTS rrh_inventory (
    id SERIAL PRIMARY KEY,
    import_id INTEGER REFERENCES rrh_excel_imports(id) ON DELETE CASCADE,
    sl_no VARCHAR(255),
    tejas_dc_no VARCHAR(255),
    tejas_obd_no VARCHAR(255),
    physical_tpn VARCHAR(255),
    band_serial_no VARCHAR(255),
    pr_no VARCHAR(255),
    invoice_rma_no VARCHAR(255),
    vendor_name_for_rework VARCHAR(255),
    coordinator_name VARCHAR(255),
    issued_date DATE,
    lot VARCHAR(255),
    remarks TEXT,
    failure_description TEXT,
    remarks_2 TEXT
);

CREATE INDEX IF NOT EXISTS idx_rrh_inventory_import_id ON rrh_inventory(import_id);
CREATE INDEX IF NOT EXISTS idx_rrh_inventory_band_serial_no ON rrh_inventory(band_serial_no);
CREATE INDEX IF NOT EXISTS idx_rrh_inventory_sl_no ON rrh_inventory(sl_no);

CREATE TABLE IF NOT EXISTS rrh_existing_inventory (
    id SERIAL PRIMARY KEY,
    inventory_id INTEGER REFERENCES rrh_inventory(id) ON DELETE CASCADE,
    rfpc_no VARCHAR(255),
    pam0_sl_no VARCHAR(255),
    pam1_sl_no VARCHAR(255),
    pam2_sl_no VARCHAR(255),
    pam3_sl_no VARCHAR(255),
    lna_sl_no VARCHAR(255),
    rfpc_model_no VARCHAR(255),
    sw_version VARCHAR(255),
    sfp0_serial_no VARCHAR(255),
    sfp1_serial_no VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_rrh_existing_inventory_inv_id ON rrh_existing_inventory(inventory_id);

CREATE TABLE IF NOT EXISTS rrh_replaced_inventory (
    id SERIAL PRIMARY KEY,
    inventory_id INTEGER REFERENCES rrh_inventory(id) ON DELETE CASCADE,
    rfpc_no VARCHAR(255),
    pam0_sl_no VARCHAR(255),
    pam1_sl_no VARCHAR(255),
    pam2_sl_no VARCHAR(255),
    pam3_sl_no VARCHAR(255),
    lna_sl_no VARCHAR(255),
    sfp0_serial_no VARCHAR(255),
    sfp1_serial_no VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_rrh_replaced_inventory_inv_id ON rrh_replaced_inventory(inventory_id);

-- Comments on the 32 Master Fields (Position 1..32)
COMMENT ON COLUMN rrh_inventory.sl_no IS 'Position 1: SL No';
COMMENT ON COLUMN rrh_inventory.tejas_dc_no IS 'Position 2: Tejas DC No';
COMMENT ON COLUMN rrh_inventory.tejas_obd_no IS 'Position 3: Tejas OBD No';
COMMENT ON COLUMN rrh_inventory.physical_tpn IS 'Position 4: Physical TPN';
COMMENT ON COLUMN rrh_inventory.band_serial_no IS 'Position 5: Band Serial No';
COMMENT ON COLUMN rrh_inventory.pr_no IS 'Position 6: PR No';
COMMENT ON COLUMN rrh_inventory.invoice_rma_no IS 'Position 7: Invoice/ RMA No';
COMMENT ON COLUMN rrh_inventory.vendor_name_for_rework IS 'Position 8: Vendor Name for Rework';
COMMENT ON COLUMN rrh_inventory.coordinator_name IS 'Position 9: Coordinator Name';
COMMENT ON COLUMN rrh_inventory.issued_date IS 'Position 10: Issued Date';
COMMENT ON COLUMN rrh_inventory.lot IS 'Position 11: Lot';
COMMENT ON COLUMN rrh_inventory.remarks IS 'Position 12: Remarks';
COMMENT ON COLUMN rrh_inventory.failure_description IS 'Position 13: Failure Description';
COMMENT ON COLUMN rrh_inventory.remarks_2 IS 'Position 14: Remarks 2';

COMMENT ON COLUMN rrh_existing_inventory.rfpc_no IS 'Position 15: Existing RFPC No';
COMMENT ON COLUMN rrh_existing_inventory.pam0_sl_no IS 'Position 16: Existing PAM0 SL No';
COMMENT ON COLUMN rrh_existing_inventory.pam1_sl_no IS 'Position 17: Existing PAM1 SL No';
COMMENT ON COLUMN rrh_existing_inventory.pam2_sl_no IS 'Position 18: Existing PAM2 SL No';
COMMENT ON COLUMN rrh_existing_inventory.pam3_sl_no IS 'Position 19: Existing PAM3 SL No';
COMMENT ON COLUMN rrh_existing_inventory.lna_sl_no IS 'Position 20: Existing LNA SL No';
COMMENT ON COLUMN rrh_existing_inventory.rfpc_model_no IS 'Position 21: Existing RFPC Model No';
COMMENT ON COLUMN rrh_existing_inventory.sw_version IS 'Position 22: Existing SW Version';
COMMENT ON COLUMN rrh_existing_inventory.sfp0_serial_no IS 'Position 23: Existing SFP0 Serial No';
COMMENT ON COLUMN rrh_existing_inventory.sfp1_serial_no IS 'Position 24: Existing SFP1 Serial No';

COMMENT ON COLUMN rrh_replaced_inventory.rfpc_no IS 'Position 25: Replaced RFPC No';
COMMENT ON COLUMN rrh_replaced_inventory.pam0_sl_no IS 'Position 26: Replaced PAM0 SL No';
COMMENT ON COLUMN rrh_replaced_inventory.pam1_sl_no IS 'Position 27: Replaced PAM1 SL No';
COMMENT ON COLUMN rrh_replaced_inventory.pam2_sl_no IS 'Position 28: Replaced PAM2 SL No';
COMMENT ON COLUMN rrh_replaced_inventory.pam3_sl_no IS 'Position 29: Replaced PAM3 SL No';
COMMENT ON COLUMN rrh_replaced_inventory.lna_sl_no IS 'Position 30: Replaced LNA SL No';
COMMENT ON COLUMN rrh_replaced_inventory.sfp0_serial_no IS 'Position 31: Replaced SFP0 Serial No';
COMMENT ON COLUMN rrh_replaced_inventory.sfp1_serial_no IS 'Position 32: Replaced SFP1 Serial No';

-- 5. Inward Sessions & Scans
CREATE TABLE IF NOT EXISTS rrh_inward_sessions (
    id SERIAL PRIMARY KEY,
    work_order_id VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'In Progress',
    duplicate_scan_count INTEGER DEFAULT 0,
    created_by VARCHAR(255),
    created_by_name VARCHAR(255),
    updated_by VARCHAR(255),
    updated_by_name VARCHAR(255),
    deleted_by VARCHAR(255),
    deleted_by_name VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP,
    is_deleted BOOLEAN DEFAULT false,
    side VARCHAR(50)
);

CREATE INDEX IF NOT EXISTS idx_rrh_inward_sessions_wo_id ON rrh_inward_sessions(work_order_id);
CREATE INDEX IF NOT EXISTS idx_rrh_inward_sessions_status ON rrh_inward_sessions(status);
CREATE INDEX IF NOT EXISTS idx_rrh_inward_sessions_active ON rrh_inward_sessions(work_order_id, status) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_inward_sessions_wo_side ON rrh_inward_sessions(work_order_id, side) WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS rrh_inward_scans (
    id SERIAL PRIMARY KEY,
    rrh_inward_session_id INTEGER REFERENCES rrh_inward_sessions(id),
    work_order_id VARCHAR(255) NOT NULL,
    serial_number VARCHAR(255) NOT NULL,
    original_serial_number VARCHAR(255),
    corrected_serial_number VARCHAR(255),
    physical_tpn VARCHAR(255),
    band_serial_no VARCHAR(255),
    matched_inventory_id INTEGER REFERENCES rrh_inventory(id) ON DELETE SET NULL,
    status VARCHAR(50) DEFAULT 'PASS',
    remark TEXT,
    repair_remark TEXT,
    repair_time TIMESTAMP,
    repaired_by VARCHAR(255),
    scanned_by VARCHAR(255),
    scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    sl_no VARCHAR(255),
    is_deleted BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_inward_scans_session_id ON rrh_inward_scans(rrh_inward_session_id);
CREATE INDEX IF NOT EXISTS idx_rrh_inward_scans_wo_id ON rrh_inward_scans(work_order_id);
CREATE INDEX IF NOT EXISTS idx_inward_scans_serial ON rrh_inward_scans(serial_number);
CREATE INDEX IF NOT EXISTS idx_inward_scans_sl_no ON rrh_inward_scans(sl_no);
CREATE INDEX IF NOT EXISTS idx_rrh_inward_scans_status ON rrh_inward_scans(status) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_inward_scans_matched_inventory ON rrh_inward_scans(matched_inventory_id) WHERE matched_inventory_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS rrh_inward_session_master_consumption (
    id SERIAL PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES rrh_inward_sessions(id) ON DELETE CASCADE,
    inventory_id INTEGER NOT NULL REFERENCES rrh_inventory(id) ON DELETE CASCADE,
    scan_id INTEGER REFERENCES rrh_inward_scans(id) ON DELETE SET NULL,
    consumed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_session_inventory UNIQUE (session_id, inventory_id)
);

CREATE INDEX IF NOT EXISTS idx_inward_consumption_session_id ON rrh_inward_session_master_consumption(session_id);
CREATE INDEX IF NOT EXISTS idx_inward_consumption_inventory_id ON rrh_inward_session_master_consumption(inventory_id);
CREATE INDEX IF NOT EXISTS idx_inward_consumption_scan_id ON rrh_inward_session_master_consumption(scan_id);

-- 6. Initial Visual Inspection (IVI)
CREATE TABLE IF NOT EXISTS rrh_ivi_sessions (
    id SERIAL PRIMARY KEY,
    work_order_id VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'In Progress',
    created_by VARCHAR(255),
    created_by_name VARCHAR(255),
    updated_by VARCHAR(255),
    updated_by_name VARCHAR(255),
    deleted_by VARCHAR(255),
    deleted_by_name VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP,
    is_deleted BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_rrh_ivi_sessions_wo ON rrh_ivi_sessions(work_order_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ivi_sessions_status ON rrh_ivi_sessions(status);

CREATE TABLE IF NOT EXISTS rrh_ivi_inspections (
    id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES rrh_ivi_sessions(id) ON DELETE CASCADE,
    work_order_id VARCHAR(255) NOT NULL,
    serial_number VARCHAR(255) NOT NULL,
    tejas_dc_no VARCHAR(255),
    tejas_obd_no VARCHAR(255),
    bat_lot_no VARCHAR(255),
    physical_tpn VARCHAR(255),
    band VARCHAR(255),
    wo_date VARCHAR(255),
    duplexer_main VARCHAR(255) NOT NULL,
    duplexer_part_no VARCHAR(255) NOT NULL,
    rrh_unit VARCHAR(255),
    image_urls JSONB DEFAULT '[]'::jsonb,
    status VARCHAR(50) NOT NULL DEFAULT 'PASS',
    remarks TEXT,
    scanned_by VARCHAR(255),
    scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    inward_scan_id INTEGER REFERENCES rrh_inward_scans(id) ON DELETE SET NULL,
    band_serial_no VARCHAR(255),
    sl_no VARCHAR(255),
    defect_fixed TEXT,
    checkpoints JSONB,
    is_reinspected BOOLEAN DEFAULT false,
    is_deleted BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_rrh_ivi_inspections_session ON rrh_ivi_inspections(session_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ivi_inspections_wo ON rrh_ivi_inspections(work_order_id);
CREATE INDEX IF NOT EXISTS idx_rrh_ivi_inspections_serial ON rrh_ivi_inspections(serial_number);
CREATE INDEX IF NOT EXISTS idx_rrh_ivi_inspections_band_serial ON rrh_ivi_inspections(band_serial_no);
CREATE INDEX IF NOT EXISTS idx_rrh_ivi_inspections_inward_scan_id ON rrh_ivi_inspections(inward_scan_id);
CREATE INDEX IF NOT EXISTS idx_ivi_inspections_sl_no ON rrh_ivi_inspections(sl_no);
