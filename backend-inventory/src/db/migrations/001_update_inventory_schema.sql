-- Migration 001: Ensure inventory database tables match inventoryController expectations

-- 1. Create Vendors if not exists
CREATE TABLE IF NOT EXISTS vendors (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    address TEXT,
    gstin VARCHAR(50),
    pan VARCHAR(50),
    email VARCHAR(255),
    phone VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Create Master Items if not exists
CREATE TABLE IF NOT EXISTS master_items (
    id SERIAL PRIMARY KEY,
    item_name VARCHAR(255) NOT NULL,
    description TEXT,
    vepl_part_no VARCHAR(100) UNIQUE,
    mpn VARCHAR(100),
    manufacturer VARCHAR(100),
    hsn_sac VARCHAR(50),
    default_unit_price DECIMAL(10, 2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_items_name ON master_items(item_name);
CREATE INDEX IF NOT EXISTS idx_items_vepl ON master_items(vepl_part_no);
CREATE INDEX IF NOT EXISTS idx_items_mpn ON master_items(mpn);

-- 3. Check and alter purchase_orders table if it was created with old schema
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'purchase_orders' AND column_name = 'vendor_id'
    ) THEN
        DROP TABLE IF EXISTS purchase_orders CASCADE;

        CREATE TABLE purchase_orders (
            id SERIAL PRIMARY KEY,
            po_number VARCHAR(50) UNIQUE NOT NULL,
            organization VARCHAR(50),
            date DATE NOT NULL,
            vendor_id INTEGER REFERENCES vendors(id),
            status VARCHAR(50) DEFAULT 'Draft',
            total_amount NUMERIC(12, 2) DEFAULT 0,
            tax_amount NUMERIC(12, 2) DEFAULT 0,
            grand_total NUMERIC(12, 2) DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    END IF;
END $$;

-- 4. Create purchase_order_items if not exists
CREATE TABLE IF NOT EXISTS purchase_order_items (
    id SERIAL PRIMARY KEY,
    po_id INTEGER REFERENCES purchase_orders(id) ON DELETE CASCADE,
    item_id INTEGER REFERENCES master_items(id),
    item_name VARCHAR(255),
    description TEXT,
    ordered_qty NUMERIC(10, 2) NOT NULL,
    received_qty NUMERIC(10, 2) DEFAULT 0,
    rejected_qty NUMERIC(10, 2) DEFAULT 0,
    unit_price NUMERIC(10, 2) NOT NULL,
    tax_rate NUMERIC(5, 2) DEFAULT 0,
    location VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
