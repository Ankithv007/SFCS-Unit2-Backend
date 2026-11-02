-- Migration: 064_add_blocking_to_stencil_rack_locations.sql
-- Purpose: Add authoritative blocking status and audit columns to stencil records
-- Safety: Non-blocking ALTER TABLE with DEFAULT FALSE NOT NULL for PostgreSQL 15

ALTER TABLE stencil_rack_locations 
ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT FALSE NOT NULL,
ADD COLUMN IF NOT EXISTS blocked_reason TEXT NULL,
ADD COLUMN IF NOT EXISTS blocked_by_code VARCHAR(100) NULL,
ADD COLUMN IF NOT EXISTS blocked_by_name VARCHAR(255) NULL,
ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMP NULL;

-- Fast index for active/unblocked lookups
CREATE INDEX IF NOT EXISTS idx_stencil_rack_locations_blocking 
ON stencil_rack_locations(is_blocked) 
WHERE status <> 'EMPTY';
