-- Migration 020_create_stencil_lifecycle.sql
-- 1. Add target_life_cycle column to stencil_master table
ALTER TABLE stencil_master ADD COLUMN IF NOT EXISTS target_life_cycle INTEGER NOT NULL DEFAULT 60000;

-- 2. Create the smt_stencil_lifecycle table
CREATE TABLE IF NOT EXISTS smt_stencil_lifecycle (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stencil_record_id UUID NOT NULL REFERENCES stencil_master(id) ON DELETE RESTRICT,
    stencil_id VARCHAR(50) NOT NULL,
    stencil_name VARCHAR(255) NOT NULL,
    work_order_id VARCHAR(255) NOT NULL REFERENCES smt_work_orders(id) ON DELETE RESTRICT,
    work_order_number VARCHAR(255) NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    product_description TEXT,
    sides VARCHAR(30) NOT NULL,
    quantity INTEGER NOT NULL,
    target_life_cycle INTEGER NOT NULL DEFAULT 60000,
    qty_life_cycle INTEGER NOT NULL,
    balance_life_cycle INTEGER NOT NULL,
    current_used_life_cycle INTEGER NOT NULL,
    status VARCHAR(50) NOT NULL, -- Available, Running, Completed, Expired
    remarks TEXT,
    
    created_by VARCHAR(255) NOT NULL,
    created_by_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(255) NULL,
    updated_by_name VARCHAR(255) NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_by VARCHAR(255) NULL,
    deleted_by_name VARCHAR(255) NULL,
    deleted_at TIMESTAMP NULL
);

-- 3. Unique Index to prevent duplicate assignments of the same work order to a stencil
CREATE UNIQUE INDEX IF NOT EXISTS idx_lifecycle_stencil_wo ON smt_stencil_lifecycle(stencil_record_id, work_order_id) WHERE is_deleted = false;
