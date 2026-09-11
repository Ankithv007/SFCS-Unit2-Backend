-- Migration: 053_create_smt_spi_workflow_tables.sql
-- Description: Create sessions table for SPI and extend smt_inspections table for SPI session link.

-- 1. Create SPI sessions table
CREATE TABLE IF NOT EXISTS smt_spi_sessions (
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

-- 2. Extend smt_inspections table for SPI session ID link
ALTER TABLE smt_inspections ADD COLUMN IF NOT EXISTS spi_session_id UUID REFERENCES smt_spi_sessions(id) ON DELETE SET NULL;

-- 3. Create indexes for performance and traceability
CREATE INDEX IF NOT EXISTS idx_smt_spi_sessions_wo ON smt_spi_sessions(work_order_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_smt_inspections_spi_sess ON smt_inspections(spi_session_id);
