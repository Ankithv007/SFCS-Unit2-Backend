-- Migration 011: Remove QC Inspection and Vacuum Leak Test system pages and permissions
DO $$
BEGIN
    -- 1. Remove department permission mappings associated with QC Inspection and Vacuum Leak Test
    DELETE FROM department_permissions
    WHERE system_page_id IN (
        SELECT id FROM system_pages
        WHERE permission_key IN ('qc_inspection', 'qc_shifts', 'vacuum_leak_test', 'qc.inspection', 'qc.shifts', 'qc.vacuum-leak-test')
           OR route_path IN ('/qc-inspection', '/qc-inspection/shifts', '/vacuum-leak-test')
    );

    -- 2. Remove the system pages themselves from system_pages table
    DELETE FROM system_pages
    WHERE permission_key IN ('qc_inspection', 'qc_shifts', 'vacuum_leak_test', 'qc.inspection', 'qc.shifts', 'qc.vacuum-leak-test')
       OR route_path IN ('/qc-inspection', '/qc-inspection/shifts', '/vacuum-leak-test');

    RAISE NOTICE 'Successfully purged QC Inspection and Vacuum Leak Test system pages and permissions.';
END;
$$ LANGUAGE plpgsql;
