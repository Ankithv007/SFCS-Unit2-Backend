-- SMT Work Orders Table
CREATE TABLE IF NOT EXISTS smt_work_orders (
    id VARCHAR(255) PRIMARY KEY,
    area_id VARCHAR(255) NOT NULL,
    line_id VARCHAR(255) NOT NULL,
    priority VARCHAR(50) NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    product_description TEXT,
    quantity INTEGER NOT NULL,
    panel_quantity INTEGER NOT NULL,
    status VARCHAR(50) DEFAULT 'Created',
    barcode_source VARCHAR(100) DEFAULT 'Generate Barcode',
    is_registered BOOLEAN DEFAULT false,
    created_by VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- SMT Serial Numbers Table
CREATE TABLE IF NOT EXISTS smt_serial_numbers (
    id SERIAL PRIMARY KEY,
    work_order_id VARCHAR(255) REFERENCES smt_work_orders(id) ON DELETE CASCADE,
    serial_format VARCHAR(50) NOT NULL,
    serial_number VARCHAR(255) UNIQUE NOT NULL,
    status VARCHAR(50) DEFAULT 'Created',
    created_by VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- SMT Inspections Table (For detail tracking of process steps)
CREATE TABLE IF NOT EXISTS smt_inspections (
    id SERIAL PRIMARY KEY,
    serial_id INTEGER REFERENCES smt_serial_numbers(id) ON DELETE CASCADE,
    process_step VARCHAR(100) NOT NULL, -- SPI, Post AOI, Rework, etc.
    scanned_by VARCHAR(255),
    scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) DEFAULT 'PASS',
    rework_reason TEXT
);

-- SMT Process Setups Table (For persistent station entries like Printing, SPI, etc.)
CREATE TABLE IF NOT EXISTS smt_process_setups (
    id SERIAL PRIMARY KEY,
    work_order_id VARCHAR(255) REFERENCES smt_work_orders(id) ON DELETE CASCADE,
    process_name VARCHAR(100) NOT NULL,
    product_name VARCHAR(255),
    quantity INTEGER,
    stencil_name VARCHAR(255),
    squeegee_number VARCHAR(255),
    solder_paste VARCHAR(255),
    side VARCHAR(20),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- SMT Printing Employees Table
CREATE TABLE IF NOT EXISTS smt_printing_employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    user_id VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
