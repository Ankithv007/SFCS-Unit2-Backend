-- Migration: 033_create_smt_stage_workflow_tables.sql
-- Description: Create sessions tables for Pre AOI, Post AOI, and Rework, and extend smt_inspections table.

-- 1. Create Pre AOI sessions table
CREATE TABLE IF NOT EXISTS smt_pre_aoi_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id VARCHAR(255) NOT NULL REFERENCES smt_work_orders(id) ON DELETE RESTRICT,
    stencil_lifecycle_id UUID NOT NULL REFERENCES smt_stencil_lifecycle(id) ON DELETE RESTRICT,
    squeegee_number VARCHAR(255),
    squeegee_front_number VARCHAR(255),
    squeegee_rear_number VARCHAR(255),
    solder_paste_barcode VARCHAR(255) NOT NULL,
    side VARCHAR(30) NOT NULL,
    status VARCHAR(50) DEFAULT 'Pending' NOT NULL, -- Pending, In Progress, Completed, Paused, Cancelled, Aborted
    
    created_by VARCHAR(255) NOT NULL,
    created_by_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by VARCHAR(255),
    updated_by_name VARCHAR(255),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    
    is_deleted BOOLEAN DEFAULT false NOT NULL,
    duplicate_scan_count INTEGER DEFAULT 0 NOT NULL,
    deleted_by VARCHAR(255),
    deleted_by_name VARCHAR(255),
    deleted_at TIMESTAMP
);

-- 2. Create Post AOI sessions table
CREATE TABLE IF NOT EXISTS smt_post_aoi_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id VARCHAR(255) NOT NULL REFERENCES smt_work_orders(id) ON DELETE RESTRICT,
    stencil_lifecycle_id UUID NOT NULL REFERENCES smt_stencil_lifecycle(id) ON DELETE RESTRICT,
    squeegee_number VARCHAR(255),
    squeegee_front_number VARCHAR(255),
    squeegee_rear_number VARCHAR(255),
    solder_paste_barcode VARCHAR(255) NOT NULL,
    side VARCHAR(30) NOT NULL,
    status VARCHAR(50) DEFAULT 'Pending' NOT NULL, -- Pending, In Progress, Completed, Paused, Cancelled, Aborted
    
    created_by VARCHAR(255) NOT NULL,
    created_by_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by VARCHAR(255),
    updated_by_name VARCHAR(255),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    
    is_deleted BOOLEAN DEFAULT false NOT NULL,
    duplicate_scan_count INTEGER DEFAULT 0 NOT NULL,
    deleted_by VARCHAR(255),
    deleted_by_name VARCHAR(255),
    deleted_at TIMESTAMP
);

-- 3. Create Rework sessions table
CREATE TABLE IF NOT EXISTS smt_rework_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id VARCHAR(255) NOT NULL REFERENCES smt_work_orders(id) ON DELETE RESTRICT,
    stencil_lifecycle_id UUID NOT NULL REFERENCES smt_stencil_lifecycle(id) ON DELETE RESTRICT,
    squeegee_number VARCHAR(255),
    squeegee_front_number VARCHAR(255),
    squeegee_rear_number VARCHAR(255),
    solder_paste_barcode VARCHAR(255) NOT NULL,
    side VARCHAR(30) NOT NULL,
    status VARCHAR(50) DEFAULT 'Pending' NOT NULL, -- Pending, In Progress, Completed, Paused, Cancelled, Aborted
    
    created_by VARCHAR(255) NOT NULL,
    created_by_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by VARCHAR(255),
    updated_by_name VARCHAR(255),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    
    is_deleted BOOLEAN DEFAULT false NOT NULL,
    duplicate_scan_count INTEGER DEFAULT 0 NOT NULL,
    deleted_by VARCHAR(255),
    deleted_by_name VARCHAR(255),
    deleted_at TIMESTAMP
);

-- Add squeegee front/rear columns to existing tables (idempotent)
ALTER TABLE smt_pre_aoi_sessions ADD COLUMN IF NOT EXISTS squeegee_front_number VARCHAR(255);
ALTER TABLE smt_pre_aoi_sessions ADD COLUMN IF NOT EXISTS squeegee_rear_number VARCHAR(255);
ALTER TABLE smt_post_aoi_sessions ADD COLUMN IF NOT EXISTS squeegee_front_number VARCHAR(255);
ALTER TABLE smt_post_aoi_sessions ADD COLUMN IF NOT EXISTS squeegee_rear_number VARCHAR(255);
ALTER TABLE smt_rework_sessions ADD COLUMN IF NOT EXISTS squeegee_front_number VARCHAR(255);
ALTER TABLE smt_rework_sessions ADD COLUMN IF NOT EXISTS squeegee_rear_number VARCHAR(255);

-- 4. Extend smt_inspections table for new stages
ALTER TABLE smt_inspections ADD COLUMN IF NOT EXISTS pre_aoi_session_id UUID REFERENCES smt_pre_aoi_sessions(id) ON DELETE SET NULL;
ALTER TABLE smt_inspections ADD COLUMN IF NOT EXISTS post_aoi_session_id UUID REFERENCES smt_post_aoi_sessions(id) ON DELETE SET NULL;
ALTER TABLE smt_inspections ADD COLUMN IF NOT EXISTS rework_session_id UUID REFERENCES smt_rework_sessions(id) ON DELETE SET NULL;

-- 5. Create indexes for performance and traceability
CREATE INDEX IF NOT EXISTS idx_smt_pre_aoi_sessions_wo ON smt_pre_aoi_sessions(work_order_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_smt_post_aoi_sessions_wo ON smt_post_aoi_sessions(work_order_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_smt_rework_sessions_wo ON smt_rework_sessions(work_order_id) WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_smt_inspections_pre_aoi_sess ON smt_inspections(pre_aoi_session_id);
CREATE INDEX IF NOT EXISTS idx_smt_inspections_post_aoi_sess ON smt_inspections(post_aoi_session_id);
CREATE INDEX IF NOT EXISTS idx_smt_inspections_rework_sess ON smt_inspections(rework_session_id);
