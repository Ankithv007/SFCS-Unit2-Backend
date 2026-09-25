-- Migration: 009_create_rrh_inward_tables.sql
-- Purpose: Create RRH INWARD session and scan tables.

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
    is_deleted BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS rrh_inward_scans (
    id SERIAL PRIMARY KEY,
    rrh_inward_session_id INTEGER REFERENCES rrh_inward_sessions(id),
    work_order_id VARCHAR(255) NOT NULL,
    serial_number VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'PASS',
    scanned_by VARCHAR(255),
    scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN DEFAULT false
);
