-- Migration: 034_create_smt_fg_workflow_tables.sql
-- Description: Create sessions table for SMT FG, extend smt_inspections table, and add smt_production_status with constraint.

-- 1. Add smt_production_status column to smt_work_orders table with CHECK constraint
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'smt_work_orders' AND column_name = 'smt_production_status') THEN
        ALTER TABLE smt_work_orders ADD COLUMN smt_production_status VARCHAR(50) DEFAULT 'Pending' NOT NULL;
        ALTER TABLE smt_work_orders ADD CONSTRAINT chk_smt_production_status CHECK (smt_production_status IN ('Pending', 'In Progress', 'Completed'));
    END IF;
END $$;

-- 2. Create SMT FG sessions table
CREATE TABLE IF NOT EXISTS smt_fg_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id VARCHAR(255) NOT NULL REFERENCES smt_work_orders(id) ON DELETE RESTRICT,
    stencil_lifecycle_id UUID NOT NULL REFERENCES smt_stencil_lifecycle(id) ON DELETE RESTRICT,
    squeegee_number VARCHAR(255) NOT NULL,
    solder_paste_barcode VARCHAR(255) NOT NULL,
    side VARCHAR(30) NOT NULL,
    status VARCHAR(50) DEFAULT 'Pending' NOT NULL, -- Pending, In Progress, Completed, Cancelled, Aborted
    
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

-- 3. Extend smt_inspections table for SMT FG session ID link
ALTER TABLE smt_inspections ADD COLUMN IF NOT EXISTS fg_session_id UUID REFERENCES smt_fg_sessions(id) ON DELETE SET NULL;

-- 4. Create indexes for performance and traceability
CREATE INDEX IF NOT EXISTS idx_smt_fg_sessions_wo ON smt_fg_sessions(work_order_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_smt_inspections_fg_sess ON smt_inspections(fg_session_id);
