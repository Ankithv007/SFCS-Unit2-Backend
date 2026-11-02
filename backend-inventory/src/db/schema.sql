-- Vendors Table
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

-- Master Items Table (Source of Truth)
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

-- Indexes for fast search
CREATE INDEX IF NOT EXISTS idx_items_name ON master_items(item_name);
CREATE INDEX IF NOT EXISTS idx_items_vepl ON master_items(vepl_part_no);
CREATE INDEX IF NOT EXISTS idx_items_mpn ON master_items(mpn);

-- Purchase Orders Table
CREATE TABLE IF NOT EXISTS purchase_orders (
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

-- Purchase Order Items Table
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
