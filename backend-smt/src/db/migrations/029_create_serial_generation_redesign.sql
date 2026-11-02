-- Migration: 029_create_serial_generation_redesign.sql
-- Description: Create Serial Number & Batch Management redesign schema

-- 1. Create ENUM Types if they do not exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'smt_barcode_source_enum') THEN
        CREATE TYPE smt_barcode_source_enum AS ENUM ('GENERATE', 'CUSTOMER', 'LASER');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'smt_generation_source_enum') THEN
        CREATE TYPE smt_generation_source_enum AS ENUM ('GENERATE', 'CUSTOMER', 'LASER', 'IMPORT', 'API');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'smt_batch_status_enum') THEN
        CREATE TYPE smt_batch_status_enum AS ENUM ('Draft', 'Generated', 'Completed', 'Cancelled', 'Deleted');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'smt_separator_enum') THEN
        CREATE TYPE smt_separator_enum AS ENUM ('None', 'Hyphen (-)', 'Underscore (_)', 'Slash (/)', 'Space');
    END IF;
END
$$;

-- 3. Create Serial Batches Table
CREATE TABLE IF NOT EXISTS smt_serial_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id VARCHAR(255) NOT NULL REFERENCES smt_work_orders(id) ON DELETE RESTRICT,
    
    -- Immutable snapshot of the Work Order details at time of generation
    po_id VARCHAR(255) NOT NULL,
    work_order_number VARCHAR(255) NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    product_description TEXT,
    work_order_quantity INTEGER NOT NULL,
    panel_quantity INTEGER NOT NULL,
    sides VARCHAR(30) NOT NULL,
    line_id VARCHAR(255) NOT NULL,
    work_order_remarks TEXT,
    
    -- Barcode source, generation source, and batch status
    barcode_source smt_barcode_source_enum NOT NULL,
    generation_source smt_generation_source_enum NOT NULL,
    status smt_batch_status_enum DEFAULT 'Generated' NOT NULL,
    
    -- Quantities and remarks
    generated_quantity INTEGER NOT NULL DEFAULT 0 CHECK (generated_quantity >= 0),
    serial_generation_remarks TEXT,
    additional_notes TEXT,
    
    -- Concurrency & performance profiling
    generation_start_time TIMESTAMP NOT NULL,
    generation_end_time TIMESTAMP NOT NULL,
    generation_duration_ms INTEGER NOT NULL CHECK (generation_duration_ms >= 0),
    
    -- Audit fields
    created_by VARCHAR(255) NOT NULL,
    created_by_name VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(255),
    updated_by_name VARCHAR(255),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Soft delete flags
    is_deleted BOOLEAN DEFAULT false,
    deleted_by VARCHAR(255),
    deleted_by_name VARCHAR(255),
    deleted_at TIMESTAMP
);

-- 4. Create Generate Barcode Configuration Table
CREATE TABLE IF NOT EXISTS smt_serial_batch_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES smt_serial_batches(id) ON DELETE CASCADE,
    prefix VARCHAR(50),
    suffix VARCHAR(50),
    separator smt_separator_enum NOT NULL,
    starting_number VARCHAR(50) NOT NULL,
    ending_number VARCHAR(50) NOT NULL,
    number_length INTEGER CHECK (number_length IS NULL OR number_length > 0),
    generation_format VARCHAR(100) NOT NULL
);

-- 5. Create Laser Machine Document Metadata Table
CREATE TABLE IF NOT EXISTS smt_serial_batch_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES smt_serial_batches(id) ON DELETE CASCADE,
    original_filename VARCHAR(255) NOT NULL,
    compressed_filename VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    original_size BIGINT NOT NULL CHECK (original_size >= 0),
    compressed_size BIGINT NOT NULL CHECK (compressed_size >= 0),
    is_compressed BOOLEAN NOT NULL DEFAULT false,
    uploaded_by VARCHAR(255) NOT NULL,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. Create Customer Barcode Scan Metadata Table
CREATE TABLE IF NOT EXISTS smt_serial_batch_scans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES smt_serial_batches(id) ON DELETE CASCADE,
    total_scanned INTEGER NOT NULL DEFAULT 0 CHECK (total_scanned >= 0),
    duplicate_scan_count INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_scan_count >= 0),
    duplicate_scan_log JSONB DEFAULT '[]'::jsonb
);

-- 7. Create Batch Activity History Logs
CREATE TABLE IF NOT EXISTS smt_serial_batch_activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES smt_serial_batches(id) ON DELETE CASCADE,
    action VARCHAR(100) NOT NULL,
    details TEXT,
    changed_fields JSONB DEFAULT NULL,
    performed_by VARCHAR(255) NOT NULL,
    performed_by_name VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 8. Alter Existing Serial Numbers Table to Link to Batches and Use CHECK status constraints
ALTER TABLE smt_serial_numbers 
ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES smt_serial_batches(id) ON DELETE SET NULL;

-- Update existing status values to match the new lifecycle check constraint
UPDATE smt_serial_numbers SET status = 'Generated' WHERE status = 'Created' OR status IS NULL;
UPDATE smt_serial_numbers SET status = 'Generated' WHERE status NOT IN ('Generated', 'Printed', 'Scanned', 'In Production', 'Completed', 'Scrapped', 'Cancelled');

-- Ensure serial number status constraint matches the new lifecycle
ALTER TABLE smt_serial_numbers DROP CONSTRAINT IF EXISTS chk_serial_status;
ALTER TABLE smt_serial_numbers ALTER COLUMN status TYPE VARCHAR(50);
ALTER TABLE smt_serial_numbers ADD CONSTRAINT chk_serial_status CHECK (status IN ('Generated', 'Printed', 'Scanned', 'In Production', 'Completed', 'Scrapped', 'Cancelled'));

-- 9. Trigger for updated_at column
CREATE OR REPLACE FUNCTION update_smt_serial_batches_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_smt_serial_batches_updated_at ON smt_serial_batches;
CREATE TRIGGER trigger_update_smt_serial_batches_updated_at
BEFORE UPDATE ON smt_serial_batches
FOR EACH ROW
EXECUTE FUNCTION update_smt_serial_batches_updated_at();

-- 10. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_smt_serial_batches_wo ON smt_serial_batches(work_order_id);
CREATE INDEX IF NOT EXISTS idx_smt_serial_batches_deleted ON smt_serial_batches(is_deleted);
CREATE INDEX IF NOT EXISTS idx_smt_serial_numbers_batch ON smt_serial_numbers(batch_id);
CREATE INDEX IF NOT EXISTS idx_smt_serial_batch_activity_batch ON smt_serial_batch_activity_logs(batch_id);
