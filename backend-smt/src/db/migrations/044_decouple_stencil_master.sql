-- Migration: 044_decouple_stencil_master.sql
-- Purpose: Remove all dependencies on stencil_master, establishing Stencil Rack locations as the master store of all stencil details.

-- 1. Drop existing tables that depend on stencil_master
DROP TABLE IF EXISTS stencil_rack_movement_history CASCADE;
DROP TABLE IF EXISTS stencil_rack_locations CASCADE;

-- 2. Create the new independent stencil_rack_locations table
CREATE TABLE stencil_rack_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rack_id UUID REFERENCES stencil_racks(id) ON DELETE CASCADE,
    row_number INTEGER NOT NULL,
    column_number INTEGER NOT NULL,
    location_code VARCHAR(100) UNIQUE NOT NULL,
    status VARCHAR(50) DEFAULT 'EMPTY' CHECK (status IN ('EMPTY', 'STORED', 'CHECKED_OUT')),
    job_number VARCHAR(100),
    stencil_name VARCHAR(255),
    revision VARCHAR(50),
    thickness_mills NUMERIC(5,2),
    manufacturing_date DATE,
    side VARCHAR(50) CHECK (side IN ('TOP', 'BOTTOM', 'TOP/BOTTOM')),
    remarks TEXT,
    checked_out_by_code VARCHAR(100),
    checked_out_by_name VARCHAR(255),
    checked_out_by_dept VARCHAR(255),
    checked_out_by_role VARCHAR(255),
    checked_out_at TIMESTAMP,
    created_by VARCHAR(255),
    created_by_name VARCHAR(255),
    updated_by VARCHAR(255),
    updated_by_name VARCHAR(255),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_job_number_not_null CHECK (status = 'EMPTY' OR (job_number IS NOT NULL))
);

-- Index for fast rack_id lookups
CREATE INDEX idx_stencil_rack_locations_rack ON stencil_rack_locations(rack_id);

-- Unique index to prevent duplicate active job numbers (one stencil can only occupy one slot at a time)
CREATE UNIQUE INDEX idx_unique_active_job_number 
ON stencil_rack_locations(job_number) 
WHERE job_number IS NOT NULL AND status <> 'EMPTY';

-- 3. Create the new independent stencil_rack_movement_history table
CREATE TABLE stencil_rack_movement_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_number VARCHAR(100) NOT NULL,
    stencil_name VARCHAR(255),
    revision VARCHAR(50),
    thickness_mills NUMERIC(5,2),
    manufacturing_date DATE,
    side VARCHAR(50) CHECK (side IN ('TOP', 'BOTTOM', 'TOP/BOTTOM')),
    action VARCHAR(100) NOT NULL, -- CREATED, ASSIGNED, RECEIVED, RETURNED, RELOCATED, UPDATED, MAINTENANCE, INSPECTION
    previous_status VARCHAR(50),
    current_status VARCHAR(50),
    employee_code VARCHAR(100) NOT NULL,
    employee_name VARCHAR(255) NOT NULL,
    department VARCHAR(255),
    role VARCHAR(255),
    machine VARCHAR(100),
    production_line VARCHAR(100),
    rack_id UUID,
    row_number INTEGER,
    column_number INTEGER,
    location_code VARCHAR(100),
    from_rack_id UUID,
    from_row INTEGER,
    from_col INTEGER,
    to_rack_id UUID,
    to_row INTEGER,
    to_col INTEGER,
    remarks TEXT,
    reason TEXT,
    condition VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Index for fast movement timeline lookup by job number
CREATE INDEX idx_stencil_rack_mv_hist_job ON stencil_rack_movement_history(job_number);
