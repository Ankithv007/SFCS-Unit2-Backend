-- Migration to update constraints on material_return table

-- 1. Update any existing NULL status to 'DRAFT'
UPDATE material_return SET status = 'DRAFT' WHERE status IS NULL;

-- 2. Alter column status to not null and set default
ALTER TABLE material_return ALTER COLUMN status SET DEFAULT 'DRAFT';
ALTER TABLE material_return ALTER COLUMN status SET NOT NULL;

-- 3. Add CHECK constraint on status
ALTER TABLE material_return DROP CONSTRAINT IF EXISTS check_material_return_status;
ALTER TABLE material_return ADD CONSTRAINT check_material_return_status CHECK (status IN ('DRAFT', 'ACTIVE', 'COMPLETED', 'CLOSED'));

-- 4. Add UNIQUE constraint to material_management_id
ALTER TABLE material_return DROP CONSTRAINT IF EXISTS unique_material_management_id;
ALTER TABLE material_return ADD CONSTRAINT unique_material_management_id UNIQUE (material_management_id);
