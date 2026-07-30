-- Migration: Create BOM Split History and Audit Log Tables

CREATE TABLE IF NOT EXISTS bom_history (
    id SERIAL PRIMARY KEY,
    version VARCHAR(50) NOT NULL,
    original_file_name VARCHAR(255) NOT NULL,
    stored_original_file_name VARCHAR(255) NOT NULL,
    original_file_path VARCHAR(500) NOT NULL,
    processed_file_name VARCHAR(255) NOT NULL,
    processed_file_path VARCHAR(500) NOT NULL,
    file_size BIGINT NOT NULL,
    compressed_file_size BIGINT NOT NULL,
    uploaded_by_id VARCHAR(100) NOT NULL,
    uploaded_by_name VARCHAR(255) NOT NULL,
    uploaded_by_role VARCHAR(100) NOT NULL,
    upload_date DATE NOT NULL DEFAULT CURRENT_DATE,
    upload_time TIME NOT NULL DEFAULT CURRENT_TIME,
    workbook_status VARCHAR(100) NOT NULL,
    parse_status VARCHAR(50) NOT NULL,
    processing_duration INTEGER NOT NULL DEFAULT 0,
    original_rows INTEGER NOT NULL DEFAULT 0,
    processed_rows INTEGER NOT NULL DEFAULT 0,
    duplicate_rows_removed INTEGER NOT NULL DEFAULT 0,
    remarks TEXT,
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMP,
    deleted_by VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS bom_split_audit_logs (
    id SERIAL PRIMARY KEY,
    bom_history_id INTEGER REFERENCES bom_history(id) ON DELETE SET NULL,
    version VARCHAR(50) NOT NULL,
    action VARCHAR(50) NOT NULL, -- UPLOAD, PARSE, REUPLOAD, DOWNLOAD, RESET, HISTORY_ACCESS, DELETE
    employee_id VARCHAR(100) NOT NULL,
    employee_name VARCHAR(255) NOT NULL,
    employee_role VARCHAR(100) NOT NULL,
    log_date DATE NOT NULL DEFAULT CURRENT_DATE,
    log_time TIME NOT NULL DEFAULT CURRENT_TIME,
    status VARCHAR(50) NOT NULL, -- SUCCESS, FAILED
    processing_duration INTEGER NOT NULL DEFAULT 0,
    ip_address VARCHAR(100),
    file_name VARCHAR(255),
    file_size BIGINT,
    remarks TEXT
);

-- Indexing for search, filter, pagination performance
CREATE INDEX IF NOT EXISTS idx_bom_history_filename ON bom_history(original_file_name) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_bom_history_version ON bom_history(version) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_bom_history_uploaded_by ON bom_history(uploaded_by_name) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_bom_history_date ON bom_history(upload_date) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_bom_history_parse_status ON bom_history(parse_status) WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_bom_split_audit_history_id ON bom_split_audit_logs(bom_history_id);
CREATE INDEX IF NOT EXISTS idx_bom_split_audit_date ON bom_split_audit_logs(log_date);
