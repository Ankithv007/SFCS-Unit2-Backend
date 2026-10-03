-- Migration 009: Add missing indexes for performance-critical query paths
-- Safe to run multiple times (all use IF NOT EXISTS)

-- rrh_inward_sessions: frequently JOINed by work_order_id, filtered by status
CREATE INDEX IF NOT EXISTS idx_rrh_inward_sessions_wo_id
    ON rrh_inward_sessions(work_order_id);

CREATE INDEX IF NOT EXISTS idx_rrh_inward_sessions_active
    ON rrh_inward_sessions(work_order_id, status) WHERE is_deleted = false;

-- rrh_inward_scans: cross-session lookups by work_order_id and status filter
CREATE INDEX IF NOT EXISTS idx_rrh_inward_scans_wo_id
    ON rrh_inward_scans(work_order_id);

CREATE INDEX IF NOT EXISTS idx_rrh_inward_scans_status
    ON rrh_inward_scans(status) WHERE is_deleted = false;

-- rrh_inward_scans: lookup by matched_inventory_id (used in scan assignment queries)
CREATE INDEX IF NOT EXISTS idx_rrh_inward_scans_matched_inventory
    ON rrh_inward_scans(matched_inventory_id) WHERE matched_inventory_id IS NOT NULL;

-- rrh_inventory: critical for masterCheck queries (JOIN by import_id, NOT IN by band_serial_no)
CREATE INDEX IF NOT EXISTS idx_rrh_inventory_import_id
    ON rrh_inventory(import_id);

CREATE INDEX IF NOT EXISTS idx_rrh_inventory_band_serial_no
    ON rrh_inventory(band_serial_no);

-- rrh_excel structural tables: speeds up the master view pagination and cell fetch queries
CREATE INDEX IF NOT EXISTS idx_rrh_excel_sheets_import_id
    ON rrh_excel_sheets(import_id);

CREATE INDEX IF NOT EXISTS idx_rrh_excel_rows_sheet_row_num
    ON rrh_excel_rows(sheet_id, row_number);

CREATE INDEX IF NOT EXISTS idx_rrh_excel_cells_row_id
    ON rrh_excel_cells(row_id);

-- rrh_existing_inventory / rrh_replaced_inventory: lookup by inventory_id
CREATE INDEX IF NOT EXISTS idx_rrh_existing_inventory_inv_id
    ON rrh_existing_inventory(inventory_id);

CREATE INDEX IF NOT EXISTS idx_rrh_replaced_inventory_inv_id
    ON rrh_replaced_inventory(inventory_id);
