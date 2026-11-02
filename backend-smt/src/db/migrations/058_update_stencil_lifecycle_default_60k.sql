-- Migration 058: Update all existing stencil lifecycle records and defaults from 100,000 to 60,000
UPDATE smt_stencil_lifecycle
SET target_life_cycle = 60000,
    balance_life_cycle = GREATEST(0, 60000 - COALESCE(current_used_life_cycle, 0))
WHERE target_life_cycle = 100000 OR balance_life_cycle = 100000;

UPDATE smt_stencil_lifecycle_states
SET target_life_cycle = 60000,
    current_cycle_capacity = 60000
WHERE target_life_cycle = 100000 OR current_cycle_capacity = 100000;
