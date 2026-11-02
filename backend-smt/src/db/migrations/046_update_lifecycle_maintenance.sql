-- Drop old foreign key constraint pointing to stencil_master
ALTER TABLE smt_stencil_lifecycle DROP CONSTRAINT IF EXISTS smt_stencil_lifecycle_stencil_record_id_fkey;

-- Automatically create missing stencil rack locations for any referenced stencils in lifecycle
INSERT INTO stencil_rack_locations (
    id,
    row_number,
    column_number,
    location_code,
    status,
    job_number,
    stencil_rack_number,
    stencil_name,
    revision,
    thickness_mills,
    manufacturing_date,
    side,
    remarks
)
SELECT 
    gen_random_uuid(),
    1,
    1,
    'TEMP-' || l.stencil_id,
    'STORED',
    'LEGACY-JOB-' || gen_random_uuid(), -- Ensure 100% unique job_number to avoid unique constraint violations
    l.stencil_id,
    COALESCE(NULLIF(l.stencil_name, ''), l.stencil_id),
    'A',
    0.00,
    CURRENT_DATE,
    'TOP',
    'Automatically migrated from legacy lifecycle data'
FROM (
    SELECT DISTINCT ON (stencil_id) stencil_id, stencil_name 
    FROM smt_stencil_lifecycle
) l
LEFT JOIN stencil_rack_locations loc ON LOWER(TRIM(l.stencil_id)) = LOWER(TRIM(loc.stencil_rack_number))
WHERE loc.id IS NULL;

-- Map existing lifecycle assignments to stencil_rack_locations if matching by stencil_rack_number / stencil_id
UPDATE smt_stencil_lifecycle l
SET stencil_record_id = loc.id
FROM stencil_rack_locations loc
WHERE LOWER(TRIM(l.stencil_id)) = LOWER(TRIM(loc.stencil_rack_number));

-- Delete orphan lifecycle records that cannot be mapped to stencil_rack_locations
DELETE FROM smt_stencil_lifecycle
WHERE stencil_record_id NOT IN (SELECT id FROM stencil_rack_locations);

-- Add new foreign key constraint pointing to stencil_rack_locations(id)
ALTER TABLE smt_stencil_lifecycle
ADD CONSTRAINT smt_stencil_lifecycle_stencil_record_id_fkey
FOREIGN KEY (stencil_record_id) REFERENCES stencil_rack_locations(id) ON DELETE RESTRICT;

-- Create smt_stencil_lifecycle_states table
CREATE TABLE IF NOT EXISTS smt_stencil_lifecycle_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stencil_record_id UUID UNIQUE NOT NULL REFERENCES stencil_rack_locations(id) ON DELETE RESTRICT,
    stencil_rack_number VARCHAR(100) UNIQUE NOT NULL,
    target_life_cycle INTEGER NOT NULL DEFAULT 60000,
    lifecycle_status VARCHAR(50) DEFAULT 'ACTIVE' CHECK (lifecycle_status IN ('ACTIVE', 'MAINTENANCE', 'SCRAPPED')),
    maintenance_count INTEGER DEFAULT 0,
    last_maintenance_date TIMESTAMP NULL,
    last_maintenance_by_code VARCHAR(100) NULL,
    last_maintenance_by_name VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by VARCHAR(100) NULL,
    created_by_name VARCHAR(255) NULL,
    updated_by VARCHAR(100) NULL,
    updated_by_name VARCHAR(255) NULL
);

-- Create smt_stencil_maintenance_history table
CREATE TABLE IF NOT EXISTS smt_stencil_maintenance_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stencil_rack_number VARCHAR(100) NOT NULL,
    job_number VARCHAR(100) NULL,
    maintenance_count INTEGER NOT NULL,
    previous_print_count INTEGER NOT NULL,
    reset_print_count INTEGER NOT NULL DEFAULT 0,
    lifecycle_status_before VARCHAR(50) NOT NULL,
    lifecycle_status_after VARCHAR(50) NOT NULL,
    maintenance_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    performed_by_code VARCHAR(100) NOT NULL,
    performed_by_name VARCHAR(255) NOT NULL,
    performed_department VARCHAR(100) NULL,
    performed_machine VARCHAR(100) NULL,
    remarks TEXT NULL,
    action VARCHAR(50) NOT NULL CHECK (action IN ('Maintenance Completed', 'Scrapped'))
);

-- Create smt_stencil_lifecycle_status_history table
CREATE TABLE IF NOT EXISTS smt_stencil_lifecycle_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stencil_rack_number VARCHAR(100) NOT NULL,
    previous_status VARCHAR(50) NULL,
    new_status VARCHAR(50) NOT NULL,
    changed_by_code VARCHAR(100) NOT NULL,
    changed_by_name VARCHAR(255) NOT NULL,
    reason VARCHAR(255) NOT NULL,
    remarks TEXT NOT NULL,
    changed_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Optimize Production Indexes
CREATE INDEX IF NOT EXISTS idx_smt_stencil_lifecycle_states_rack_num ON smt_stencil_lifecycle_states(stencil_rack_number);
CREATE INDEX IF NOT EXISTS idx_smt_stencil_lifecycle_states_record_id ON smt_stencil_lifecycle_states(stencil_record_id);
CREATE INDEX IF NOT EXISTS idx_smt_stencil_lifecycle_states_status ON smt_stencil_lifecycle_states(lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_smt_stencil_maintenance_history_rack_num ON smt_stencil_maintenance_history(stencil_rack_number);
CREATE INDEX IF NOT EXISTS idx_smt_stencil_lifecycle_record_id ON smt_stencil_lifecycle(stencil_record_id);
CREATE INDEX IF NOT EXISTS idx_smt_stencil_lifecycle_work_order_id ON smt_stencil_lifecycle(work_order_id);
CREATE INDEX IF NOT EXISTS idx_smt_stencil_status_history_rack_num ON smt_stencil_lifecycle_status_history(stencil_rack_number);
