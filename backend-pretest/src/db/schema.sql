-- IQC Batches Table
CREATE TABLE IF NOT EXISTS iqc_batches (
    id SERIAL PRIMARY KEY,
    batch_number VARCHAR(255) UNIQUE NOT NULL,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) DEFAULT 'OPEN'
);

-- IQC Components Table
CREATE TABLE IF NOT EXISTS iqc_components (
    id SERIAL PRIMARY KEY,
    batch_id INTEGER REFERENCES iqc_batches(id),
    barcode VARCHAR(255) UNIQUE NOT NULL,
    scanned_by VARCHAR(255) NOT NULL,
    scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    remarks TEXT,
    status VARCHAR(50) DEFAULT 'ACCEPTED'
);
