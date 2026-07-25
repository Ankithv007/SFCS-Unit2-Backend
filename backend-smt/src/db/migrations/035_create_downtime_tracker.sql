-- Migration: 035_create_downtime_tracker.sql
-- Description: Create SMT Downtime Tracker table

CREATE TABLE IF NOT EXISTS smt_downtime_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift VARCHAR(50) NOT NULL,
    line VARCHAR(50) NOT NULL,
    machine_name VARCHAR(100) NOT NULL,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    duration NUMERIC(12, 2) NOT NULL, -- stored in minutes
    downtime_category VARCHAR(100) NOT NULL,
    downtime_description TEXT NOT NULL,
    action_taken TEXT NOT NULL,
    responsible_person VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL,
    remarks TEXT,
    created_by VARCHAR(255) NOT NULL,
    created_by_name VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(255),
    updated_by_name VARCHAR(255),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    work_order_id VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_smt_downtime_records_line ON smt_downtime_records(line);
CREATE INDEX IF NOT EXISTS idx_smt_downtime_records_shift ON smt_downtime_records(shift);
CREATE INDEX IF NOT EXISTS idx_smt_downtime_records_machine ON smt_downtime_records(machine_name);
