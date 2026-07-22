-- Migration: 003_system_pages_and_foreign_keys.sql
-- Purpose: Add permission versioning, create system_pages table, map permissions, alter tables, drop legacy text fields.

-- 1. Extend Users Table with permission versioning
ALTER TABLE users ADD COLUMN IF NOT EXISTS permission_version INT DEFAULT 1;

-- 2. Create System Pages Table
CREATE TABLE IF NOT EXISTS system_pages (
    id SERIAL PRIMARY KEY,
    module_name VARCHAR(100) NOT NULL,
    page_name VARCHAR(255) NOT NULL,
    permission_key VARCHAR(100) UNIQUE NOT NULL,
    route_path VARCHAR(255) NOT NULL,
    parent_module VARCHAR(100),
    display_order INT DEFAULT 0,
    icon VARCHAR(100),
    page_type VARCHAR(50) DEFAULT 'PAGE', -- MODULE, PAGE, HIDDEN
    is_active BOOLEAN DEFAULT TRUE,
    last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by INT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Seed Default Pages (To migrate existing permissions safely)
INSERT INTO system_pages (module_name, page_name, permission_key, route_path, page_type) VALUES
('Core', 'Home Dashboard', 'core.dashboard', '/dashboard', 'PAGE'),
('Core', 'Admin Panel', 'core.admin-panel', '/admin-panel', 'PAGE'),
('SMT Production', 'Work Order', 'smt.work-order', '/smt/work-order', 'PAGE'),
('SMT Production', 'Work Order History', 'smt.workorder-history', '/smt/workorder-history', 'PAGE'),
('SMT Production', 'Serial Generation', 'smt.serial-number', '/smt/serial-number', 'PAGE'),
('SMT Production', 'Printing', 'smt.printing', '/smt/printing', 'PAGE'),
('SMT Production', 'Solder Paste Management', 'smt.solder-paste', '/smt/solder-paste', 'PAGE'),
('SMT Production', 'Pre AOI', 'smt.pre-aoi', '/smt/pre-aoi', 'PAGE'),
('SMT Production', 'Post AOI', 'smt.post-aoi', '/smt/post-aoi', 'PAGE'),
('SMT Production', 'Rework', 'smt.rework', '/smt/rework', 'PAGE'),
('SMT Production', 'SMT FG', 'smt.smt-fg', '/smt/smt-fg', 'PAGE'),
('SMT Production', 'Track Items', 'smt.track-items', '/smt/track-items', 'PAGE'),
('SMT Production', 'Downtime Tracker', 'smt.downtime-tracker', '/smt/downtime-tracker', 'PAGE'),
('SMT Production', 'Document Process', 'smt.qms', '/smt/qms', 'PAGE'),
('SMT Production', 'Material Mgmt', 'smt.material-management', '/smt/material-management', 'PAGE'),
('SMT Production', 'MSD Tracker', 'smt.msd-tracker', '/smt/msd-tracker', 'PAGE'),
('SMT Production', 'Stencil Master Record', 'smt.stencil-master', '/smt/stencil/master', 'PAGE'),
('SMT Production', 'Life Cycle Management', 'smt.stencil-lifecycle', '/smt/stencil/lifecycle', 'PAGE'),
('SMT Production', 'Baking Tracking Record', 'smt.baking-tracking', '/smt/baking-tracking', 'PAGE'),
('Backend Assembly', 'Work Order', 'backend.work-order', '/backend/work-order', 'PAGE'),
('Backend Assembly', 'PTH', 'backend.pth', '/backend/pth', 'PAGE'),
('Backend Assembly', 'VI', 'backend.vi', '/backend/vi', 'PAGE'),
('Backend Assembly', 'QA', 'backend.qa', '/backend/qa', 'PAGE'),
('Backend Assembly', 'Flashing', 'backend.flashing', '/backend/flashing', 'PAGE'),
('Backend Assembly', 'PCBA-FCT', 'backend.pcba-fct', '/backend/pcba-fct', 'PAGE'),
('Backend Assembly', 'Assembly', 'backend.assembly', '/backend/assembly', 'PAGE'),
('Backend Assembly', 'Unit Testing', 'backend.unit-testing', '/backend/unit-testing', 'PAGE'),
('Backend Assembly', 'QI', 'backend.qi', '/backend/qi', 'PAGE'),
('Backend Assembly', 'Packing', 'backend.packing', '/backend/packing', 'PAGE'),
('Backend Assembly', 'Rework', 'backend.rework', '/backend/rework', 'PAGE'),
('Backend Assembly', 'Debug', 'backend.debug', '/backend/debug', 'PAGE'),
('Backend Assembly', 'Track Items', 'backend.track-items', '/backend/track-items', 'PAGE'),
('Pre Testing (E2E)', 'Warehouse', 'pretesting.warehouse', '/pre-testing/warehouse', 'PAGE'),
('Pre Testing (E2E)', 'Pre-IQC', 'pretesting.pre-iqc', '/pre-testing/iqc', 'PAGE'),
('Pre Testing (E2E)', 'Pre-Impedance', 'pretesting.pre-impedance', '/pre-testing/impedance', 'PAGE'),
('Pre Testing (E2E)', 'Pre-Calibration', 'pretesting.pre-calibration', '/pre-testing/calibration', 'PAGE'),
('Pre Testing (E2E)', 'Pre-ACLR', 'pretesting.pre-aclr', '/pre-testing/pre-aclr', 'PAGE'),
('Pre Testing (E2E)', 'Trace', 'pretesting.trace', '/pre-testing/trace', 'PAGE'),
('Quality & Inventory', 'QC Inspection', 'qc.inspection', '/qc-inspection', 'PAGE'),
('Quality & Inventory', 'QC Shift Management', 'qc.shifts', '/qc-inspection/shifts', 'PAGE'),
('Quality & Inventory', 'Vacuum Leak Test', 'qc.vacuum-leak-test', '/vacuum-leak-test', 'PAGE'),
('Quality & Inventory', 'Purchase Order', 'inventory.purchase-order', '/purchase-order', 'PAGE'),
('Quality & Inventory', 'WIP Stack', 'inventory.wip-stack', '/wip-stack', 'PAGE'),
('Quality & Inventory', 'Return From WIP', 'inventory.return-wip', '/return-wip', 'PAGE'),
('Quality & Inventory', 'Report', 'inventory.report', '/report', 'PAGE')
ON CONFLICT (permission_key) DO UPDATE
SET route_path = EXCLUDED.route_path,
    module_name = EXCLUDED.module_name,
    page_name = EXCLUDED.page_name;

-- 4. Alter department_permissions to add reference to system_pages
ALTER TABLE department_permissions ADD COLUMN IF NOT EXISTS system_page_id INT REFERENCES system_pages(id) ON DELETE CASCADE;

-- 5. Migrate old text permissions to system_page_id references
UPDATE department_permissions dp
SET system_page_id = sp.id
FROM system_pages sp
WHERE sp.route_path = dp.page OR LOWER(sp.route_path) = LOWER(dp.page);

-- 6. Clean up orphaned permission rows (to enforce relational integrity)
DELETE FROM department_permissions WHERE system_page_id IS NULL;

-- 7. Apply NOT NULL and UNIQUE constraint on system_page_id
ALTER TABLE department_permissions ALTER COLUMN system_page_id SET NOT NULL;

-- Drop old unique constraint from 001 migration if exists
ALTER TABLE department_permissions DROP CONSTRAINT IF EXISTS department_permissions_department_id_page_key;

-- Add new unique constraint
ALTER TABLE department_permissions ADD CONSTRAINT department_permissions_dept_page_unique UNIQUE (department_id, system_page_id);

-- 8. Drop legacy text columns
ALTER TABLE department_permissions DROP COLUMN IF EXISTS module;
ALTER TABLE department_permissions DROP COLUMN IF EXISTS page;
