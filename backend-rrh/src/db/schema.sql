-- ============================================================================
-- Enterprise Production Schema for RRH (Remote Radio Head) Microservice
-- Modules: Work Orders, Excel Ingestion, Inventory, Inward, IVI, IPQC
-- Architecture: High-Throughput OLTP, Zero Write-Bloat, Full ACID Integrity
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Shared Functions & Pre-requisite Sync
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_timestamp_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sync_work_order_dates()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.work_order_date IS NOT NULL AND NEW.date IS NULL THEN
        NEW.date = NEW.work_order_date;
    ELSIF NEW.date IS NOT NULL AND NEW.work_order_date IS NULL THEN
        NEW.work_order_date = NEW.date;
    ELSIF NEW.work_order_date IS NOT NULL THEN
        NEW.date = NEW.work_order_date;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 2. RRH Work Orders
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rrh_work_orders (
    id SERIAL PRIMARY KEY,
    work_order_id VARCHAR(100) UNIQUE NOT NULL,
    work_order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    date DATE,
    lot_quantity INT NOT NULL CHECK (lot_quantity > 0),
    status VARCHAR(50) NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'CLOSED')),
    active_import_id INTEGER,
    excel_filename VARCHAR(255),
    excel_file_path VARCHAR(500),
    excel_file_size BIGINT,
    excel_columns JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(excel_columns) = 'array'),
    excel_data JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(excel_data) = 'array'),
    total_excel_rows INT NOT NULL DEFAULT 0,
    created_by VARCHAR(100),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    deleted_at TIMESTAMP,
    deleted_by VARCHAR(100)
);

DO $$
BEGIN
    ALTER TABLE rrh_work_orders ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE rrh_work_orders ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
    ALTER TABLE rrh_work_orders ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(100);
END $$;

CREATE INDEX IF NOT EXISTS idx_rrh_work_orders_date ON rrh_work_orders(work_order_date);
CREATE INDEX IF NOT EXISTS idx_rrh_work_orders_status ON rrh_work_orders(status);
CREATE INDEX IF NOT EXISTS idx_rrh_work_orders_wo_ci ON rrh_work_orders(UPPER(TRIM(work_order_id))) WHERE is_deleted = false;

-- ----------------------------------------------------------------------------
-- 3. RRH Excel Imports & Raw Structural Tables
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rrh_excel_imports (
    id SERIAL PRIMARY KEY,
    work_order_id INTEGER NOT NULL REFERENCES rrh_work_orders(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
    original_filename VARCHAR(255) NOT NULL,
    stored_filename VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL,
    file_hash VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'REJECTED', 'SUPERSEDED')),
    confirmed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    deleted_at TIMESTAMP
);

DO $$
BEGIN
    ALTER TABLE rrh_excel_imports ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE rrh_excel_imports ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
END $$;

CREATE INDEX IF NOT EXISTS idx_rrh_excel_imports_wo ON rrh_excel_imports(work_order_id);

CREATE TABLE IF NOT EXISTS rrh_excel_sheets (
    id SERIAL PRIMARY KEY,
    import_id INTEGER NOT NULL REFERENCES rrh_excel_imports(id) ON DELETE CASCADE,
    sheet_name VARCHAR(255) NOT NULL,
    sheet_index INTEGER,
    total_rows INTEGER,
    total_columns INTEGER
);

CREATE INDEX IF NOT EXISTS idx_rrh_excel_sheets_import ON rrh_excel_sheets(import_id);

CREATE TABLE IF NOT EXISTS rrh_excel_rows (
    id SERIAL PRIMARY KEY,
    sheet_id INTEGER NOT NULL REFERENCES rrh_excel_sheets(id) ON DELETE CASCADE,
    row_number INTEGER NOT NULL,
    row_type VARCHAR(50) -- HEADER, SUB_HEADER, DATA, BLANK
);

CREATE INDEX IF NOT EXISTS idx_rrh_excel_rows_sheet_num ON rrh_excel_rows(sheet_id, row_number);

CREATE TABLE IF NOT EXISTS rrh_excel_cells (
    id SERIAL PRIMARY KEY,
    row_id INTEGER NOT NULL REFERENCES rrh_excel_rows(id) ON DELETE CASCADE,
    column_number INTEGER NOT NULL,
    column_letter VARCHAR(10),
    raw_value TEXT,
    display_value TEXT,
    data_type VARCHAR(50)
);

CREATE INDEX IF NOT EXISTS idx_rrh_excel_cells_row_col ON rrh_excel_cells(row_id, column_number);

CREATE TABLE IF NOT EXISTS rrh_excel_merged_cells (
    id SERIAL PRIMARY KEY,
    sheet_id INTEGER NOT NULL REFERENCES rrh_excel_sheets(id) ON DELETE CASCADE,
    range_reference VARCHAR(50) NOT NULL,
    start_row INTEGER NOT NULL,
    start_column INTEGER NOT NULL,
    end_row INTEGER NOT NULL,
    end_column INTEGER NOT NULL,
    row_span INTEGER,
    column_span INTEGER
);

CREATE INDEX IF NOT EXISTS idx_rrh_excel_merged_cells_sheet ON rrh_excel_merged_cells(sheet_id);

-- ----------------------------------------------------------------------------
-- 4. Normalized Business Inventory Tables
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rrh_inventory (
    id SERIAL PRIMARY KEY,
    import_id INTEGER NOT NULL REFERENCES rrh_excel_imports(id) ON DELETE CASCADE,
    sl_no VARCHAR(100),
    tejas_dc_no VARCHAR(100),
    tejas_obd_no VARCHAR(100),
    physical_tpn VARCHAR(100),
    band_serial_no VARCHAR(100),
    pr_no VARCHAR(100),
    invoice_rma_no VARCHAR(100),
    vendor_name_for_rework VARCHAR(255),
    coordinator_name VARCHAR(100),
    issued_date DATE,
    lot VARCHAR(100),
    remarks TEXT,
    failure_description TEXT,
    remarks_2 TEXT,
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

DO $$
BEGIN
    ALTER TABLE rrh_inventory ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
END $$;

CREATE INDEX IF NOT EXISTS idx_rrh_inventory_import_id ON rrh_inventory(import_id);
CREATE INDEX IF NOT EXISTS idx_rrh_inventory_import_band_ci ON rrh_inventory(import_id, UPPER(TRIM(band_serial_no)));
CREATE INDEX IF NOT EXISTS idx_rrh_inventory_import_sl_ci ON rrh_inventory(import_id, UPPER(TRIM(sl_no)));
CREATE INDEX IF NOT EXISTS idx_rrh_inventory_physical_tpn ON rrh_inventory(physical_tpn);
CREATE INDEX IF NOT EXISTS idx_rrh_inventory_band_serial_ci ON rrh_inventory(UPPER(TRIM(band_serial_no)));
CREATE INDEX IF NOT EXISTS idx_rrh_inventory_sl_no_ci ON rrh_inventory(UPPER(TRIM(sl_no)));
CREATE INDEX IF NOT EXISTS idx_rrh_inventory_lot ON rrh_inventory(lot);
CREATE INDEX IF NOT EXISTS idx_rrh_inventory_tejas_dc ON rrh_inventory(tejas_dc_no);

CREATE TABLE IF NOT EXISTS rrh_existing_inventory (
    id SERIAL PRIMARY KEY,
    inventory_id INTEGER NOT NULL REFERENCES rrh_inventory(id) ON DELETE CASCADE,
    rfpc_no VARCHAR(100),
    pam0_sl_no VARCHAR(100),
    pam1_sl_no VARCHAR(100),
    pam2_sl_no VARCHAR(100),
    pam3_sl_no VARCHAR(100),
    lna_sl_no VARCHAR(100),
    rfpc_model_no VARCHAR(100),
    sw_version VARCHAR(100),
    sfp0_serial_no VARCHAR(100),
    sfp1_serial_no VARCHAR(100)
);

CREATE INDEX IF NOT EXISTS idx_rrh_existing_inv_id ON rrh_existing_inventory(inventory_id);

CREATE TABLE IF NOT EXISTS rrh_replaced_inventory (
    id SERIAL PRIMARY KEY,
    inventory_id INTEGER NOT NULL REFERENCES rrh_inventory(id) ON DELETE CASCADE,
    rfpc_no VARCHAR(100),
    pam0_sl_no VARCHAR(100),
    pam1_sl_no VARCHAR(100),
    pam2_sl_no VARCHAR(100),
    pam3_sl_no VARCHAR(100),
    lna_sl_no VARCHAR(100),
    sfp0_serial_no VARCHAR(100),
    sfp1_serial_no VARCHAR(100)
);

CREATE INDEX IF NOT EXISTS idx_rrh_replaced_inv_id ON rrh_replaced_inventory(inventory_id);

-- ----------------------------------------------------------------------------
-- 5. Inward Session and Scanning
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rrh_inward_sessions (
    id SERIAL PRIMARY KEY,
    work_order_id VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'In Progress' CHECK (status IN ('In Progress', 'Completed', 'Closed', 'CANCELLED')),
    duplicate_scan_count INTEGER NOT NULL DEFAULT 0,
    created_by VARCHAR(100),
    created_by_name VARCHAR(100),
    updated_by VARCHAR(100),
    updated_by_name VARCHAR(100),
    deleted_by VARCHAR(100),
    deleted_by_name VARCHAR(100),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    side VARCHAR(50)
);

CREATE INDEX IF NOT EXISTS idx_rrh_inward_sessions_wo_ci ON rrh_inward_sessions(UPPER(TRIM(work_order_id))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_inward_sessions_status ON rrh_inward_sessions(status);

CREATE TABLE IF NOT EXISTS rrh_inward_scans (
    id SERIAL PRIMARY KEY,
    rrh_inward_session_id INTEGER NOT NULL REFERENCES rrh_inward_sessions(id) ON DELETE CASCADE,
    work_order_id VARCHAR(100) NOT NULL,
    serial_number VARCHAR(100) NOT NULL,
    original_serial_number VARCHAR(100),
    corrected_serial_number VARCHAR(100),
    physical_tpn VARCHAR(100),
    band_serial_no VARCHAR(100),
    matched_inventory_id INTEGER REFERENCES rrh_inventory(id) ON DELETE SET NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PASS' CHECK (status IN ('PASS', 'FAIL')),
    remark TEXT,
    repair_remark TEXT,
    repair_time TIMESTAMP,
    repaired_by VARCHAR(100),
    scanned_by VARCHAR(100),
    scanned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sl_no VARCHAR(100),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

DO $$
BEGIN
    ALTER TABLE rrh_inward_scans ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
END $$;

CREATE INDEX IF NOT EXISTS idx_inward_scans_session_scanned ON rrh_inward_scans(rrh_inward_session_id, scanned_at DESC, id DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_inward_scans_wo_status ON rrh_inward_scans(work_order_id, status) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_inward_scans_wo_serial_active ON rrh_inward_scans(work_order_id, UPPER(TRIM(serial_number))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_inward_scans_wo_band_active ON rrh_inward_scans(work_order_id, UPPER(TRIM(band_serial_no))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_inward_scans_serial_ci ON rrh_inward_scans(UPPER(TRIM(serial_number))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_inward_scans_band_serial_ci ON rrh_inward_scans(UPPER(TRIM(band_serial_no))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_inward_scans_sl_no ON rrh_inward_scans(sl_no);
CREATE INDEX IF NOT EXISTS idx_inward_scans_matched_inv ON rrh_inward_scans(matched_inventory_id);
CREATE INDEX IF NOT EXISTS idx_inward_scans_wo_ci ON rrh_inward_scans(UPPER(TRIM(work_order_id))) WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS rrh_inward_session_master_consumption (
    id SERIAL PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES rrh_inward_sessions(id) ON DELETE CASCADE,
    inventory_id INTEGER NOT NULL REFERENCES rrh_inventory(id) ON DELETE CASCADE,
    scan_id INTEGER REFERENCES rrh_inward_scans(id) ON DELETE SET NULL,
    consumed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_session_inventory UNIQUE (session_id, inventory_id)
);

CREATE INDEX IF NOT EXISTS idx_inward_consumption_inventory_id ON rrh_inward_session_master_consumption(inventory_id);
CREATE INDEX IF NOT EXISTS idx_inward_consumption_scan_id ON rrh_inward_session_master_consumption(scan_id);

-- ----------------------------------------------------------------------------
-- 6. Initial Visual Inspection (IVI)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rrh_ivi_sessions (
    id SERIAL PRIMARY KEY,
    work_order_id VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'In Progress' CHECK (status IN ('In Progress', 'Completed', 'Closed', 'CANCELLED')),
    created_by VARCHAR(100),
    created_by_name VARCHAR(100),
    updated_by VARCHAR(100),
    updated_by_name VARCHAR(100),
    deleted_by VARCHAR(100),
    deleted_by_name VARCHAR(100),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP,
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_rrh_ivi_sessions_wo_ci ON rrh_ivi_sessions(UPPER(TRIM(work_order_id))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ivi_sessions_status ON rrh_ivi_sessions(status);

CREATE TABLE IF NOT EXISTS rrh_ivi_inspections (
    id SERIAL PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES rrh_ivi_sessions(id) ON DELETE CASCADE,
    work_order_id VARCHAR(100) NOT NULL,
    serial_number VARCHAR(100) NOT NULL,
    tejas_dc_no VARCHAR(100),
    tejas_obd_no VARCHAR(100),
    bat_lot_no VARCHAR(100),
    physical_tpn VARCHAR(100),
    band VARCHAR(50),
    wo_date VARCHAR(100),
    duplexer_main VARCHAR(100) NOT NULL,
    duplexer_part_no VARCHAR(100) NOT NULL,
    rrh_unit VARCHAR(100),
    image_urls JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(image_urls) = 'array'),
    status VARCHAR(50) NOT NULL DEFAULT 'PASS' CHECK (status IN ('PASS', 'FAIL')),
    remarks TEXT,
    scanned_by VARCHAR(100),
    scanned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    inward_scan_id INTEGER REFERENCES rrh_inward_scans(id) ON DELETE SET NULL,
    band_serial_no VARCHAR(100),
    sl_no VARCHAR(100),
    defect_fixed TEXT,
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

DO $$
BEGIN
    ALTER TABLE rrh_ivi_inspections ADD COLUMN IF NOT EXISTS sl_no VARCHAR(255);
    ALTER TABLE rrh_ivi_inspections ADD COLUMN IF NOT EXISTS defect_fixed TEXT;
    ALTER TABLE rrh_ivi_inspections ADD COLUMN IF NOT EXISTS checkpoints JSONB DEFAULT '[]'::jsonb;
    ALTER TABLE rrh_ivi_inspections ADD COLUMN IF NOT EXISTS is_reinspected BOOLEAN DEFAULT false;
    ALTER TABLE rrh_ivi_inspections ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
END $$;

CREATE INDEX IF NOT EXISTS idx_rrh_ivi_inspections_session_status_scanned ON rrh_ivi_inspections(session_id, status, scanned_at DESC, id DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ivi_inspections_session_band_ci ON rrh_ivi_inspections(session_id, UPPER(TRIM(COALESCE(band_serial_no, '')))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ivi_inspections_wo_serial_active ON rrh_ivi_inspections(work_order_id, UPPER(TRIM(serial_number))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ivi_inspections_wo_band_active ON rrh_ivi_inspections(work_order_id, UPPER(TRIM(COALESCE(band_serial_no, '')))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ivi_inspections_serial_ci ON rrh_ivi_inspections(UPPER(TRIM(serial_number))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ivi_inspections_band_serial_ci ON rrh_ivi_inspections(UPPER(TRIM(COALESCE(band_serial_no, '')))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ivi_inspections_sl_no ON rrh_ivi_inspections(sl_no);
CREATE INDEX IF NOT EXISTS idx_rrh_ivi_inspections_inward_scan_id ON rrh_ivi_inspections(inward_scan_id);
CREATE INDEX IF NOT EXISTS idx_rrh_ivi_inspections_wo_ci ON rrh_ivi_inspections(UPPER(TRIM(work_order_id))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ivi_image_urls_gin ON rrh_ivi_inspections USING GIN (image_urls);

-- Duplicate-scan guard: exactly one active inspection per serial per session in IVI
DO $$
BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_rrh_ivi_active_serial
        ON rrh_ivi_inspections(session_id, UPPER(TRIM(serial_number)))
        WHERE is_deleted = false;
EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'uq_rrh_ivi_active_serial skipped: duplicate active IVI rows exist, clean them up first';
END $$;

-- ----------------------------------------------------------------------------
-- 7. In-Process Quality Control (IPQC)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rrh_ipqc_sessions (
    id SERIAL PRIMARY KEY,
    work_order_id VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'In Progress' CHECK (status IN ('In Progress', 'Completed', 'Closed', 'CANCELLED')),
    created_by VARCHAR(100),
    created_by_name VARCHAR(100),
    updated_by VARCHAR(100),
    updated_by_name VARCHAR(100),
    deleted_by VARCHAR(100),
    deleted_by_name VARCHAR(100),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP,
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_sessions_wo_ci ON rrh_ipqc_sessions(UPPER(TRIM(work_order_id))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_sessions_status ON rrh_ipqc_sessions(status);

CREATE TABLE IF NOT EXISTS rrh_ipqc_inspections (
    id SERIAL PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES rrh_ipqc_sessions(id) ON DELETE CASCADE,
    work_order_id VARCHAR(100) NOT NULL,
    serial_number VARCHAR(100) NOT NULL,
    band_serial_no VARCHAR(100),
    physical_serial_number VARCHAR(100),
    physical_tpn VARCHAR(100),
    band VARCHAR(50),
    inspection_date DATE NOT NULL DEFAULT CURRENT_DATE,
    e_label VARCHAR(50),
    pam_tpn VARCHAR(100),
    pam1 VARCHAR(100),
    pam2 VARCHAR(100),
    pam3 VARCHAR(100),
    pam4 VARCHAR(100),
    rfpc_tpn VARCHAR(100),
    rfpc_sl_no VARCHAR(100),
    status VARCHAR(50) NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED', 'PASS', 'FAIL')),
    remarks TEXT,
    scanned_by VARCHAR(100),
    scanned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ivi_inspection_id INTEGER REFERENCES rrh_ivi_inspections(id) ON DELETE SET NULL,
    checkpoints JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(checkpoints) = 'array'),
    is_reinspected BOOLEAN NOT NULL DEFAULT false,
    defect_fixed TEXT,
    sl_no VARCHAR(100),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

DO $$
BEGIN
    ALTER TABLE rrh_ipqc_inspections ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
END $$;

CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_inspections_session_status_scanned ON rrh_ipqc_inspections(session_id, status, scanned_at DESC, id DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_inspections_session_band_ci ON rrh_ipqc_inspections(session_id, UPPER(TRIM(COALESCE(band_serial_no, '')))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_inspections_wo_serial_active ON rrh_ipqc_inspections(work_order_id, UPPER(TRIM(serial_number))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_inspections_wo_band_active ON rrh_ipqc_inspections(work_order_id, UPPER(TRIM(COALESCE(band_serial_no, '')))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_inspections_serial_ci ON rrh_ipqc_inspections(UPPER(TRIM(serial_number))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_inspections_band_serial_ci ON rrh_ipqc_inspections(UPPER(TRIM(COALESCE(band_serial_no, '')))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_inspections_phys_serial ON rrh_ipqc_inspections(physical_serial_number);
CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_inspections_sl_no ON rrh_ipqc_inspections(sl_no);
CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_inspections_ivi_id ON rrh_ipqc_inspections(ivi_inspection_id);
CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_inspections_wo_ci ON rrh_ipqc_inspections(UPPER(TRIM(work_order_id))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_checkpoints_gin ON rrh_ipqc_inspections USING GIN (checkpoints);

-- Duplicate-scan guard: exactly one active inspection per serial per session in IPQC
DO $$
BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_rrh_ipqc_active_serial
        ON rrh_ipqc_inspections(session_id, UPPER(TRIM(serial_number)))
        WHERE is_deleted = false;
EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'uq_rrh_ipqc_active_serial skipped: duplicate active IPQC rows exist, clean them up first';
END $$;

-- ----------------------------------------------------------------------------
-- 8. Referential Integrity Constraints (Cross-Module Foreign Keys)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    -- Work order active import circular reference
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_active_import' AND conrelid = 'rrh_work_orders'::regclass) THEN
        ALTER TABLE rrh_work_orders
        ADD CONSTRAINT fk_active_import
        FOREIGN KEY (active_import_id)
        REFERENCES rrh_excel_imports(id) ON DELETE SET NULL;
    END IF;

    -- Session tables -> rrh_work_orders(work_order_id)
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_inward_sessions_wo' AND conrelid = 'rrh_inward_sessions'::regclass) THEN
        ALTER TABLE rrh_inward_sessions
        ADD CONSTRAINT fk_inward_sessions_wo
        FOREIGN KEY (work_order_id)
        REFERENCES rrh_work_orders(work_order_id) ON UPDATE CASCADE ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ivi_sessions_wo' AND conrelid = 'rrh_ivi_sessions'::regclass) THEN
        ALTER TABLE rrh_ivi_sessions
        ADD CONSTRAINT fk_ivi_sessions_wo
        FOREIGN KEY (work_order_id)
        REFERENCES rrh_work_orders(work_order_id) ON UPDATE CASCADE ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ipqc_sessions_wo' AND conrelid = 'rrh_ipqc_sessions'::regclass) THEN
        ALTER TABLE rrh_ipqc_sessions
        ADD CONSTRAINT fk_ipqc_sessions_wo
        FOREIGN KEY (work_order_id)
        REFERENCES rrh_work_orders(work_order_id) ON UPDATE CASCADE ON DELETE RESTRICT;
    END IF;

    -- Scan/Inspection tables -> rrh_work_orders(work_order_id)
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_inward_scans_wo' AND conrelid = 'rrh_inward_scans'::regclass) THEN
        ALTER TABLE rrh_inward_scans
        ADD CONSTRAINT fk_inward_scans_wo
        FOREIGN KEY (work_order_id)
        REFERENCES rrh_work_orders(work_order_id) ON UPDATE CASCADE ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ivi_inspections_wo' AND conrelid = 'rrh_ivi_inspections'::regclass) THEN
        ALTER TABLE rrh_ivi_inspections
        ADD CONSTRAINT fk_ivi_inspections_wo
        FOREIGN KEY (work_order_id)
        REFERENCES rrh_work_orders(work_order_id) ON UPDATE CASCADE ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ipqc_inspections_wo' AND conrelid = 'rrh_ipqc_inspections'::regclass) THEN
        ALTER TABLE rrh_ipqc_inspections
        ADD CONSTRAINT fk_ipqc_inspections_wo
        FOREIGN KEY (work_order_id)
        REFERENCES rrh_work_orders(work_order_id) ON UPDATE CASCADE ON DELETE RESTRICT;
    END IF;

    -- Inspection stage chaining foreign keys
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ivi_inspections_inward_scan' AND conrelid = 'rrh_ivi_inspections'::regclass) THEN
        ALTER TABLE rrh_ivi_inspections
        ADD CONSTRAINT fk_ivi_inspections_inward_scan
        FOREIGN KEY (inward_scan_id)
        REFERENCES rrh_inward_scans(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ipqc_inspections_ivi' AND conrelid = 'rrh_ipqc_inspections'::regclass) THEN
        ALTER TABLE rrh_ipqc_inspections
        ADD CONSTRAINT fk_ipqc_inspections_ivi
        FOREIGN KEY (ivi_inspection_id)
        REFERENCES rrh_ivi_inspections(id) ON DELETE SET NULL;
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 9. Automatic Updated_At & Date Triggers
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    -- Parent Tables
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_rrh_work_orders_updated_at') THEN
        CREATE TRIGGER trg_rrh_work_orders_updated_at
        BEFORE UPDATE ON rrh_work_orders
        FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_rrh_work_orders_sync_dates') THEN
        CREATE TRIGGER trg_rrh_work_orders_sync_dates
        BEFORE INSERT OR UPDATE ON rrh_work_orders
        FOR EACH ROW EXECUTE FUNCTION sync_work_order_dates();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_rrh_inward_sessions_updated_at') THEN
        CREATE TRIGGER trg_rrh_inward_sessions_updated_at
        BEFORE UPDATE ON rrh_inward_sessions
        FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_rrh_ivi_sessions_updated_at') THEN
        CREATE TRIGGER trg_rrh_ivi_sessions_updated_at
        BEFORE UPDATE ON rrh_ivi_sessions
        FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_rrh_ipqc_sessions_updated_at') THEN
        CREATE TRIGGER trg_rrh_ipqc_sessions_updated_at
        BEFORE UPDATE ON rrh_ipqc_sessions
        FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();
    END IF;

    -- Child Scan & Inspection Tables
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_rrh_inward_scans_updated_at') THEN
        CREATE TRIGGER trg_rrh_inward_scans_updated_at
        BEFORE UPDATE ON rrh_inward_scans
        FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_rrh_ivi_inspections_updated_at') THEN
        CREATE TRIGGER trg_rrh_ivi_inspections_updated_at
        BEFORE UPDATE ON rrh_ivi_inspections
        FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_rrh_ipqc_inspections_updated_at') THEN
        CREATE TRIGGER trg_rrh_ipqc_inspections_updated_at
        BEFORE UPDATE ON rrh_ipqc_inspections
        FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();
    END IF;
END $$;
