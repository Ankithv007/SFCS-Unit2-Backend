-- Create Material Management master, items, and history tables
CREATE TABLE IF NOT EXISTS material_management (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id VARCHAR(255) NOT NULL REFERENCES smt_work_orders(id) ON DELETE CASCADE,
    qms_id INTEGER NOT NULL REFERENCES qms_master(id) ON DELETE CASCADE,
    
    -- Work order snapshot
    work_order_number VARCHAR(255) NOT NULL,
    po_number VARCHAR(255),
    product_name VARCHAR(255),
    product_description TEXT,
    quantity INTEGER NOT NULL,
    production_quantity INTEGER NOT NULL,
    
    -- BOM revision lock
    bom_revision_id INTEGER REFERENCES qms_bom_revisions(id) ON DELETE SET NULL,
    bom_revision_number VARCHAR(50),
    
    status VARCHAR(50) DEFAULT 'DRAFT', -- DRAFT, ACTIVE, COMPLETED, CLOSED
    remarks TEXT,
    
    created_by VARCHAR(255),
    updated_by VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS material_management_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material_management_id UUID NOT NULL REFERENCES material_management(id) ON DELETE CASCADE,
    qms_bom_item_id INTEGER REFERENCES qms_bom_items(id) ON DELETE SET NULL, -- Locked reference

    vepl_part_no VARCHAR(255),
    description TEXT,
    manufacturer VARCHAR(255),
    mfr_part_no VARCHAR(255),

    qty_per_product DECIMAL(18,4),
    required_qty DECIMAL(18,4),
    issued_qty DECIMAL(18,4) DEFAULT 0,
    delta_qty DECIMAL(18,4),

    created_by VARCHAR(255),
    updated_by VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(material_management_id, qms_bom_item_id)
);

CREATE TABLE IF NOT EXISTS material_management_item_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material_management_item_id UUID REFERENCES material_management_items(id) ON DELETE CASCADE,

    previous_issued_qty DECIMAL(18,4),
    new_issued_qty DECIMAL(18,4),

    previous_delta_qty DECIMAL(18,4),
    new_delta_qty DECIMAL(18,4),

    remarks TEXT,
    changed_by VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_material_management_wo ON material_management(work_order_id);
CREATE INDEX IF NOT EXISTS idx_material_management_status ON material_management(status);
CREATE INDEX IF NOT EXISTS idx_material_management_items_mm_id ON material_management_items(material_management_id);
CREATE INDEX IF NOT EXISTS idx_material_management_history_item ON material_management_item_history(material_management_item_id);

-- Database trigger to automatically refresh updated_at on updates
CREATE OR REPLACE FUNCTION update_material_management_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_material_management_updated_at ON material_management;
CREATE TRIGGER trigger_update_material_management_updated_at
BEFORE UPDATE ON material_management
FOR EACH ROW
EXECUTE FUNCTION update_material_management_updated_at();

DROP TRIGGER IF EXISTS trigger_update_material_management_items_updated_at ON material_management_items;
CREATE TRIGGER trigger_update_material_management_items_updated_at
BEFORE UPDATE ON material_management_items
FOR EACH ROW
EXECUTE FUNCTION update_material_management_updated_at();
