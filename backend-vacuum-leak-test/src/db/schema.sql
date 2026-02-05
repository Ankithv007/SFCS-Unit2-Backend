-- Vacuum Leak Test Module Schema

-- Shifts Table (Strictly following QC pattern)
CREATE TABLE IF NOT EXISTS shifts (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    status VARCHAR(50) DEFAULT 'active',
    created_by VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- VLT Unit TPNs Table
CREATE TABLE IF NOT EXISTS vlt_unit_tpns (
    id SERIAL PRIMARY KEY,
    value VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- VLT Unit PNs Table
CREATE TABLE IF NOT EXISTS vlt_unit_pns (
    id SERIAL PRIMARY KEY,
    value VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Main Vacuum Leak Test Results (Initial Structure)
CREATE TABLE IF NOT EXISTS vacuum_leak_tests (
    id SERIAL PRIMARY KEY,
    inspector_name VARCHAR(255),
    shift VARCHAR(255),
    unit_tpn VARCHAR(255),
    unit_pn VARCHAR(255),
    unit_serial_no VARCHAR(255) UNIQUE NOT NULL,
    status VARCHAR(50) DEFAULT 'COMPLETED',
    inspection_date_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    final_status VARCHAR(50),
    remarks TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
