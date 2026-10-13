-- Migration: 015_create_rrh_programming_tables.sql
-- Description: Create high-performance enterprise tables, constraints, and indexes for RRH Programming module

-- 1. RRH Programming Sessions
CREATE TABLE IF NOT EXISTS rrh_programming_sessions (
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

CREATE INDEX IF NOT EXISTS idx_rrh_prog_sessions_wo ON rrh_programming_sessions(work_order_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_prog_sessions_status ON rrh_programming_sessions(status) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_prog_sessions_created ON rrh_programming_sessions(created_at DESC);

-- 2. RRH Programming Inspections
CREATE TABLE IF NOT EXISTS rrh_programming_inspections (
    id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES rrh_programming_sessions(id) ON DELETE CASCADE,
    work_order_id VARCHAR(255) NOT NULL,
    serial_number VARCHAR(255) NOT NULL,
    band_serial_no VARCHAR(255),
    physical_serial_number VARCHAR(255),
    physical_tpn VARCHAR(255),
    band VARCHAR(255),
    inspection_date DATE DEFAULT CURRENT_DATE,
    e_label VARCHAR(255),
    pam_tpn VARCHAR(255),
    pam1 VARCHAR(255),
    pam2 VARCHAR(255),
    pam3 VARCHAR(255),
    pam4 VARCHAR(255),
    rfpc_tpn VARCHAR(255),
    rfpc_sl_no VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'COMPLETED',
    remarks TEXT,
    scanned_by VARCHAR(255),
    scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ipqc_inspection_id INTEGER REFERENCES rrh_ipqc_inspections(id) ON DELETE SET NULL,
    ivi_inspection_id INTEGER REFERENCES rrh_ivi_inspections(id) ON DELETE SET NULL,
    checkpoints JSONB DEFAULT '[]'::jsonb,
    is_reinspected BOOLEAN DEFAULT false,
    defect_fixed TEXT,
    sl_no VARCHAR(255),
    is_deleted BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_rrh_prog_inspections_session ON rrh_programming_inspections(session_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_prog_inspections_serial ON rrh_programming_inspections(serial_number) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_prog_inspections_band_serial ON rrh_programming_inspections(band_serial_no) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_prog_inspections_wo ON rrh_programming_inspections(work_order_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_prog_inspections_ipqc_id ON rrh_programming_inspections(ipqc_inspection_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_prog_inspections_status ON rrh_programming_inspections(status);
CREATE INDEX IF NOT EXISTS idx_rrh_prog_inspections_scanned ON rrh_programming_inspections(session_id, scanned_at DESC);

-- Composite fast-lookup index
CREATE INDEX IF NOT EXISTS idx_rrh_prog_lookup ON rrh_programming_inspections(work_order_id, UPPER(TRIM(serial_number)), is_deleted);
