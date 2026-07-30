-- Migration: 004_sync_active_system_pages.sql
-- Purpose: Cleanly synchronize system pages configuration, merge duplicate keys, preserve department permissions, and ensure correct permission keys.

CREATE OR REPLACE FUNCTION sync_system_pages_run() RETURNS void AS $$
DECLARE
    r RECORD;
    new_page_id INT;
    old_page_id INT;
BEGIN
    -- 1. Create temporary table with the exact active frontend system pages config
    CREATE TEMP TABLE target_pages (
        permission_key VARCHAR(100) UNIQUE,
        module_name VARCHAR(100),
        page_name VARCHAR(255),
        route_path VARCHAR(255),
        parent_module VARCHAR(100),
        display_order INT,
        icon VARCHAR(100),
        page_type VARCHAR(50),
        old_key VARCHAR(100)
    ) ON COMMIT DROP;

    -- 2. Populate target pages config matching routes.tsx
    INSERT INTO target_pages (permission_key, module_name, page_name, route_path, parent_module, display_order, icon, page_type, old_key) VALUES
    ('dashboard', 'Dashboard', 'Dashboard', '/dashboard', NULL, 1, 'LayoutDashboard', 'PAGE', 'core.dashboard'),
    ('admin_panel', 'Administration', 'Admin Panel', '/admin-panel', NULL, 2, 'Settings', 'PAGE', 'core.admin-panel'),
    
    ('qc_inspection', 'QC Inspection', 'QC Inspection', '/qc-inspection', 'QC Inspection', 10, 'ClipboardCheck', 'PAGE', 'qc.inspection'),
    ('qc_shifts', 'QC Inspection', 'Shift Management', '/qc-inspection/shifts', 'QC Inspection', 11, 'Clock', 'PAGE', 'qc.shifts'),
    
    ('inv_purchase_order', 'Inventory', 'Purchase Order', '/purchase-order', 'Inventory', 20, 'FileText', 'PAGE', 'inventory.purchase-order'),
    ('inv_wip_stack', 'Inventory', 'WIP Stack', '/wip-stack', 'Inventory', 21, 'Layers', 'PAGE', 'inventory.wip-stack'),
    ('inv_return_wip', 'Inventory', 'Return WIP', '/return-wip', 'Inventory', 22, 'RotateCcw', 'PAGE', 'inventory.return-wip'),
    ('inv_report', 'Inventory', 'Report', '/report', 'Inventory', 23, 'BarChart2', 'PAGE', 'inventory.report'),
    
    ('pre_warehouse', 'Pre Testing', 'Warehouse', '/pre-testing/warehouse', 'Pre Testing', 30, 'Home', 'PAGE', 'pretesting.warehouse'),
    ('pre_iqc', 'Pre Testing', 'IQC', '/pre-testing/iqc', 'Pre Testing', 31, 'CheckSquare', 'PAGE', 'pretesting.pre-iqc'),
    ('pre_impedance', 'Pre Testing', 'Impedance', '/pre-testing/impedance', 'Pre Testing', 32, 'Activity', 'PAGE', 'pretesting.pre-impedance'),
    ('pre_calibration', 'Pre Testing', 'Calibration', '/pre-testing/calibration', 'Pre Testing', 33, 'Sliders', 'PAGE', 'pretesting.pre-calibration'),
    ('pre_aclr', 'Pre Testing', 'Pre-ACLR', '/pre-testing/pre-aclr', 'Pre Testing', 34, 'Radio', 'PAGE', 'pretesting.pre-aclr'),
    ('pre_trace', 'Pre Testing', 'Trace', '/pre-testing/trace', 'Pre Testing', 35, 'GitCommit', 'PAGE', 'pretesting.trace'),
    
    ('vacuum_leak_test', 'Vacuum Leak Test', 'Vacuum Leak Test', '/vacuum-leak-test', NULL, 40, 'Wind', 'PAGE', 'qc.vacuum-leak-test'),
    ('bom_split', 'BOM Split', 'BOM Split', '/bom-split', NULL, 45, 'Split', 'PAGE', NULL),
    
    ('smt_dashboard', 'SMT', 'SMT Dashboard', '/smt', 'SMT', 50, 'Cpu', 'PAGE', NULL),
    ('smt_work_order', 'SMT', 'Work Order', '/smt/work-order', 'SMT', 51, 'Clipboard', 'PAGE', 'smt.work-order'),
    ('smt_work_order_history', 'SMT', 'Work Order History', '/smt/workorder-history', 'SMT', 52, 'History', 'PAGE', 'smt.workorder-history'),
    ('smt_serial_number', 'SMT', 'Serial Number', '/smt/serial-number', 'SMT', 53, 'Barcode', 'PAGE', 'smt.serial-number'),
    ('smt_printing', 'SMT', 'Printing', '/smt/printing', 'SMT', 54, 'Printer', 'PAGE', 'smt.printing'),
    ('smt_solder_paste', 'SMT', 'Solder Paste Management', '/smt/solder-paste', 'SMT', 55, 'Database', 'PAGE', 'smt.solder-paste'),
    ('smt_pre_aoi', 'SMT', 'Pre AOI', '/smt/pre-aoi', 'SMT', 56, 'Eye', 'PAGE', 'smt.pre-aoi'),
    ('smt_post_aoi', 'SMT', 'Post AOI', '/smt/post-aoi', 'SMT', 57, 'CheckCircle', 'PAGE', 'smt.post-aoi'),
    ('smt_rework', 'SMT', 'Rework', '/smt/rework', 'SMT', 58, 'Wrench', 'PAGE', 'smt.rework'),
    ('smt_fg', 'SMT', 'SMT FG', '/smt/smt-fg', 'SMT', 59, 'Package', 'PAGE', 'smt.smt-fg'),
    ('smt_track_items', 'SMT', 'Track Items', '/smt/track-items', 'SMT', 60, 'List', 'PAGE', 'smt.track-items'),
    ('smt_downtime', 'SMT', 'Downtime Tracker', '/smt/downtime-tracker', 'SMT', 61, 'AlertTriangle', 'PAGE', 'smt.downtime-tracker'),
    ('smt_qms', 'SMT', 'Document Process', '/smt/qms', 'SMT', 62, 'File', 'PAGE', 'smt.qms'),
    ('smt_material_mgmt', 'SMT', 'Material Management', '/smt/material-management', 'SMT', 63, 'Box', 'PAGE', 'smt.material-management'),
    ('smt_msd_tracker', 'SMT', 'MSD Tracker', '/smt/msd-tracker', 'SMT', 64, 'Thermometer', 'PAGE', 'smt.msd-tracker'),
    ('smt_stencil_master', 'SMT', 'Stencil Master Record', '/smt/stencil/master', 'SMT', 65, 'Layers', 'PAGE', 'smt.stencil-master'),
    ('smt_stencil_lifecycle', 'SMT', 'Stencil Lifecycle', '/smt/stencil/lifecycle', 'SMT', 66, 'RefreshCw', 'PAGE', 'smt.stencil-lifecycle'),
    ('smt_baking_tracking', 'SMT', 'Baking Tracking Record', '/smt/baking-tracking', 'SMT', 67, 'Flame', 'PAGE', 'smt.baking-tracking'),
    
    ('backend_dashboard', 'Backend', 'Backend Dashboard', '/backend', 'Backend', 80, 'Cpu', 'PAGE', NULL),
    ('backend_work_order', 'Backend', 'Work Order', '/backend/work-order', 'Backend', 81, 'Clipboard', 'PAGE', 'backend.work-order'),
    ('backend_pth', 'Backend', 'PTH', '/backend/pth', 'Backend', 82, 'Anchor', 'PAGE', 'backend.pth'),
    ('backend_vi', 'Backend', 'VI', '/backend/vi', 'Backend', 83, 'Eye', 'PAGE', 'backend.vi'),
    ('backend_qa', 'Backend', 'QA', '/backend/qa', 'Backend', 84, 'CheckCircle', 'PAGE', 'backend.qa'),
    ('backend_flashing', 'Backend', 'Flashing', '/backend/flashing', 'Backend', 85, 'Zap', 'PAGE', 'backend.flashing'),
    ('backend_pcba_fct', 'Backend', 'PCBA-FCT', '/backend/pcba-fct', 'Backend', 86, 'Trello', 'PAGE', 'backend.pcba-fct'),
    ('backend_assembly', 'Backend', 'Assembly', '/backend/assembly', 'Backend', 87, 'Box', 'PAGE', 'backend.assembly'),
    ('backend_unit_testing', 'Backend', 'Unit Testing', '/backend/unit-testing', 'Backend', 88, 'Play', 'PAGE', 'backend.unit-testing'),
    ('backend_qi', 'Backend', 'QI', '/backend/qi', 'Backend', 89, 'ShieldCheck', 'PAGE', 'backend.qi'),
    ('backend_packing', 'Backend', 'Packing', '/backend/packing', 'Backend', 90, 'Package', 'PAGE', 'backend.packing'),
    ('backend_rework', 'Backend', 'Rework', '/backend/rework', 'Backend', 91, 'Wrench', 'PAGE', 'backend.rework'),
    ('backend_debug', 'Backend', 'Debug', '/backend/debug', 'Backend', 92, 'Bug', 'PAGE', 'backend.debug'),
    ('backend_track_items', 'Backend', 'Track Items', '/backend/track-items', 'Backend', 93, 'List', 'PAGE', 'backend.track-items');

    -- 3. Loop through targets to merge/update
    FOR r IN SELECT * FROM target_pages LOOP
        -- Case A: Both new_key and old_key exist in the database (duplicate records)
        IF EXISTS (SELECT 1 FROM system_pages WHERE permission_key = r.permission_key) AND
           r.old_key IS NOT NULL AND
           EXISTS (SELECT 1 FROM system_pages WHERE permission_key = r.old_key) THEN
            
            SELECT id INTO new_page_id FROM system_pages WHERE permission_key = r.permission_key;
            SELECT id INTO old_page_id FROM system_pages WHERE permission_key = r.old_key;

            IF new_page_id <> old_page_id THEN
                RAISE NOTICE 'Merging duplicate system pages: % (id: %) and % (id: %)', r.old_key, old_page_id, r.permission_key, new_page_id;

                -- Migrate department permissions to new page id where department doesn't already have them
                UPDATE department_permissions dp_old
                SET system_page_id = new_page_id
                WHERE dp_old.system_page_id = old_page_id
                  AND NOT EXISTS (
                      SELECT 1 FROM department_permissions dp_new
                      WHERE dp_new.department_id = dp_old.department_id
                        AND dp_new.system_page_id = new_page_id
                  );

                -- Delete remaining duplicate department permissions
                DELETE FROM department_permissions WHERE system_page_id = old_page_id;

                -- Delete the old page record
                DELETE FROM system_pages WHERE id = old_page_id;
            END IF;

            -- Update the new page record with latest details
            UPDATE system_pages SET
                module_name = r.module_name,
                page_name = r.page_name,
                route_path = r.route_path,
                parent_module = r.parent_module,
                display_order = r.display_order,
                icon = r.icon,
                page_type = r.page_type,
                is_active = TRUE,
                updated_at = NOW()
            WHERE id = new_page_id;

        -- Case B: The old_key exists but new_key does NOT (Clean rename/update)
        ELSIF r.old_key IS NOT NULL AND EXISTS (SELECT 1 FROM system_pages WHERE permission_key = r.old_key) THEN
            RAISE NOTICE 'Renaming system page key from % to %', r.old_key, r.permission_key;
            
            UPDATE system_pages SET
                permission_key = r.permission_key,
                module_name = r.module_name,
                page_name = r.page_name,
                route_path = r.route_path,
                parent_module = r.parent_module,
                display_order = r.display_order,
                icon = r.icon,
                page_type = r.page_type,
                is_active = TRUE,
                updated_at = NOW()
            WHERE permission_key = r.old_key;

        -- Case C: The new_key already exists but old_key does not (Simple update)
        ELSIF EXISTS (SELECT 1 FROM system_pages WHERE permission_key = r.permission_key) THEN
            UPDATE system_pages SET
                module_name = r.module_name,
                page_name = r.page_name,
                route_path = r.route_path,
                parent_module = r.parent_module,
                display_order = r.display_order,
                icon = r.icon,
                page_type = r.page_type,
                is_active = TRUE,
                updated_at = NOW()
            WHERE permission_key = r.permission_key;

        -- Case D: Neither exists (Fresh insert)
        ELSE
            RAISE NOTICE 'Inserting new system page: %', r.permission_key;
            
            INSERT INTO system_pages (module_name, page_name, permission_key, route_path, parent_module, display_order, icon, page_type, is_active, created_at, updated_at)
            VALUES (r.module_name, r.page_name, r.permission_key, r.route_path, r.parent_module, r.display_order, r.icon, r.page_type, TRUE, NOW(), NOW());
        END IF;
    END LOOP;

    -- 4. Mark all pages not in target_pages as inactive
    UPDATE system_pages 
    SET is_active = FALSE, updated_at = NOW() 
    WHERE permission_key NOT IN (SELECT permission_key FROM target_pages);
    
END;
$$ LANGUAGE plpgsql;

SELECT sync_system_pages_run();
DROP FUNCTION sync_system_pages_run();
