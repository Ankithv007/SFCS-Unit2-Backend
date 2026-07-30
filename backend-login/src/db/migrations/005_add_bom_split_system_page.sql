-- Migration: 005_add_bom_split_system_page.sql
-- Purpose: Add BOM Split to system_pages table.

INSERT INTO system_pages (module_name, page_name, permission_key, route_path, display_order, icon, page_type, is_active)
VALUES ('BOM Split', 'BOM Split', 'bom_split', '/bom-split', 45, 'Split', 'PAGE', TRUE)
ON CONFLICT (permission_key) DO UPDATE 
SET module_name = EXCLUDED.module_name,
    page_name = EXCLUDED.page_name,
    route_path = EXCLUDED.route_path,
    display_order = EXCLUDED.display_order,
    icon = EXCLUDED.icon,
    page_type = EXCLUDED.page_type,
    is_active = TRUE,
    updated_at = NOW();
