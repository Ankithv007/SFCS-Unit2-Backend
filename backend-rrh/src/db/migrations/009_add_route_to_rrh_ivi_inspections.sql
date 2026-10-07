-- Migration 009: Add route column to rrh_ivi_inspections
-- Tracks whether inspection is routed to ECN (IPQC) or Non-ECN

DO $$
BEGIN
    ALTER TABLE rrh_ivi_inspections ADD COLUMN IF NOT EXISTS route VARCHAR(50) DEFAULT 'ECN';
END $$;

CREATE INDEX IF NOT EXISTS idx_rrh_ivi_inspections_route_status 
ON rrh_ivi_inspections(work_order_id, route, status) 
WHERE is_deleted = false;
