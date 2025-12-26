-- Add organization column to purchase_orders
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS organization VARCHAR(50);

-- Add location column to purchase_order_items
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS location VARCHAR(100);
