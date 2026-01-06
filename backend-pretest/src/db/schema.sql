-- IQC Batches Table
CREATE TABLE IF NOT EXISTS iqc_batches (
    id SERIAL PRIMARY KEY,
    batch_number VARCHAR(255) UNIQUE NOT NULL,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    quantity INTEGER,
    status VARCHAR(50) DEFAULT 'OPEN'
);

-- IQC Components Table
CREATE TABLE IF NOT EXISTS iqc_components (
    id SERIAL PRIMARY KEY,
    batch_id INTEGER REFERENCES iqc_batches(id),
    barcode VARCHAR(255) NOT NULL,
    scanned_by VARCHAR(255) NOT NULL,
    scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    remarks TEXT,
    status VARCHAR(50) DEFAULT 'ACCEPTED',
    previous_batch VARCHAR(255)
);

-- Impedance Sessions Table
CREATE TABLE IF NOT EXISTS impedance_sessions (
    id SERIAL PRIMARY KEY,
    batch_id INTEGER REFERENCES iqc_batches(id),
    tested_by VARCHAR(255) NOT NULL,
    remarks TEXT,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Impedance Scans Table
CREATE TABLE IF NOT EXISTS impedance_scans (
    id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES impedance_sessions(id),
    barcode VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'ACCEPTED',
    scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    remarks TEXT
);

-- Warehouse Batches Table
CREATE TABLE IF NOT EXISTS warehouse_batches (
    id SERIAL PRIMARY KEY,
    batch_number VARCHAR(255) UNIQUE NOT NULL,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expected_quantity INTEGER NOT NULL,
    status VARCHAR(50) DEFAULT 'OPEN'
);

-- Warehouse Scans Table
CREATE TABLE IF NOT EXISTS warehouse_scans (
    id SERIAL PRIMARY KEY,
    batch_id INTEGER REFERENCES warehouse_batches(id),
    barcode VARCHAR(255) NOT NULL,
    scanned_by VARCHAR(255) NOT NULL,
    scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) DEFAULT 'ACCEPTED',
    previous_batch VARCHAR(255)
);
