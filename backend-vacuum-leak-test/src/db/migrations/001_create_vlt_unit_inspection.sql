-- Migration 001: Ensure vlt_unit_inspection table exists for Vacuum Leak Test microservice

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
