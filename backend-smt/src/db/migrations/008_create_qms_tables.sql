-- Create QMS Master, BOM Revisions, and Activity Logs tables

CREATE TABLE IF NOT EXISTS qms_master (
    id SERIAL PRIMARY KEY,
    work_order_number VARCHAR(255) NOT NULL UNIQUE,
    po_number VARCHAR(255),
    product_name VARCHAR(255),
    product_description TEXT,
    quantity INTEGER,
    warehouse_remarks TEXT,
    
    -- Current active files paths
    bom_file_path VARCHAR(500),
    pfc_file_path VARCHAR(500),
    xy_data_file_path VARCHAR(500),
    ecn_file_path VARCHAR(500),
    assembly_drawing_file_path VARCHAR(500),
    
    -- Current file metadata (names, types, sizes, ratios, SHA256 hashes)
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
CREATE INDEX IF NOT EXISTS idx_qms_logs ON qms_activity_logs(qms_id);
