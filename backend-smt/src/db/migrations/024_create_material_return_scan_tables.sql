-- Migration: Create Material Return Scan Tables and alter issued_material_details
ALTER TABLE issued_material_details ADD COLUMN IF NOT EXISTS remaining_qty DECIMAL(18,4);
ALTER TABLE issued_material_details ADD COLUMN IF NOT EXISTS raw_barcode TEXT;

-- Initialize columns for existing data
UPDATE issued_material_details SET remaining_qty = issued_qty WHERE remaining_qty IS NULL;
UPDATE issued_material_details SET raw_barcode = 'MIGRATED' WHERE raw_barcode IS NULL;

-- Enforce constraints
ALTER TABLE issued_material_details ALTER COLUMN remaining_qty SET NOT NULL;
ALTER TABLE issued_material_details ALTER COLUMN raw_barcode SET NOT NULL;

CREATE TABLE IF NOT EXISTS returned_material_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issued_material_detail_id UUID NOT NULL REFERENCES issued_material_details(id) ON DELETE CASCADE,
    uid VARCHAR(255) NOT NULL,
    returned_qty DECIMAL(18,4) NOT NULL,
    remaining_qty_after DECIMAL(18,4) NOT NULL,
    raw_barcode TEXT NOT NULL,
    returned_by VARCHAR(255) NOT NULL,
    returned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_returned_material_details_issued ON returned_material_details(issued_material_detail_id);
