-- Migration 022_create_smt_baking_tracking.sql
CREATE TABLE IF NOT EXISTS smt_baking_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_name VARCHAR(255) NOT NULL,
    vepl_part_number VARCHAR(255) NOT NULL,
    manufacturing_part_number VARCHAR(255) NOT NULL,
    msl_level VARCHAR(255) NOT NULL,
    reel_qty INTEGER NOT NULL CHECK (reel_qty > 0),
    baking_temperature VARCHAR(255) NOT NULL,
    component_thickness VARCHAR(255) NOT NULL,
    baking_in_time TIMESTAMP NOT NULL,
    baking_out_time TIMESTAMP NULL,
    baking_duration VARCHAR(100) NULL,
    approved_by_qa VARCHAR(255) NULL,
    status VARCHAR(50) NOT NULL CHECK (status IN ('Pending Baking', 'Completed Baking')),
    
    created_by VARCHAR(255) NOT NULL,
    created_by_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    updated_by VARCHAR(255) NULL,
    updated_by_name VARCHAR(255) NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    stopped_by VARCHAR(255) NULL,
    stopped_by_name VARCHAR(255) NULL,
    stopped_at TIMESTAMP NULL,
    
    remarks TEXT NULL,
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_by VARCHAR(255) NULL,
    deleted_by_name VARCHAR(255) NULL,
    deleted_at TIMESTAMP NULL
);

-- Index for status performance
CREATE INDEX IF NOT EXISTS idx_baking_tracking_status ON smt_baking_tracking(status) WHERE is_deleted = false;
