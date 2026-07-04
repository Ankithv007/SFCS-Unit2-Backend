-- Migration 027: Create MSD Tracker tables

CREATE TABLE IF NOT EXISTS msd_master (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id VARCHAR(255) NOT NULL UNIQUE REFERENCES smt_work_orders(id) ON DELETE CASCADE,
    work_order_number VARCHAR(255) NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    product_description TEXT,
    quantity INTEGER NOT NULL,
    remarks TEXT,
    status VARCHAR(50) DEFAULT 'ACTIVE', -- ACTIVE, CLOSED
    created_by VARCHAR(255),
    updated_by VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS msd_bom_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    msd_id UUID NOT NULL REFERENCES msd_master(id) ON DELETE CASCADE,
    material_management_item_id UUID REFERENCES material_management_items(id) ON DELETE SET NULL,
    sl_no VARCHAR(50),
    vepl_part_no VARCHAR(255) NOT NULL,
    description TEXT,
    manufacturer VARCHAR(255),
    mfr_part_no VARCHAR(255),
    qty_per_product DECIMAL(18,4),
    required_qty DECIMAL(18,4),
    issued_qty DECIMAL(18,4) DEFAULT 0,
    msl_raw VARCHAR(50),
    msl_normalized VARCHAR(50) NOT NULL,
    packing_condition VARCHAR(50), -- Sealed, Open
    status VARCHAR(50) DEFAULT 'OK', -- OK, EXPIRED
    open_date TIMESTAMP,
    closed_date TIMESTAMP,
    package_thickness DECIMAL(10,3),
    thickness_category VARCHAR(100),
    bake_method VARCHAR(100),
    bake_time DECIMAL(10,2),
    floor_life_hours INTEGER DEFAULT 168,
    timer_status VARCHAR(50) DEFAULT 'NOT_STARTED', -- NOT_STARTED, RUNNING, FROZEN
    is_expired BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS msd_bom_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bom_item_id UUID NOT NULL REFERENCES msd_bom_items(id) ON DELETE CASCADE,
    field_name VARCHAR(100) NOT NULL,
    old_value TEXT,
    new_value TEXT,
    changed_by VARCHAR(255) NOT NULL,
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS msd_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    msd_id UUID REFERENCES msd_master(id) ON DELETE CASCADE,
    action VARCHAR(255) NOT NULL,
    performed_by VARCHAR(255) NOT NULL,
    browser VARCHAR(255),
    ip_address VARCHAR(50),
    details TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexing
CREATE INDEX IF NOT EXISTS idx_msd_master_wo ON msd_master(work_order_id);
CREATE INDEX IF NOT EXISTS idx_msd_bom_items_master ON msd_bom_items(msd_id);
CREATE INDEX IF NOT EXISTS idx_msd_bom_items_vepl ON msd_bom_items(vepl_part_no);
CREATE INDEX IF NOT EXISTS idx_msd_bom_history_item ON msd_bom_history(bom_item_id);
CREATE INDEX IF NOT EXISTS idx_msd_audit_logs_master ON msd_audit_logs(msd_id);

-- Database trigger to refresh updated_at on updates
CREATE OR REPLACE FUNCTION update_msd_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_msd_master_updated_at ON msd_master;
CREATE TRIGGER trigger_update_msd_master_updated_at
BEFORE UPDATE ON msd_master
FOR EACH ROW
EXECUTE FUNCTION update_msd_updated_at();

DROP TRIGGER IF EXISTS trigger_update_msd_bom_items_updated_at ON msd_bom_items;
CREATE TRIGGER trigger_update_msd_bom_items_updated_at
BEFORE UPDATE ON msd_bom_items
FOR EACH ROW
EXECUTE FUNCTION update_msd_updated_at();
