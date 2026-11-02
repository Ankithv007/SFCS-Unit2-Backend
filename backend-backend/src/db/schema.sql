-- ==========================================
-- PURE CENTRALIZED ENTERPRISE MES ARCHITECTURE
-- ==========================================

-- ==========================================
-- FRESH START: WIPE ALL EXISTING DATA AND TABLES
-- ==========================================
-- DROP SCHEMA public CASCADE;
-- CREATE SCHEMA public;
-- 1. Employees & Authentication
CREATE TABLE IF NOT EXISTS employees (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    user_id VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'OPERATOR',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Products / Models (Future Foundation)
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    model_number VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Production Lines (Future Foundation)
CREATE TABLE IF NOT EXISTS production_lines (
    id SERIAL PRIMARY KEY,
    line_name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Production Stages
CREATE TABLE IF NOT EXISTS production_stages (
    id SERIAL PRIMARY KEY,
    stage_code VARCHAR(50) UNIQUE NOT NULL,
    stage_name VARCHAR(100) NOT NULL,
    stage_order INT UNIQUE NOT NULL,
    workflow_type VARCHAR(50) DEFAULT 'STANDARD', -- STANDARD, REWORK, DEBUG, INSPECTION
    validation_rules JSONB DEFAULT '{}'::jsonb,
    requires_usn BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Workflow Transitions (Dynamic Routing)
CREATE TABLE IF NOT EXISTS workflow_transitions (
    id SERIAL PRIMARY KEY,
    from_stage_id INT REFERENCES production_stages(id) ON DELETE CASCADE,
    to_stage_id INT REFERENCES production_stages(id) ON DELETE CASCADE,
    on_scan_result VARCHAR(50) DEFAULT 'ACCEPTED', -- ACCEPTED, FAILED
    validation_logic JSONB DEFAULT '{}'::jsonb,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(from_stage_id, to_stage_id, on_scan_result)
);

-- 6. Workflow Templates (Future Foundation)
CREATE TABLE IF NOT EXISTS workflow_templates (
    id SERIAL PRIMARY KEY,
    product_id INT REFERENCES products(id),
    template_name VARCHAR(100) NOT NULL,
    configuration JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 7. Work Orders
CREATE TABLE IF NOT EXISTS work_orders (
    id SERIAL PRIMARY KEY,
    wo_number VARCHAR(100) UNIQUE NOT NULL,
    product_id INT REFERENCES products(id),
    model VARCHAR(100), -- Legacy support
    customer_name VARCHAR(100),
    quantity INT NOT NULL,
    status VARCHAR(50) DEFAULT 'ACTIVE',
    created_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 8. Batches (Centralized Unified Batch Table)
CREATE TABLE IF NOT EXISTS batches (
    id SERIAL PRIMARY KEY,
    batch_number VARCHAR(100) UNIQUE NOT NULL,
    work_order_id INT REFERENCES work_orders(id) ON DELETE CASCADE,
    current_stage_id INT REFERENCES production_stages(id),
    status VARCHAR(50) DEFAULT 'ACTIVE', -- ACTIVE, COMPLETED, HOLD
    created_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMP,
    deleted_by VARCHAR(100)
);

-- 9. Batch Stage Progress (Centralized Metrics)
CREATE TABLE IF NOT EXISTS batch_stage_progress (
    id SERIAL PRIMARY KEY,
    batch_id INT REFERENCES batches(id) ON DELETE CASCADE,
    stage_id INT REFERENCES production_stages(id) ON DELETE CASCADE,
    scanned_qty INT DEFAULT 0,
    accepted_qty INT DEFAULT 0,
    failed_qty INT DEFAULT 0,
    rework_qty INT DEFAULT 0,
    debug_qty INT DEFAULT 0,
    status VARCHAR(50) DEFAULT 'PENDING', -- PENDING, IN_PROGRESS, COMPLETED
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    UNIQUE(batch_id, stage_id)
);

-- 10. Units (Single Source of Truth for Physical Items)
CREATE TABLE IF NOT EXISTS units (
    id SERIAL PRIMARY KEY,
    barcode VARCHAR(100) UNIQUE NOT NULL,
    batch_id INT REFERENCES batches(id) ON DELETE CASCADE,
    current_stage_id INT NOT NULL REFERENCES production_stages(id),
    current_status VARCHAR(50) DEFAULT 'PENDING',
    failed_stage_id INT REFERENCES production_stages(id),
    failed_at TIMESTAMP,
    failure_remark TEXT,
    repair_count INT DEFAULT 0,
    repair_remark TEXT,
    last_scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_scanned_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 11. Unit Serial Mapping (External Serial Numbers)
CREATE TABLE IF NOT EXISTS unit_serial_mapping (
    id SERIAL PRIMARY KEY,
    barcode VARCHAR(100) UNIQUE NOT NULL REFERENCES units(barcode) ON DELETE CASCADE,
    unit_serial_number VARCHAR(255) UNIQUE NOT NULL,
    linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    linked_by VARCHAR(100) NOT NULL
);

-- 12. Scans (Unified Factory-Wide Scan Log)
CREATE TABLE IF NOT EXISTS scans (
    id SERIAL PRIMARY KEY,
    barcode VARCHAR(100) NOT NULL REFERENCES units(barcode) ON DELETE CASCADE,
    batch_id INT REFERENCES batches(id),
    stage_id INT REFERENCES production_stages(id),
    employee_id INT REFERENCES employees(id),
    scanned_by VARCHAR(100) NOT NULL, -- Name fallback
    scan_result VARCHAR(50) NOT NULL, -- ACCEPTED, FAILED, REWORK, DEBUG
    remarks TEXT,
    resolution_remarks TEXT,
    scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 13. Rework Sessions
CREATE TABLE IF NOT EXISTS rework_sessions (
    id SERIAL PRIMARY KEY,
    barcode VARCHAR(100) NOT NULL REFERENCES units(barcode) ON DELETE CASCADE,
    failed_scan_id INT REFERENCES scans(id),
    stage_id INT REFERENCES production_stages(id),
    assigned_to VARCHAR(100),
    status VARCHAR(50) DEFAULT 'OPEN', -- OPEN, RESOLVED, SCRAPPED
    root_cause TEXT,
    action_taken TEXT,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

-- 14. Debug Sessions
CREATE TABLE IF NOT EXISTS debug_sessions (
    id SERIAL PRIMARY KEY,
    barcode VARCHAR(100) NOT NULL REFERENCES units(barcode) ON DELETE CASCADE,
    failed_scan_id INT REFERENCES scans(id),
    stage_id INT REFERENCES production_stages(id),
    assigned_to VARCHAR(100),
    status VARCHAR(50) DEFAULT 'OPEN',
    defect_category VARCHAR(100),
    repair_action TEXT,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

-- 15. Audit Log (Immutable Event Tracking)
CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL, -- SCAN, BATCH_CREATE, STATUS_CHANGE, DELETE
    entity_type VARCHAR(50) NOT NULL, -- UNIT, BATCH, WORK_ORDER
    entity_id VARCHAR(100) NOT NULL,
    actor VARCHAR(100) NOT NULL,
    old_value JSONB,
    new_value JSONB,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 16. Machine Events (Future Foundation)
CREATE TABLE IF NOT EXISTS machine_events (
    id SERIAL PRIMARY KEY,
    machine_id VARCHAR(100),
    event_code VARCHAR(100),
    barcode VARCHAR(100),
    status VARCHAR(50),
    metadata JSONB,
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 17. Machine Logs (Future Foundation)
CREATE TABLE IF NOT EXISTS machine_logs (
    id SERIAL PRIMARY KEY,
    machine_id VARCHAR(100),
    log_level VARCHAR(20),
    message TEXT,
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- INDEXING STRATEGY
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_units_barcode ON units(barcode);
CREATE INDEX IF NOT EXISTS idx_scans_barcode ON scans(barcode);
CREATE INDEX IF NOT EXISTS idx_scans_stage_id ON scans(stage_id);
CREATE INDEX IF NOT EXISTS idx_batches_number ON batches(batch_number);
CREATE INDEX IF NOT EXISTS idx_batch_progress_batch ON batch_stage_progress(batch_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);

-- Performance Optimization Indexes (Benchmarked and Justified)
CREATE INDEX IF NOT EXISTS idx_batches_work_order_id ON batches(work_order_id);
CREATE INDEX IF NOT EXISTS idx_batches_created_at ON batches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_units_batch_id ON units(batch_id);
CREATE INDEX IF NOT EXISTS idx_units_stage_status ON units(current_stage_id, current_status);
CREATE INDEX IF NOT EXISTS idx_units_failed_stage_id ON units(failed_stage_id);
CREATE INDEX IF NOT EXISTS idx_scans_batch_stage ON scans(batch_id, stage_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_created_at ON work_orders(created_at DESC);

-- ==========================================
-- SEED DATA
-- ==========================================
INSERT INTO production_stages (stage_code, stage_name, stage_order, workflow_type, requires_usn) VALUES
('PTH', 'Pre-Soldering', 1, 'STANDARD', FALSE),
('VI', 'Visual Inspection', 2, 'STANDARD', FALSE),
('QA', 'Quality Assurance', 3, 'STANDARD', FALSE),
('FLASHING', 'Flashing', 4, 'STANDARD', FALSE),
('PCBA_FCT', 'PCBA FCT', 5, 'STANDARD', TRUE),
('ASSEMBLY', 'Assembly', 6, 'STANDARD', FALSE),
('UNIT_TESTING', 'Unit Testing', 7, 'STANDARD', FALSE),
('QI', 'Quality Inspection', 8, 'STANDARD', FALSE),
('PACKING', 'Packing', 9, 'STANDARD', FALSE),
('REWORK', 'Rework', 10, 'REWORK', FALSE),
('DEBUG', 'Debug', 11, 'DEBUG', FALSE)
ON CONFLICT (stage_code) DO NOTHING;

-- INSERT STRICT WORKFLOW TRANSITIONS
INSERT INTO workflow_transitions (from_stage_id, to_stage_id, on_scan_result) VALUES
-- STANDARD LINEAR FLOW
(1, 2, 'ACCEPTED'), -- PTH -> VI
(2, 3, 'ACCEPTED'), -- VI -> QA
(3, 4, 'ACCEPTED'), -- QA -> FLASHING
(4, 5, 'ACCEPTED'), -- FLASHING -> PCBA_FCT
(5, 6, 'ACCEPTED'), -- PCBA_FCT -> ASSEMBLY
(6, 7, 'ACCEPTED'), -- ASSEMBLY -> UNIT_TESTING
(7, 8, 'ACCEPTED'), -- UNIT_TESTING -> QI
(8, 9, 'ACCEPTED'), -- QI -> PACKING

-- REWORK / DEBUG EXITS
(1, 10, 'REWORK'), -- PTH -> REWORK
(1, 11, 'DEBUG'),  -- PTH -> DEBUG
(2, 10, 'REWORK'), -- VI -> REWORK
(2, 11, 'DEBUG'),  -- VI -> DEBUG
(3, 10, 'REWORK'), -- QA -> REWORK
(3, 11, 'DEBUG'),  -- QA -> DEBUG
(4, 10, 'REWORK'), -- FLASHING -> REWORK
(4, 11, 'DEBUG'),  -- FLASHING -> DEBUG
(5, 10, 'REWORK'), -- PCBA_FCT -> REWORK
(5, 11, 'DEBUG'),  -- PCBA_FCT -> DEBUG
(6, 10, 'REWORK'), -- ASSEMBLY -> REWORK
(6, 11, 'DEBUG'),  -- ASSEMBLY -> DEBUG
(7, 10, 'REWORK'), -- UNIT_TESTING -> REWORK
(7, 11, 'DEBUG'),  -- UNIT_TESTING -> DEBUG
(8, 10, 'REWORK'), -- QI -> REWORK
(8, 11, 'DEBUG'),  -- QI -> DEBUG
(9, 10, 'REWORK'), -- PACKING -> REWORK
(9, 11, 'DEBUG')  -- PACKING -> DEBUG

ON CONFLICT (from_stage_id, to_stage_id, on_scan_result) DO NOTHING;
