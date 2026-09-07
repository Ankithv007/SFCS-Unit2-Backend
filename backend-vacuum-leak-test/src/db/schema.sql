-- Vacuum Leak Test Module Schema

-- Shifts Table
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

-- VLT Unit Inspection Table
CREATE TABLE IF NOT EXISTS vlt_unit_inspection (
    id SERIAL PRIMARY KEY,
    unit_serial_no VARCHAR(255) UNIQUE NOT NULL,
    unit_tpn VARCHAR(255),
    unit_pn VARCHAR(255),
    shift VARCHAR(255),
    band VARCHAR(255),
    measured_value VARCHAR(255),
    final_status VARCHAR(50),
    retested_result VARCHAR(50),
    failure_reason TEXT,
    inspected_by VARCHAR(255),
    inspection_date_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    retested_date_time TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
