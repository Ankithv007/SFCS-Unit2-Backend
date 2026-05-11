CREATE TABLE IF NOT EXISTS work_orders (
  id SERIAL PRIMARY KEY,
  wo_number VARCHAR(50) UNIQUE NOT NULL,
  quantity INT NOT NULL,
  customer_name VARCHAR(100) NOT NULL,
  model VARCHAR(50) NOT NULL,
  created_by VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pth_batches (
  id SERIAL PRIMARY KEY,
  work_order_id INT REFERENCES work_orders(id) ON DELETE CASCADE,
  batch_number VARCHAR(100) UNIQUE NOT NULL,
  created_by VARCHAR(100) NOT NULL,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pth_scans (
  id SERIAL PRIMARY KEY,
  work_order_id INT REFERENCES work_orders(id) ON DELETE CASCADE,
  batch_id INT REFERENCES pth_batches(id) ON DELETE CASCADE,
  barcode VARCHAR(100) NOT NULL,
  scanned_by VARCHAR(100),
  scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(20) DEFAULT 'ACCEPTED'
);

CREATE TABLE IF NOT EXISTS vi_batches (
  id SERIAL PRIMARY KEY,
  batch_number VARCHAR(100) UNIQUE NOT NULL,
  work_order_id INT REFERENCES work_orders(id) ON DELETE CASCADE,
  created_by VARCHAR(100) NOT NULL,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vi_scans (
  id SERIAL PRIMARY KEY,
  batch_id INT REFERENCES vi_batches(id) ON DELETE CASCADE,
  barcode VARCHAR(100) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  reason VARCHAR(100),
  remarks TEXT,
  scanned_by VARCHAR(100),
  scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(batch_id, barcode)
);

CREATE TABLE IF NOT EXISTS qi (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS flashing (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pcba_fct (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assembly (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS unit_testing (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS packing (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS qi_scans (
  id SERIAL PRIMARY KEY,
  batch_id INT REFERENCES qi_batches(id) ON DELETE CASCADE,
  barcode VARCHAR(100) NOT NULL,
  scanned_by VARCHAR(100),
  scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(20) DEFAULT 'accepted',
  remarks TEXT,
  resolution_remarks TEXT
);

-- Packing Tables
CREATE TABLE IF NOT EXISTS packing_batches (
  id SERIAL PRIMARY KEY,
  work_order_id INT REFERENCES work_orders(id) ON DELETE CASCADE,
  batch_number VARCHAR(100) UNIQUE NOT NULL,
  created_by VARCHAR(100) NOT NULL,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS packing_scans (
  id SERIAL PRIMARY KEY,
  batch_id INT REFERENCES packing_batches(id) ON DELETE CASCADE,
  barcode VARCHAR(100) NOT NULL,
  scanned_by VARCHAR(100),
  scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(20) DEFAULT 'accepted',
  remarks TEXT,
  resolution_remarks TEXT
);

-- Remark Tables
CREATE TABLE IF NOT EXISTS remark_batches (
  id SERIAL PRIMARY KEY,
  work_order_id INT REFERENCES work_orders(id) ON DELETE CASCADE,
  batch_number VARCHAR(100) UNIQUE NOT NULL,
  created_by VARCHAR(100) NOT NULL,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS remark_scans (
  id SERIAL PRIMARY KEY,
  batch_id INT REFERENCES remark_batches(id) ON DELETE CASCADE,
  barcode VARCHAR(100) NOT NULL,
  scanned_by VARCHAR(100),
  scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(20) DEFAULT 'accepted',
  remarks TEXT,
  stage VARCHAR(50),
  resolution_remarks TEXT
);

-- Debug Tables
CREATE TABLE IF NOT EXISTS debug_batches (
  id SERIAL PRIMARY KEY,
  work_order_id INT REFERENCES work_orders(id) ON DELETE CASCADE,
  batch_number VARCHAR(100) UNIQUE NOT NULL,
  created_by VARCHAR(100) NOT NULL,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
  resolution_remarks TEXT
);

-- Add resolution_remarks, failed_at, and failed_remarks columns to all station scan tables for cross-module tracking
ALTER TABLE pth_scans ADD COLUMN IF NOT EXISTS resolution_remarks TEXT;
ALTER TABLE pth_scans ADD COLUMN IF NOT EXISTS failed_at TIMESTAMP;
ALTER TABLE pth_scans ADD COLUMN IF NOT EXISTS failed_remarks TEXT;

ALTER TABLE vi_scans ADD COLUMN IF NOT EXISTS resolution_remarks TEXT;
ALTER TABLE vi_scans ADD COLUMN IF NOT EXISTS failed_at TIMESTAMP;
ALTER TABLE vi_scans ADD COLUMN IF NOT EXISTS failed_remarks TEXT;

ALTER TABLE qa_scans ADD COLUMN IF NOT EXISTS resolution_remarks TEXT;
ALTER TABLE qa_scans ADD COLUMN IF NOT EXISTS failed_at TIMESTAMP;
ALTER TABLE qa_scans ADD COLUMN IF NOT EXISTS failed_remarks TEXT;

ALTER TABLE flashing_scans ADD COLUMN IF NOT EXISTS resolution_remarks TEXT;
ALTER TABLE flashing_scans ADD COLUMN IF NOT EXISTS failed_at TIMESTAMP;
ALTER TABLE flashing_scans ADD COLUMN IF NOT EXISTS failed_remarks TEXT;

ALTER TABLE pcba_fct_scans ADD COLUMN IF NOT EXISTS resolution_remarks TEXT;
ALTER TABLE pcba_fct_scans ADD COLUMN IF NOT EXISTS failed_at TIMESTAMP;
ALTER TABLE pcba_fct_scans ADD COLUMN IF NOT EXISTS failed_remarks TEXT;

ALTER TABLE assembly_scans ADD COLUMN IF NOT EXISTS resolution_remarks TEXT;
ALTER TABLE assembly_scans ADD COLUMN IF NOT EXISTS failed_at TIMESTAMP;
ALTER TABLE assembly_scans ADD COLUMN IF NOT EXISTS failed_remarks TEXT;

ALTER TABLE unit_testing_scans ADD COLUMN IF NOT EXISTS resolution_remarks TEXT;
ALTER TABLE unit_testing_scans ADD COLUMN IF NOT EXISTS failed_at TIMESTAMP;
ALTER TABLE unit_testing_scans ADD COLUMN IF NOT EXISTS failed_remarks TEXT;

ALTER TABLE qi_scans ADD COLUMN IF NOT EXISTS resolution_remarks TEXT;
ALTER TABLE qi_scans ADD COLUMN IF NOT EXISTS failed_at TIMESTAMP;
ALTER TABLE qi_scans ADD COLUMN IF NOT EXISTS failed_remarks TEXT;

ALTER TABLE packing_scans ADD COLUMN IF NOT EXISTS resolution_remarks TEXT;
ALTER TABLE packing_scans ADD COLUMN IF NOT EXISTS failed_at TIMESTAMP;
ALTER TABLE packing_scans ADD COLUMN IF NOT EXISTS failed_remarks TEXT;

ALTER TABLE remark_scans ADD COLUMN IF NOT EXISTS resolution_remarks TEXT;
ALTER TABLE remark_scans ADD COLUMN IF NOT EXISTS failed_at TIMESTAMP;
ALTER TABLE remark_scans ADD COLUMN IF NOT EXISTS failed_remarks TEXT;

ALTER TABLE debug_scans ADD COLUMN IF NOT EXISTS resolution_remarks TEXT;
ALTER TABLE debug_scans ADD COLUMN IF NOT EXISTS failed_at TIMESTAMP;
ALTER TABLE debug_scans ADD COLUMN IF NOT EXISTS failed_remarks TEXT;

-- Migration/Updates for existing tables
ALTER TABLE pth_scans ADD COLUMN IF NOT EXISTS remarks TEXT;
ALTER TABLE pth_scans ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'ACCEPTED';
ALTER TABLE remark_scans ADD COLUMN IF NOT EXISTS stage VARCHAR(50);
ALTER TABLE debug_scans ADD COLUMN IF NOT EXISTS stage VARCHAR(50);
