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

-- Trace Module Schema
DO $$ BEGIN
    CREATE TYPE trace_status AS ENUM ('Passed', 'Failed', 'Rework', 'Scrap', 'In Progress');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS barcode_stage_history (
    id BIGSERIAL PRIMARY KEY,
    barcode VARCHAR(255) NOT NULL,
    stage_name VARCHAR(50) NOT NULL CHECK (stage_name IN ('Warehouse', 'Pre-IQC', 'Pre-Impedance', 'Pre-Calibration', 'Pre-ACLR')),
    stage_order INTEGER NOT NULL CHECK (stage_order BETWEEN 1 AND 5),
    batch_id INTEGER,
    status trace_status NOT NULL,
    operator VARCHAR(255) NOT NULL,
    remarks TEXT,
    source_system VARCHAR(50) NOT NULL DEFAULT 'pretest',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Immutability Trigger
CREATE OR REPLACE FUNCTION prevent_modifications() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'barcode_stage_history is immutable'; END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
    CREATE TRIGGER no_update_delete BEFORE UPDATE OR DELETE ON barcode_stage_history
    FOR EACH ROW EXECUTE FUNCTION prevent_modifications();
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Elite Performance Indices
CREATE INDEX IF NOT EXISTS idx_trace_barcode_history_asc ON barcode_stage_history(barcode, created_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_trace_latest_only_desc ON barcode_stage_history (barcode, created_at DESC) INCLUDE (stage_name, status, operator, batch_id);
