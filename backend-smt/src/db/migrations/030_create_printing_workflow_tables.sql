-- Migration: 030_create_printing_workflow_tables.sql
-- Description: Create smt_printing_sessions table and alter smt_inspections to support SMT Printing module.

-- 1. Create printing sessions table
CREATE TABLE IF NOT EXISTS smt_printing_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id VARCHAR(255) NOT NULL REFERENCES smt_work_orders(id) ON DELETE RESTRICT,
    stencil_lifecycle_id UUID NOT NULL REFERENCES smt_stencil_lifecycle(id) ON DELETE RESTRICT,
    squeegee_number VARCHAR(255) NOT NULL,
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

-- 2. Extend smt_inspections table for Printing workflow
ALTER TABLE smt_inspections ADD COLUMN IF NOT EXISTS printing_session_id UUID REFERENCES smt_printing_sessions(id) ON DELETE SET NULL;
ALTER TABLE smt_inspections ADD COLUMN IF NOT EXISTS scanned_barcode VARCHAR(255);

-- 3. Create indexes for performance and traceability
CREATE INDEX IF NOT EXISTS idx_smt_printing_sessions_wo ON smt_printing_sessions(work_order_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_smt_inspections_printing_sess ON smt_inspections(printing_session_id);
