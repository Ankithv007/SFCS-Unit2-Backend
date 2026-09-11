-- Migration: 007_add_spi_system_page.sql
-- Purpose: Add SPI to system_pages table in SMT module.

INSERT INTO system_pages (module_name, page_name, permission_key, route_path, parent_module, display_order, icon, page_type, is_active)
VALUES ('SMT', 'SPI', 'smt_spi', '/smt/spi', 'SMT', 55, 'Eye', 'PAGE', TRUE)
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
