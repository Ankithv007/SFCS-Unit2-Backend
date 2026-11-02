-- Migration to remove unused columns and constraints
DROP INDEX IF EXISTS idx_stencil_master_barcode;
DROP INDEX IF EXISTS idx_stencil_master_unique_id;
ALTER TABLE stencil_master DROP COLUMN IF EXISTS stencil_barcode;
ALTER TABLE stencil_master DROP COLUMN IF EXISTS customer_name;
ALTER TABLE stencil_master DROP COLUMN IF EXISTS unique_id;

-- Update check constraint on side column
ALTER TABLE stencil_master DROP CONSTRAINT IF EXISTS stencil_master_side_check;
ALTER TABLE stencil_master ADD CONSTRAINT stencil_master_side_check CHECK (side IN ('TOP', 'BOTTOM', 'TOP / BOTTOM'));

-- Alter audit columns to VARCHAR(255) for operator identifiers compatibility
ALTER TABLE stencil_master ALTER COLUMN created_by TYPE VARCHAR(255);
ALTER TABLE stencil_master ALTER COLUMN updated_by TYPE VARCHAR(255);
ALTER TABLE stencil_master ALTER COLUMN deleted_by TYPE VARCHAR(255);
