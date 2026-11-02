-- Migration: 020_physical_serial_latency_indexes.sql
-- Description: Add uppercase trimmed functional index on physical_serial_number for ultra-low latency lookups across IPQC and Programming

CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_upper_phys_serial 
ON rrh_ipqc_inspections(UPPER(TRIM(COALESCE(physical_serial_number, '')))) 
WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_rrh_prog_upper_phys_serial 
ON rrh_programming_inspections(UPPER(TRIM(COALESCE(physical_serial_number, '')))) 
WHERE is_deleted = false;
