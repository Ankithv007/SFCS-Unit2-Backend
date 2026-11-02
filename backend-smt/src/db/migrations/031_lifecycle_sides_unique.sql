-- Migration to update Stencil Lifecycle uniqueness constraint to work_order_id + sides (registered side)
DROP INDEX IF EXISTS idx_lifecycle_stencil_wo;

CREATE UNIQUE INDEX IF NOT EXISTS idx_lifecycle_wo_sides 
ON smt_stencil_lifecycle(work_order_id, sides) 
WHERE is_deleted = false;
