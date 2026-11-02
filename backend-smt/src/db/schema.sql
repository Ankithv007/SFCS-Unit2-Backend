-- SMT Work Orders Table
CREATE TABLE IF NOT EXISTS smt_work_orders (
    id VARCHAR(255) PRIMARY KEY,
    area_id VARCHAR(255) NOT NULL,
    line_id VARCHAR(255) NOT NULL,
    priority VARCHAR(50) NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    product_description TEXT,
    quantity INTEGER NOT NULL,
    panel_quantity INTEGER NOT NULL,
    sides VARCHAR(30) NOT NULL,
    status VARCHAR(50) DEFAULT 'Created',
    barcode_source VARCHAR(100) DEFAULT 'Generate Barcode',
    is_registered BOOLEAN DEFAULT false,
    created_by VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    po_document_name VARCHAR(255),
    po_document_path VARCHAR(500),
    po_document_type VARCHAR(100),
    uploaded_at TIMESTAMP,
    po_id VARCHAR(255),
    remark TEXT,
    customer_name VARCHAR(255),
    model_name VARCHAR(255),
    selected_stages JSONB DEFAULT '["PTH", "VI", "QA", "Flashing", "PCBA-FCT", "Assembly", "Unit Testing", "QI"]'::jsonb
);

-- SMT Serial Numbers Table
CREATE TABLE IF NOT EXISTS smt_serial_numbers (
    id SERIAL PRIMARY KEY,
    work_order_id VARCHAR(255) REFERENCES smt_work_orders(id) ON DELETE CASCADE,
    serial_format VARCHAR(50) NOT NULL,
    serial_number VARCHAR(255) UNIQUE NOT NULL,
    status VARCHAR(50) DEFAULT 'Created',
    created_by VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- SMT Inspections Table (For detail tracking of process steps)
CREATE TABLE IF NOT EXISTS smt_inspections (
    id SERIAL PRIMARY KEY,
    serial_id INTEGER REFERENCES smt_serial_numbers(id) ON DELETE CASCADE,
    process_step VARCHAR(100) NOT NULL, -- Post AOI, Rework, etc.
    scanned_by VARCHAR(255),
    scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) DEFAULT 'PASS' CHECK (status IN ('PASS', 'FAIL', 'PENDING')),
    rework_reason TEXT
);

-- SMT Process Setups Table (For persistent station entries like Printing, etc.)
CREATE TABLE IF NOT EXISTS smt_process_setups (
    id SERIAL PRIMARY KEY,
    work_order_id VARCHAR(255) REFERENCES smt_work_orders(id) ON DELETE CASCADE,
    process_name VARCHAR(100) NOT NULL,
    product_name VARCHAR(255),
    quantity INTEGER,
    stencil_name VARCHAR(255),
    squeegee_number VARCHAR(255),
    solder_paste VARCHAR(255),
    side VARCHAR(20),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- SMT Printing Employees Table
CREATE TABLE IF NOT EXISTS smt_printing_employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    user_id VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- QMS Tables
CREATE TABLE IF NOT EXISTS qms_master (
    id SERIAL PRIMARY KEY,
    work_order_number VARCHAR(255) NOT NULL UNIQUE,
    po_number VARCHAR(255),
    product_name VARCHAR(255),
    product_description TEXT,
    quantity INTEGER,
    warehouse_remarks TEXT,
    qms_remarks TEXT,
    
    bom_file_path VARCHAR(500),
    pfc_file_path VARCHAR(500),
    xy_data_file_path VARCHAR(500),
    ecn_file_path VARCHAR(500),
    assembly_drawing_file_path VARCHAR(500),
    
    files_metadata JSONB DEFAULT '{}'::jsonb,
    
    current_bom_revision VARCHAR(50) DEFAULT '1',
    created_by VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    is_deleted BOOLEAN DEFAULT false,
    deleted_at TIMESTAMP,
    deleted_by VARCHAR(255),
    
    status VARCHAR(50) DEFAULT 'Active'
);

CREATE TABLE IF NOT EXISTS qms_bom_revisions (
    id SERIAL PRIMARY KEY,
    qms_id INTEGER REFERENCES qms_master(id) ON DELETE CASCADE,
    revision_number VARCHAR(50) NOT NULL,
    bom_file_path VARCHAR(500) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    original_size BIGINT NOT NULL,
    compressed_size BIGINT NOT NULL,
    compression_ratio NUMERIC(5,2) NOT NULL,
    file_hash VARCHAR(64) NOT NULL,
    compressed_file_hash VARCHAR(64) NOT NULL,
    uploaded_by VARCHAR(255),
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    remarks TEXT
);

CREATE TABLE IF NOT EXISTS qms_file_revisions (
    id SERIAL PRIMARY KEY,
    qms_id INTEGER REFERENCES qms_master(id) ON DELETE CASCADE,
    file_type VARCHAR(50) NOT NULL,
    previous_revision VARCHAR(50),
    new_revision VARCHAR(50) NOT NULL,
    uploaded_by VARCHAR(255) NOT NULL,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    remarks TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS qms_activity_logs (
    id SERIAL PRIMARY KEY,
    qms_id INTEGER REFERENCES qms_master(id) ON DELETE SET NULL,
    work_order_number VARCHAR(255),
    action VARCHAR(255) NOT NULL,
    details TEXT,
    performed_by VARCHAR(255),
    ip_address VARCHAR(100),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_qms_workorder ON qms_master(work_order_number) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_qms_revision ON qms_bom_revisions(qms_id);
CREATE INDEX IF NOT EXISTS idx_qms_file_revisions_qms_id ON qms_file_revisions(qms_id);
CREATE INDEX IF NOT EXISTS idx_qms_logs ON qms_activity_logs(qms_id);

-- Stencil Master Records Table
CREATE TABLE IF NOT EXISTS stencil_master (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stencil_id VARCHAR(50) UNIQUE NOT NULL,
    stencil_name VARCHAR(255) NOT NULL,
    job_number VARCHAR(100) NOT NULL,
    revision VARCHAR(50) NOT NULL,
    thickness_mills VARCHAR(50) NOT NULL,
    manufacturing_date DATE NOT NULL,
    side VARCHAR(20) NOT NULL CHECK (side IN ('TOP', 'BOTTOM', 'TOP / BOTTOM')),
    storage_location VARCHAR(100) NULL,
    remarks TEXT NULL,
    status VARCHAR(20) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'SCRAPPED')),
    target_life_cycle INTEGER NOT NULL DEFAULT 60000,
    
    -- Lifecycle Tracking
    print_count INTEGER DEFAULT 0,
    cleaning_count INTEGER DEFAULT 0,
    inspection_count INTEGER DEFAULT 0,
    
    created_by VARCHAR(255),
    created_by_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(255) NULL,
    updated_by_name VARCHAR(255) NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_by VARCHAR(255) NULL,
    deleted_at TIMESTAMP NULL
);

-- Stencil Lifecycle Table
CREATE TABLE IF NOT EXISTS smt_stencil_lifecycle (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stencil_record_id UUID NOT NULL REFERENCES stencil_master(id) ON DELETE RESTRICT,
    stencil_id VARCHAR(50) NOT NULL,
    stencil_name VARCHAR(255) NOT NULL,
    work_order_id VARCHAR(255) NOT NULL REFERENCES smt_work_orders(id) ON DELETE RESTRICT,
    work_order_number VARCHAR(255) NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    product_description TEXT,
    sides VARCHAR(30) NOT NULL,
    quantity INTEGER NOT NULL,
    target_life_cycle INTEGER NOT NULL DEFAULT 60000,
    qty_life_cycle INTEGER NOT NULL,
    balance_life_cycle INTEGER NOT NULL,
    current_used_life_cycle INTEGER NOT NULL,
    status VARCHAR(50) NOT NULL, -- Available, Running, Completed, Expired
    remarks TEXT,
    
    created_by VARCHAR(255) NOT NULL,
    created_by_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(255) NULL,
    updated_by_name VARCHAR(255) NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_by VARCHAR(255) NULL,
    deleted_by_name VARCHAR(255) NULL,
    deleted_at TIMESTAMP NULL
);

-- Unique Index to prevent duplicate assignments (updated for double-sided support)
CREATE UNIQUE INDEX IF NOT EXISTS idx_lifecycle_wo_sides ON smt_stencil_lifecycle(work_order_id, sides) WHERE is_deleted = false;


