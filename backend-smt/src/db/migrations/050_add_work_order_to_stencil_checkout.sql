-- Migration: 050_add_work_order_to_stencil_checkout.sql
-- Purpose: Add Work Order reference columns to stencil_rack_locations and stencil_rack_movement_history

ALTER TABLE stencil_rack_locations ADD COLUMN IF NOT EXISTS checked_out_work_order_id VARCHAR(255);
ALTER TABLE stencil_rack_locations ADD COLUMN IF NOT EXISTS checked_out_work_order_number VARCHAR(255);
ALTER TABLE stencil_rack_locations ADD COLUMN IF NOT EXISTS checked_out_machine VARCHAR(255);
ALTER TABLE stencil_rack_locations ADD COLUMN IF NOT EXISTS checked_out_line VARCHAR(255);
ALTER TABLE stencil_rack_locations ADD COLUMN IF NOT EXISTS checked_out_remarks TEXT;

ALTER TABLE stencil_rack_movement_history ADD COLUMN IF NOT EXISTS work_order_id VARCHAR(255);
ALTER TABLE stencil_rack_movement_history ADD COLUMN IF NOT EXISTS work_order_number VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_stencil_rack_mv_hist_wo ON stencil_rack_movement_history(work_order_number);
