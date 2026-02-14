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
    remarks TEXT,
    test_pa1 BOOLEAN DEFAULT TRUE,
    test_pa2 BOOLEAN DEFAULT TRUE,
    test_pa4 BOOLEAN DEFAULT TRUE,
    test_pa5 BOOLEAN DEFAULT TRUE,
    test_r160 BOOLEAN DEFAULT TRUE,
    tested_by VARCHAR(255)
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

-- Test Case Master Table (Calibration)
CREATE TABLE IF NOT EXISTS test_case_master (
    test_case_number INTEGER PRIMARY KEY,
    test_case_name VARCHAR(255) NOT NULL,
    reason TEXT
);

-- ACLR Test Case Master Table
CREATE TABLE IF NOT EXISTS aclr_test_case_master (
    test_case_number INTEGER PRIMARY KEY,
    test_case_name VARCHAR(255) NOT NULL,
    reason TEXT
);

-- Pre-Calibration Scans Table
CREATE TABLE IF NOT EXISTS pre_calibration_scans (
    id SERIAL PRIMARY KEY,
    barcode VARCHAR(255) NOT NULL UNIQUE,
    operator_name VARCHAR(255) NOT NULL,
    measured_value INTEGER,
    calibration_result VARCHAR(10) NOT NULL CHECK (calibration_result IN ('PASS', 'FAIL')),
    retest_result VARCHAR(10) DEFAULT NULL CHECK (retest_result IN ('PASS')),
    retest_datetime TIMESTAMP DEFAULT NULL,
    test_case_number INTEGER REFERENCES test_case_master(test_case_number),
    shift CHAR(1) NOT NULL CHECK (shift IN ('A', 'B', 'C')),
    tpn VARCHAR(50) NOT NULL DEFAULT '611-PCA000117-L',
    stage VARCHAR(20) NOT NULL DEFAULT 'PRE CAL',
    jig_id VARCHAR(50) NOT NULL,
    scanned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_measured_value CHECK ((calibration_result = 'PASS' AND measured_value IS NULL) OR (calibration_result = 'FAIL' AND measured_value IS NOT NULL)),
    CONSTRAINT chk_test_case CHECK ((calibration_result = 'FAIL' AND test_case_number IS NOT NULL) OR (calibration_result = 'PASS' AND test_case_number IS NULL))
);

-- Pre-ACLR Scans Table
CREATE TABLE IF NOT EXISTS pre_aclr_scans (
    id SERIAL PRIMARY KEY,
    barcode VARCHAR(255) NOT NULL UNIQUE,
    operator_name VARCHAR(255) NOT NULL,
    measured_value INTEGER,
    aclr_result VARCHAR(10) NOT NULL CHECK (aclr_result IN ('PASS', 'FAIL')),
    retest_result VARCHAR(10) DEFAULT NULL CHECK (retest_result IN ('PASS')),
    retest_datetime TIMESTAMP DEFAULT NULL,
    test_case_number INTEGER REFERENCES aclr_test_case_master(test_case_number),
    shift CHAR(1) NOT NULL CHECK (shift IN ('A', 'B', 'C')),
    tpn VARCHAR(50) NOT NULL DEFAULT '611-PCA000117-L',
    stage VARCHAR(20) NOT NULL DEFAULT 'PRE-ACLR',
    jig_id VARCHAR(50) NOT NULL,
    scanned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_measured_value_aclr CHECK ((aclr_result = 'PASS' AND measured_value IS NULL) OR (aclr_result = 'FAIL' AND measured_value IS NOT NULL)),
    CONSTRAINT chk_test_case_aclr CHECK ((aclr_result = 'FAIL' AND test_case_number IS NOT NULL) OR (aclr_result = 'PASS' AND test_case_number IS NULL))
);

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_precal_scanned_at ON pre_calibration_scans(scanned_at);
CREATE INDEX IF NOT EXISTS idx_precal_barcode ON pre_calibration_scans(barcode);
CREATE INDEX IF NOT EXISTS idx_preaclr_scanned_at ON pre_aclr_scans(scanned_at);
CREATE INDEX IF NOT EXISTS idx_preaclr_barcode ON pre_aclr_scans(barcode);
