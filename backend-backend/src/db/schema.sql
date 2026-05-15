-- Centralized Production Workflow Schema

-- 1. Production Stages Management
CREATE TABLE IF NOT EXISTS production_stages (
  id SERIAL PRIMARY KEY,
  stage_name VARCHAR(50) UNIQUE NOT NULL,
  stage_order INT UNIQUE NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Default Stages Data
-- Note: In a real migration, this might be handled via a seed script
-- 1: PTH, 2: VI, 3: QA, 4: Flashing, 5: PCBA-FCT, 6: Assembly, 7: Unit Testing, 8: QI, 9: Packing

-- 2. Work Orders
CREATE TABLE IF NOT EXISTS work_orders (
  id SERIAL PRIMARY KEY,
  wo_number VARCHAR(50) UNIQUE NOT NULL,
  quantity INT NOT NULL,
  customer_name VARCHAR(100) NOT NULL,
  model VARCHAR(50) NOT NULL,
  created_by VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Master Batches
CREATE TABLE IF NOT EXISTS master_batches (
  id SERIAL PRIMARY KEY,
  work_order_id INT REFERENCES work_orders(id) ON DELETE CASCADE,
  batch_number VARCHAR(100) UNIQUE NOT NULL,
  customer_name VARCHAR(100),
  model VARCHAR(50),
  total_qty INT,
  created_by VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  current_stage_id INT REFERENCES production_stages(id),
  status VARCHAR(20) DEFAULT 'active' -- pending, active, completed, cancelled
);

-- 4. Batch Stage Tracking
CREATE TABLE IF NOT EXISTS batch_stage_tracking (
  id SERIAL PRIMARY KEY,
  batch_id INT REFERENCES master_batches(id) ON DELETE CASCADE,
  stage_id INT REFERENCES production_stages(id) ON DELETE CASCADE,
  scanned_qty INT DEFAULT 0,
  passed_qty INT DEFAULT 0,
  failed_qty INT DEFAULT 0,
  rework_qty INT DEFAULT 0,
  debug_qty INT DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pending', -- pending, in_progress, completed
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  UNIQUE(batch_id, stage_id)
);

-- 5. Barcode Tracking (Traceability)
CREATE TABLE IF NOT EXISTS barcode_tracking (
  id SERIAL PRIMARY KEY,
  barcode VARCHAR(100) UNIQUE NOT NULL,
  batch_id INT REFERENCES master_batches(id) ON DELETE CASCADE,
  current_stage_id INT REFERENCES production_stages(id),
  current_status VARCHAR(20) DEFAULT 'pending', -- pending, accepted, rework, debug, failed
  last_scanned_at TIMESTAMP,
  last_updated_by VARCHAR(100),
  last_updated_at TIMESTAMP,
  revalidated_passed_at TIMESTAMP,
  repair_completed_at TIMESTAMP,
  failure_created_at TIMESTAMP,
  failed_stage_id INT REFERENCES production_stages(id)
);

-- 6. Stage Scan History (Audit Trail)
CREATE TABLE IF NOT EXISTS stage_scan_history (
  id SERIAL PRIMARY KEY,
  batch_id INT REFERENCES master_batches(id) ON DELETE CASCADE,
  barcode VARCHAR(100) NOT NULL,
  stage_id INT REFERENCES production_stages(id) ON DELETE CASCADE,
  scan_result VARCHAR(20) NOT NULL, -- accepted, rework, debug, failed
  scanned_by VARCHAR(100),
  scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  remarks TEXT,
  resolution_remarks TEXT
);

-- 7. Production Stage Batch & Scan Tables (Restored for application compatibility)

-- PTH
CREATE TABLE IF NOT EXISTS pth_batches (
    id SERIAL PRIMARY KEY,
    work_order_id INTEGER REFERENCES work_orders(id) ON DELETE CASCADE,
    batch_number VARCHAR(255) UNIQUE NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMP,
    deleted_by VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS pth_scans (
    id SERIAL PRIMARY KEY,
    batch_id INTEGER REFERENCES pth_batches(id) ON DELETE CASCADE,
    barcode VARCHAR(255) NOT NULL,
    scanned_by VARCHAR(255) NOT NULL,
    scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) DEFAULT 'ACCEPTED',
    remarks TEXT,
    resolution_remarks TEXT,
    failed_at TIMESTAMP,
    failed_remarks TEXT
);

-- VI
CREATE TABLE IF NOT EXISTS vi_batches (
    id SERIAL PRIMARY KEY,
    work_order_id INTEGER REFERENCES work_orders(id) ON DELETE CASCADE,
    batch_number VARCHAR(255) UNIQUE NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMP,
    deleted_by VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS vi_scans (
    id SERIAL PRIMARY KEY,
    batch_id INTEGER REFERENCES vi_batches(id) ON DELETE CASCADE,
    barcode VARCHAR(255) NOT NULL,
    scanned_by VARCHAR(255) NOT NULL,
    scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) DEFAULT 'ACCEPTED',
    remarks TEXT,
    resolution_remarks TEXT,
    failed_at TIMESTAMP,
    failed_remarks TEXT
);

-- QA
CREATE TABLE IF NOT EXISTS qa_batches (
    id SERIAL PRIMARY KEY,
    work_order_id INTEGER REFERENCES work_orders(id) ON DELETE CASCADE,
    batch_number VARCHAR(255) UNIQUE NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMP,
    deleted_by VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS qa_scans (
    id SERIAL PRIMARY KEY,
    batch_id INTEGER REFERENCES qa_batches(id) ON DELETE CASCADE,
    barcode VARCHAR(255) NOT NULL,
    scanned_by VARCHAR(255) NOT NULL,
    scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) DEFAULT 'ACCEPTED',
    remarks TEXT,
    resolution_remarks TEXT,
    failed_at TIMESTAMP,
    failed_remarks TEXT
);

-- Flashing
CREATE TABLE IF NOT EXISTS flashing_batches (
    id SERIAL PRIMARY KEY,
    work_order_id INTEGER REFERENCES work_orders(id) ON DELETE CASCADE,
    batch_number VARCHAR(255) UNIQUE NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMP,
    deleted_by VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS flashing_scans (
    id SERIAL PRIMARY KEY,
    batch_id INTEGER REFERENCES flashing_batches(id) ON DELETE CASCADE,
    barcode VARCHAR(255) NOT NULL,
    scanned_by VARCHAR(255) NOT NULL,
    scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) DEFAULT 'ACCEPTED',
    remarks TEXT,
    resolution_remarks TEXT,
    failed_at TIMESTAMP,
    failed_remarks TEXT
);

-- PCBA-FCT
CREATE TABLE IF NOT EXISTS pcba_fct_batches (
    id SERIAL PRIMARY KEY,
    work_order_id INTEGER REFERENCES work_orders(id) ON DELETE CASCADE,
    batch_number VARCHAR(255) UNIQUE NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMP,
    deleted_by VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS pcba_fct_scans (
    id SERIAL PRIMARY KEY,
    batch_id INTEGER REFERENCES pcba_fct_batches(id) ON DELETE CASCADE,
    barcode VARCHAR(255) NOT NULL,
    scanned_by VARCHAR(255) NOT NULL,
    scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) DEFAULT 'ACCEPTED',
    remarks TEXT,
    resolution_remarks TEXT,
    failed_at TIMESTAMP,
    failed_remarks TEXT
);

-- Assembly
CREATE TABLE IF NOT EXISTS assembly_batches (
    id SERIAL PRIMARY KEY,
    work_order_id INTEGER REFERENCES work_orders(id) ON DELETE CASCADE,
    batch_number VARCHAR(255) UNIQUE NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMP,
    deleted_by VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS assembly_scans (
    id SERIAL PRIMARY KEY,
    batch_id INTEGER REFERENCES assembly_batches(id) ON DELETE CASCADE,
    barcode VARCHAR(255) NOT NULL,
    scanned_by VARCHAR(255) NOT NULL,
    scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) DEFAULT 'ACCEPTED',
    remarks TEXT,
    resolution_remarks TEXT,
    failed_at TIMESTAMP,
    failed_remarks TEXT
);

-- Unit Testing
CREATE TABLE IF NOT EXISTS unit_testing_batches (
    id SERIAL PRIMARY KEY,
    work_order_id INTEGER REFERENCES work_orders(id) ON DELETE CASCADE,
    batch_number VARCHAR(255) UNIQUE NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMP,
    deleted_by VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS unit_testing_scans (
    id SERIAL PRIMARY KEY,
    batch_id INTEGER REFERENCES unit_testing_batches(id) ON DELETE CASCADE,
    barcode VARCHAR(255) NOT NULL,
    scanned_by VARCHAR(255) NOT NULL,
    scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) DEFAULT 'ACCEPTED',
    remarks TEXT,
    resolution_remarks TEXT,
    failed_at TIMESTAMP,
    failed_remarks TEXT
);

-- QI
CREATE TABLE IF NOT EXISTS qi_batches (
    id SERIAL PRIMARY KEY,
    work_order_id INTEGER REFERENCES work_orders(id) ON DELETE CASCADE,
    batch_number VARCHAR(255) UNIQUE NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMP,
    deleted_by VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS qi_scans (
    id SERIAL PRIMARY KEY,
    batch_id INTEGER REFERENCES qi_batches(id) ON DELETE CASCADE,
    barcode VARCHAR(255) NOT NULL,
    scanned_by VARCHAR(255) NOT NULL,
    scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) DEFAULT 'ACCEPTED',
    remarks TEXT,
    resolution_remarks TEXT,
    failed_at TIMESTAMP,
    failed_remarks TEXT
);

-- Packing
CREATE TABLE IF NOT EXISTS packing_batches (
    id SERIAL PRIMARY KEY,
    work_order_id INTEGER REFERENCES work_orders(id) ON DELETE CASCADE,
    batch_number VARCHAR(255) UNIQUE NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMP,
    deleted_by VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS packing_scans (
    id SERIAL PRIMARY KEY,
    batch_id INTEGER REFERENCES packing_batches(id) ON DELETE CASCADE,
    barcode VARCHAR(255) NOT NULL,
    scanned_by VARCHAR(255) NOT NULL,
    scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) DEFAULT 'ACCEPTED',
    remarks TEXT,
    resolution_remarks TEXT,
    failed_at TIMESTAMP,
    failed_remarks TEXT
);

-- 8. Rework (formerly Remark) Tables
CREATE TABLE IF NOT EXISTS rework_batches (
  id SERIAL PRIMARY KEY,
  work_order_id INT REFERENCES work_orders(id) ON DELETE CASCADE,
  batch_number VARCHAR(100) UNIQUE NOT NULL,
  created_by VARCHAR(100) NOT NULL,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_deleted BOOLEAN DEFAULT FALSE,
  deleted_at TIMESTAMP,
  deleted_by VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS rework_scans (
  id SERIAL PRIMARY KEY,
  batch_id INT REFERENCES rework_batches(id) ON DELETE CASCADE,
  barcode VARCHAR(100) NOT NULL,
  scanned_by VARCHAR(100),
  scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(20) DEFAULT 'accepted',
  remarks TEXT,
  stage VARCHAR(50),
  resolution_remarks TEXT,
  failed_at TIMESTAMP,
  failed_remarks TEXT
);

-- 9. Debug Tables
CREATE TABLE IF NOT EXISTS debug_batches (
  id SERIAL PRIMARY KEY,
  work_order_id INT REFERENCES work_orders(id) ON DELETE CASCADE,
  batch_number VARCHAR(100) UNIQUE NOT NULL,
  created_by VARCHAR(100) NOT NULL,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_deleted BOOLEAN DEFAULT FALSE,
  deleted_at TIMESTAMP,
  deleted_by VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS debug_scans (
  id SERIAL PRIMARY KEY,
  batch_id INT REFERENCES debug_batches(id) ON DELETE CASCADE,
  barcode VARCHAR(100) NOT NULL,
  scanned_by VARCHAR(100),
  scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(20) DEFAULT 'accepted',
  remarks TEXT,
  stage VARCHAR(50),
  resolution_remarks TEXT,
  failed_at TIMESTAMP,
  failed_remarks TEXT
);

-- Legacy table cleanup
-- DROP TABLE IF EXISTS pth_batches, pth_scans, vi_batches, vi_scans, qa_batches, qa_scans, etc.

