-- Comprehensive Schema for RRH (Remote Radio Head) Master Data Module

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

ALTER TABLE rrh_work_orders
DROP CONSTRAINT IF EXISTS fk_active_import;

ALTER TABLE rrh_work_orders
ADD CONSTRAINT fk_active_import
FOREIGN KEY (active_import_id)
REFERENCES rrh_excel_imports(id) ON DELETE SET NULL;

-- 3. Raw Structural Tables
CREATE TABLE IF NOT EXISTS rrh_excel_sheets (
    id SERIAL PRIMARY KEY,
    import_id INTEGER REFERENCES rrh_excel_imports(id) ON DELETE CASCADE,
    sheet_name VARCHAR(255) NOT NULL,
    sheet_index INTEGER,
    total_rows INTEGER,
    total_columns INTEGER
);

CREATE TABLE IF NOT EXISTS rrh_excel_rows (
    id SERIAL PRIMARY KEY,
    sheet_id INTEGER REFERENCES rrh_excel_sheets(id) ON DELETE CASCADE,
    row_number INTEGER NOT NULL,
    row_type VARCHAR(50) -- HEADER, SUB_HEADER, DATA, BLANK
);

CREATE TABLE IF NOT EXISTS rrh_excel_cells (
    id SERIAL PRIMARY KEY,
    row_id INTEGER REFERENCES rrh_excel_rows(id) ON DELETE CASCADE,
    column_number INTEGER NOT NULL,
    column_letter VARCHAR(10),
    raw_value TEXT,
    display_value TEXT,
    data_type VARCHAR(50)
);

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

-- 4. Normalized Business Tables
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
