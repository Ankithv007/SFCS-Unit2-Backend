-- Increase column length for manufacturer and manufacturer_part_no to TEXT
ALTER TABLE qms_bom_items ALTER COLUMN manufacturer TYPE TEXT;
ALTER TABLE qms_bom_items ALTER COLUMN manufacturer_part_no TYPE TEXT;
ALTER TABLE material_management_items ALTER COLUMN manufacturer TYPE TEXT;
ALTER TABLE material_management_items ALTER COLUMN mfr_part_no TYPE TEXT;
