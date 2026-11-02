-- Migration: 045_add_stencil_rack_number.sql
-- Purpose: Add stencil_rack_number columns, constraints, and indices for physical stencil identification.

-- 1. Add stencil_rack_number column to stencil_rack_locations
ALTER TABLE stencil_rack_locations ADD COLUMN stencil_rack_number VARCHAR(100);

-- 2. Add stencil_rack_number column to stencil_rack_movement_history
ALTER TABLE stencil_rack_movement_history ADD COLUMN stencil_rack_number VARCHAR(100);

-- 3. Create unique index to ensure Stencil Rack Number is unique across active locations
CREATE UNIQUE INDEX idx_unique_active_stencil_rack_number 
ON stencil_rack_locations(stencil_rack_number) 
WHERE stencil_rack_number IS NOT NULL AND status <> 'EMPTY';

-- 4. Update check constraint to enforce both job_number and stencil_rack_number are set when not empty
ALTER TABLE stencil_rack_locations DROP CONSTRAINT IF EXISTS chk_job_number_not_null;
ALTER TABLE stencil_rack_locations ADD CONSTRAINT chk_job_number_not_null CHECK (
    status = 'EMPTY' OR (job_number IS NOT NULL AND stencil_rack_number IS NOT NULL)
);

-- 5. Create index for fast movement history search by Stencil Rack Number
CREATE INDEX idx_stencil_rack_mv_hist_rack_num ON stencil_rack_movement_history(stencil_rack_number);
