-- Migration to add sides column to smt_work_orders
ALTER TABLE smt_work_orders ADD COLUMN IF NOT EXISTS sides VARCHAR(30);

-- Update existing rows to default value 'Top'
UPDATE smt_work_orders SET sides = 'Top' WHERE sides IS NULL;

-- Make sides column mandatory
ALTER TABLE smt_work_orders ALTER COLUMN sides SET NOT NULL;
