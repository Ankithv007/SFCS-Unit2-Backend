-- Migration: 043_create_stencil_rack_management.sql
-- Purpose: Create tables for physical stencil racks, storage location mapping, movement history, and enhance stencil_master table.

-- 1. Enhance stencil_master table to track storage status and last movement metadata
ALTER TABLE stencil_master ADD COLUMN IF NOT EXISTS storage_status VARCHAR(50) DEFAULT 'AVAILABLE' CHECK (storage_status IN ('AVAILABLE', 'CHECKED_OUT'));
ALTER TABLE stencil_master ADD COLUMN IF NOT EXISTS last_movement VARCHAR(50) CHECK (last_movement IN ('ASSIGNED', 'RECEIVED', 'RETURNED', 'RELOCATED'));
ALTER TABLE stencil_master ADD COLUMN IF NOT EXISTS last_movement_by VARCHAR(255);
ALTER TABLE stencil_master ADD COLUMN IF NOT EXISTS last_movement_date TIMESTAMP;

-- 2. Create stencil_racks table to store physical rack structures
CREATE TABLE IF NOT EXISTS stencil_racks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) UNIQUE NOT NULL,
    rows INTEGER NOT NULL CHECK (rows >= 1),
    columns INTEGER NOT NULL CHECK (columns >= 1),
    description TEXT,
    status VARCHAR(50) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_by VARCHAR(255),
    created_by_name VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(255),
    updated_by_name VARCHAR(255),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN DEFAULT FALSE
);

-- 3. Create stencil_rack_locations table for row-by-column slots mapping to stencils
CREATE TABLE IF NOT EXISTS stencil_rack_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rack_id UUID REFERENCES stencil_racks(id) ON DELETE CASCADE,
    row_number INTEGER NOT NULL,
    column_number INTEGER NOT NULL,
    location_code VARCHAR(100) NOT NULL,
    stencil_master_id UUID REFERENCES stencil_master(id) ON DELETE SET NULL,
    status VARCHAR(50) DEFAULT 'EMPTY' CHECK (status IN ('EMPTY', 'AVAILABLE', 'CHECKED_OUT')),
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
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index to ensure unique locations map
CREATE INDEX IF NOT EXISTS idx_stencil_rack_locations_rack ON stencil_rack_locations(rack_id);

-- Unique index to prevent duplicate assignment (one stencil can only occupy one slot at a time)
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_stencil_master 
ON stencil_rack_locations(stencil_master_id) 
WHERE stencil_master_id IS NOT NULL AND status <> 'EMPTY';

-- 4. Create stencil_rack_movement_history table for detailed historical tracking
CREATE TABLE IF NOT EXISTS stencil_rack_movement_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stencil_master_id UUID REFERENCES stencil_master(id) ON DELETE CASCADE,
    job_number VARCHAR(100) NOT NULL,
    action VARCHAR(100) NOT NULL, -- CREATED, ASSIGNED TO RACK, RECEIVED, RETURNED, RELOCATED, UPDATED, MAINTENANCE, INSPECTION
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

-- Index for history lookups
CREATE INDEX IF NOT EXISTS idx_stencil_rack_mv_hist_job ON stencil_rack_movement_history(job_number);
