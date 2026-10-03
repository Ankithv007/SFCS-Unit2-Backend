-- Migration: 003_create_rrh_ivi_tables.sql
-- Description: Create sessions and inspection tables for RRH IVI (Initial Visual Inspection)

-- 1. RRH IVI Sessions Table
CREATE TABLE IF NOT EXISTS rrh_ivi_sessions (
    id SERIAL PRIMARY KEY,
    work_order_id VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'In Progress', -- In Progress, Completed, Paused, Cancelled, Aborted
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

-- 2. RRH IVI Inspections Table
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
    status VARCHAR(50) NOT NULL DEFAULT 'PASS', -- PASS or FAIL
    remarks TEXT,
    scanned_by VARCHAR(255),
    scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN DEFAULT false
);

-- 3. Indexes for fast query and search performance
CREATE INDEX IF NOT EXISTS idx_rrh_ivi_sessions_wo ON rrh_ivi_sessions(work_order_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ivi_sessions_status ON rrh_ivi_sessions(status);
CREATE INDEX IF NOT EXISTS idx_rrh_ivi_inspections_session ON rrh_ivi_inspections(session_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_ivi_inspections_serial ON rrh_ivi_inspections(serial_number);
CREATE INDEX IF NOT EXISTS idx_rrh_ivi_inspections_wo ON rrh_ivi_inspections(work_order_id);
