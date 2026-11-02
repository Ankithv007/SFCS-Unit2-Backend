-- Migration: 006_add_stencil_rack_system_pages.sql
-- Purpose: Add Stencil Rack Management and Stencil Scan to system_pages table.

INSERT INTO system_pages (module_name, page_name, permission_key, route_path, display_order, icon, page_type, parent_module, is_active)
VALUES 
('SMT', 'Stencil Rack Management', 'smt_stencil_rack', '/smt/stencil/rack', 68, 'Layers', 'PAGE', 'SMT', TRUE),
('SMT', 'Stencil Scan', 'smt_stencil_scan', '/smt/stencil/scan', 69, 'Barcode', 'PAGE', 'SMT', TRUE)
ON CONFLICT (permission_key) DO UPDATE 
SET module_name = EXCLUDED.module_name,
    page_name = EXCLUDED.page_name,
    route_path = EXCLUDED.route_path,
    display_order = EXCLUDED.display_order,
    icon = EXCLUDED.icon,
    page_type = EXCLUDED.page_type,
    parent_module = EXCLUDED.parent_module,
    is_active = TRUE,
    updated_at = NOW();
