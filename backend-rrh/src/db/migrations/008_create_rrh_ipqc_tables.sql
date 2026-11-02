-- Migration: 008_create_rrh_ipqc_tables.sql
-- Description: Create enterprise tables, constraints, and indexes for RRH In-Process Quality Control (IPQC) module

-- 1. RRH IPQC Sessions
CREATE TABLE IF NOT EXISTS rrh_ipqc_sessions (
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

CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_sessions_wo ON rrh_ipqc_sessions(work_order_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_sessions_status ON rrh_ipqc_sessions(status);

-- 2. RRH IPQC Inspections
CREATE TABLE IF NOT EXISTS rrh_ipqc_inspections (
    id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES rrh_ipqc_sessions(id) ON DELETE CASCADE,
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
    ivi_inspection_id INTEGER REFERENCES rrh_ivi_inspections(id) ON DELETE SET NULL,
    checkpoints JSONB DEFAULT '[]'::jsonb,
    is_reinspected BOOLEAN DEFAULT false,
    defect_fixed TEXT,
    is_deleted BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_inspections_session ON rrh_ipqc_inspections(session_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_inspections_serial ON rrh_ipqc_inspections(serial_number);
CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_inspections_band_serial ON rrh_ipqc_inspections(band_serial_no);
CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_inspections_wo ON rrh_ipqc_inspections(work_order_id);
CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_inspections_ivi_id ON rrh_ipqc_inspections(ivi_inspection_id);
CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_inspections_status ON rrh_ipqc_inspections(status);
