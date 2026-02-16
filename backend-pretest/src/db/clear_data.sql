-- DANGER: This script will permanently delete all production data
-- Use only for testing/resetting the environment

BEGIN;

-- Disable triggers to avoid issues with immutability if any (though we usually truncate)
-- However, truncate usually bypasses triggers unless they are for truncate.

-- Clear Stage Tables (Child records first)
TRUNCATE TABLE warehouse_scans CASCADE;
TRUNCATE TABLE iqc_components CASCADE;
TRUNCATE TABLE impedance_scans CASCADE;
TRUNCATE TABLE pre_calibration_scans CASCADE;
TRUNCATE TABLE pre_aclr_scans CASCADE;

-- Clear Batch/Session Tables
TRUNCATE TABLE warehouse_batches CASCADE;
TRUNCATE TABLE iqc_batches CASCADE;
TRUNCATE TABLE impedance_sessions CASCADE;

-- Clear Central Audit Log
-- Note: barcode_stage_history has a prevent_modifications trigger.
-- Truncate bypasses STATEMENT triggers but not necessarily ROW triggers depending on version.
-- However, we can use DELETE if truncate is blocked, but TRUNCATE is usually fine for a reset.
TRUNCATE TABLE barcode_stage_history CASCADE;

COMMIT;

-- Re-seed essential master data if any was deleted by mistake (ACLR test cases)
-- Actually, aclr_test_case_master should NOT be truncated unless explicitly asked.
-- I will keep aclr_test_case_master and jig_master intact as they are "configuration".
