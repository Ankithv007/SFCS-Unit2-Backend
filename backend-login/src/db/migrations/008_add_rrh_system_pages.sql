-- Migration: 008_add_rrh_system_pages.sql
-- Purpose: Add RRH module permissions to system_pages table.

INSERT INTO system_pages (module_name, page_name, permission_key, route_path, parent_module, display_order, icon, page_type, is_active)
VALUES
    ('RRH', 'Work Order', 'rrh_work_order', '/rrh/work-order', 'RRH', 94, 'Clipboard', 'PAGE', TRUE),
    ('RRH', 'Inward', 'rrh_inward', '/rrh/inward', 'RRH', 95, 'ArrowDownRight', 'PAGE', TRUE),
    ('RRH', 'IVI', 'rrh_ivi', '/rrh/ivi', 'RRH', 96, 'Eye', 'PAGE', TRUE),
    ('RRH', 'IPQC', 'rrh_ipqc', '/rrh/ipqc', 'RRH', 97, 'ShieldCheck', 'PAGE', TRUE),
    ('RRH', 'Debug', 'rrh_debug', '/rrh/debug', 'RRH', 98, 'Bug', 'PAGE', TRUE),
    ('RRH', 'Testing', 'rrh_testing', '/rrh/testing', 'RRH', 99, 'Play', 'PAGE', TRUE),
    ('RRH', 'FQC', 'rrh_fqc', '/rrh/fqc', 'RRH', 100, 'Award', 'PAGE', TRUE),
    ('RRH', 'OBA', 'rrh_oba', '/rrh/oba', 'RRH', 101, 'PackageSearch', 'PAGE', TRUE),
    ('RRH', 'Packaging Outgoing Data', 'rrh_packaging_outgoing_data', '/rrh/packaging-outgoing-data', 'RRH', 102, 'Package', 'PAGE', TRUE)
ON CONFLICT (permission_key) DO UPDATE
SET module_name = EXCLUDED.module_name,
    page_name = EXCLUDED.page_name,
    route_path = EXCLUDED.route_path,
    parent_module = EXCLUDED.parent_module,
    display_order = EXCLUDED.display_order,
    icon = EXCLUDED.icon,
    page_type = EXCLUDED.page_type,
    is_active = TRUE,
    updated_at = NOW();
