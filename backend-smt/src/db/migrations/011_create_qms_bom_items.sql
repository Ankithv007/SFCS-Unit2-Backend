-- Create qms_bom_items table to store extracted BOM components linked to a specific QMS record and BOM revision
CREATE TABLE IF NOT EXISTS qms_bom_items (
    id SERIAL PRIMARY KEY,
    qms_id INTEGER NOT NULL REFERENCES qms_master(id) ON DELETE CASCADE,
    bom_revision_id INTEGER NOT NULL REFERENCES qms_bom_revisions(id) ON DELETE CASCADE,
    vepl_part_no VARCHAR(255),
    description TEXT,
    manufacturer VARCHAR(255),
    manufacturer_part_no VARCHAR(255),
    qty_per_product NUMERIC(12, 4), -- Store quantities as decimals
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Performance indexes for filtering, joins, search, and revision history
CREATE INDEX IF NOT EXISTS idx_qms_bom_items_qms_id ON qms_bom_items(qms_id);
CREATE INDEX IF NOT EXISTS idx_qms_bom_items_revision_id ON qms_bom_items(bom_revision_id);
CREATE INDEX IF NOT EXISTS idx_qms_bom_items_vepl ON qms_bom_items(vepl_part_no);
CREATE INDEX IF NOT EXISTS idx_qms_bom_items_description ON qms_bom_items(description);
CREATE INDEX IF NOT EXISTS idx_qms_bom_items_mfr ON qms_bom_items(manufacturer);
CREATE INDEX IF NOT EXISTS idx_qms_bom_items_mfr_part ON qms_bom_items(manufacturer_part_no);

-- Database trigger to automatically refresh updated_at on record updates
CREATE OR REPLACE FUNCTION update_qms_bom_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_qms_bom_items_updated_at ON qms_bom_items;
CREATE TRIGGER trigger_update_qms_bom_items_updated_at
BEFORE UPDATE ON qms_bom_items
FOR EACH ROW
EXECUTE FUNCTION update_qms_bom_items_updated_at();
