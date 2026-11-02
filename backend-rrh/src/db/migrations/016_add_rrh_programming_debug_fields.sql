-- Migration: 016_add_rrh_programming_debug_fields.sql
-- Description: Add debug status, remarks, and audit fields to rrh_programming_inspections

ALTER TABLE rrh_programming_inspections 
ADD COLUMN IF NOT EXISTS debug_status VARCHAR(50) DEFAULT 'PENDING',
ADD COLUMN IF NOT EXISTS debug_remarks TEXT,
ADD COLUMN IF NOT EXISTS debug_by VARCHAR(255),
ADD COLUMN IF NOT EXISTS debug_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_rrh_prog_debug_status ON rrh_programming_inspections(session_id, debug_status) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_prog_debug_wo ON rrh_programming_inspections(work_order_id, debug_status) WHERE is_deleted = false;
