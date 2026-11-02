-- Migration: 048_drop_stencil_master.sql
-- Purpose: Permanently remove the legacy stencil_master table.
-- 
-- Context:
--   The Stencil Rack Management module (stencil_rack_locations) is now the
--   single source of truth for all stencil data.
--   All application controllers have been migrated from stencil_master to
--   stencil_rack_locations before this migration was created.
--
-- Safety verified:
--   - No foreign key references from any other table point to stencil_master.
--   - stencil_master had 6 legacy rows which are no longer required.
--   - smt_stencil_lifecycle.stencil_record_id now references stencil_rack_locations.id
--   - smt_stencil_lifecycle_states.stencil_record_id now references stencil_rack_locations.id

DROP TABLE IF EXISTS stencil_master CASCADE;
