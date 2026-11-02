-- Migration 049: Add multi-cycle tracking and detailed capacity columns for Stencil Lifecycle Management

-- 1. Add cycle tracking columns to smt_stencil_lifecycle_states
ALTER TABLE smt_stencil_lifecycle_states
    ADD COLUMN IF NOT EXISTS cycle_number INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS current_cycle_capacity INTEGER NOT NULL DEFAULT 60000,
    ADD COLUMN IF NOT EXISTS total_lifetime_prints BIGINT NOT NULL DEFAULT 0;

-- 2. Add detailed cycle usage columns to smt_stencil_lifecycle
ALTER TABLE smt_stencil_lifecycle
    ADD COLUMN IF NOT EXISTS cycle_number INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS previous_used_prints INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS quantity_added INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS new_used_prints INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS previous_remaining_prints INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS new_remaining_prints INTEGER NOT NULL DEFAULT 0;

-- 3. Add maintenance cycle and capacity columns to smt_stencil_maintenance_history
ALTER TABLE smt_stencil_maintenance_history
    ADD COLUMN IF NOT EXISTS maintenance_cycle_number INTEGER NULL,
    ADD COLUMN IF NOT EXISTS previous_lifecycle_capacity INTEGER NULL,
    ADD COLUMN IF NOT EXISTS previous_used_prints INTEGER NULL,
    ADD COLUMN IF NOT EXISTS additional_lifecycle_capacity INTEGER NULL,
    ADD COLUMN IF NOT EXISTS maintenance_reason VARCHAR(100) NULL;
