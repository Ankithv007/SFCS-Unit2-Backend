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
    date DATE NOT NULL,
    item_id INTEGER REFERENCES master_items(id),
    
    -- Snapshot of item details
    item_name VARCHAR(255), 
    description TEXT,
    
    -- Quantities
    ordered_qty DECIMAL(10, 2) NOT NULL,
    received_qty DECIMAL(10, 2) DEFAULT 0,
    rejected_qty DECIMAL(10, 2) DEFAULT 0,
    
    -- Financials
    unit_price DECIMAL(10, 2) NOT NULL,
    tax_rate DECIMAL(5, 2) DEFAULT 0,
    location VARCHAR(100),
    
    -- Generated columns for automatic calculation
    tax_amount DECIMAL(10, 2) GENERATED ALWAYS AS ((ordered_qty * unit_price) * (tax_rate / 100)) STORED,
    total_amount DECIMAL(12, 2) GENERATED ALWAYS AS ((ordered_qty * unit_price) + ((ordered_qty * unit_price) * (tax_rate / 100))) STORED
);


