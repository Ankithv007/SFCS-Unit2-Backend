-- Migration: 051_add_work_order_side_to_stencil_checkout.sql
-- Purpose: Add Work Order side reference columns to stencil_rack_locations and stencil_rack_movement_history

ALTER TABLE stencil_rack_locations ADD COLUMN IF NOT EXISTS checked_out_work_order_side VARCHAR(50);
ALTER TABLE stencil_rack_movement_history ADD COLUMN IF NOT EXISTS work_order_side VARCHAR(50);
