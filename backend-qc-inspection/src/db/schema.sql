-- QC Unit TPNs Table
CREATE TABLE IF NOT EXISTS qc_unit_tpns (
    id SERIAL PRIMARY KEY,
    value VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- QC Unit PNs Table
CREATE TABLE IF NOT EXISTS qc_unit_pns (
    id SERIAL PRIMARY KEY,
    value VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

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

-- QC Inspections Table
CREATE TABLE IF NOT EXISTS qc_inspections (
    id SERIAL PRIMARY KEY,
    inspector_name VARCHAR(255),
    shift VARCHAR(255),
    unit_tpn VARCHAR(255),
    unit_pn VARCHAR(255),
    unit_serial_number VARCHAR(255) UNIQUE NOT NULL,
    pam_tpn VARCHAR(255),
    pam_1 VARCHAR(255),
    pam_2 VARCHAR(255),
    pam_3 VARCHAR(255),
    pam_4 VARCHAR(255),
    ran_barcode VARCHAR(255),
    checklist_results JSONB,
    final_status VARCHAR(50),
    process_confirmation BOOLEAN,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- QC Unit Inspection Table
CREATE TABLE IF NOT EXISTS qc_unit_inspection (
    id SERIAL PRIMARY KEY,
    unit_serial_no VARCHAR(255) UNIQUE NOT NULL,
    unit_tpn VARCHAR(255),
    unit_pn VARCHAR(255),
    pam_tpn VARCHAR(255),
    pam_1 VARCHAR(255),
    pam_2 VARCHAR(255),
    pam_3 VARCHAR(255),
    pam_4 VARCHAR(255),
    ran_barcode VARCHAR(255),
    shift VARCHAR(255),
    band VARCHAR(255),
    good_count INT DEFAULT 0,
    bad_count INT DEFAULT 0,
    passed VARCHAR(10), -- YES / NO
    failed VARCHAR(10), -- YES / NO
    inspected_by VARCHAR(255),
    inspection_date_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) DEFAULT 'COMPLETED',
    de_assembly_status VARCHAR(50),
    rework_count INT DEFAULT 0,
    final_status VARCHAR(50),
    combined_remarks TEXT
);

-- QC Inspection Checklist Result Table
CREATE TABLE IF NOT EXISTS qc_inspection_checklist_result (
    id SERIAL PRIMARY KEY,
    inspection_id INT REFERENCES qc_unit_inspection(id) ON DELETE CASCADE,
    inspection_level VARCHAR(50), -- FIRST_LEVEL / FINAL_LEVEL
    checkpoint_no INT,
    checkpoint_description TEXT,
    result VARCHAR(10), -- PASS / FAIL
    remark TEXT,
    rework_count INT DEFAULT 0,
    history JSONB
);
