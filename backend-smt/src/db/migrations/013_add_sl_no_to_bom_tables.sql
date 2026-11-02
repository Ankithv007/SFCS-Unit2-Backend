-- Add sl_no column to qms_bom_items and material_management_items tables
ALTER TABLE qms_bom_items ADD COLUMN IF NOT EXISTS sl_no VARCHAR(50);
ALTER TABLE material_management_items ADD COLUMN IF NOT EXISTS sl_no VARCHAR(50);
