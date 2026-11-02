-- Create Material Return master and items tables
CREATE TABLE IF NOT EXISTS material_return (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material_management_id UUID NOT NULL UNIQUE REFERENCES material_management(id) ON DELETE CASCADE,
    work_order_id VARCHAR(255) NOT NULL REFERENCES smt_work_orders(id) ON DELETE CASCADE,
    qms_id INTEGER NOT NULL REFERENCES qms_master(id) ON DELETE CASCADE,
    
    -- Work order snapshot
    work_order_number VARCHAR(255) NOT NULL,
    po_number VARCHAR(255),
    product_name VARCHAR(255),
    product_description TEXT,
    quantity INTEGER NOT NULL,
    
    -- Current BOM Revision
    current_bom_revision VARCHAR(50),
    
    status VARCHAR(50) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'COMPLETED', 'CLOSED')),
    remarks TEXT,
    
    created_by VARCHAR(255),
    updated_by VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS material_return_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material_return_id UUID NOT NULL REFERENCES material_return(id) ON DELETE CASCADE,
    material_management_item_id UUID NOT NULL REFERENCES material_management_items(id) ON DELETE CASCADE,

    return_qty DECIMAL(18,4) DEFAULT 0,
    remarks TEXT,

    created_by VARCHAR(255),
    updated_by VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(material_return_id, material_management_item_id)
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_material_return_wo ON material_return(work_order_id);
CREATE INDEX IF NOT EXISTS idx_material_return_mm ON material_return(material_management_id);
CREATE INDEX IF NOT EXISTS idx_material_return_status ON material_return(status);
CREATE INDEX IF NOT EXISTS idx_material_return_items_mr_id ON material_return_items(material_return_id);

-- Database trigger to automatically refresh updated_at on updates
DROP TRIGGER IF EXISTS trigger_update_material_return_updated_at ON material_return;
CREATE TRIGGER trigger_update_material_return_updated_at
BEFORE UPDATE ON material_return
FOR EACH ROW
EXECUTE FUNCTION update_material_management_updated_at();

DROP TRIGGER IF EXISTS trigger_update_material_return_items_updated_at ON material_return_items;
CREATE TRIGGER trigger_update_material_return_items_updated_at
BEFORE UPDATE ON material_return_items
FOR EACH ROW
EXECUTE FUNCTION update_material_management_updated_at();
