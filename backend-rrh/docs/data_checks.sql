-- ====================================================================================================
-- RRH DATABASE INTEGRITY & METRIC DIAGNOSTIC SCRIPT (data_checks.sql)
-- READ-ONLY: Safe to run on any PostgreSQL environment (Staging / Production).
-- Purpose: Collects baseline structural integrity, orphaned records, duplicates, status cardinalities,
--          field length distributions, table bloat/sizes, and index usage metrics.
-- ====================================================================================================

-- ----------------------------------------------------------------------------------------------------
-- 1. ORPHANED WORK ORDER IDS
-- Check for child records referencing non-existent work orders
-- ----------------------------------------------------------------------------------------------------
-- 1a. Imports referencing non-existent work orders
SELECT 'orphan_excel_imports' AS check_name, COUNT(*) AS orphan_count
FROM rrh_excel_imports i
LEFT JOIN rrh_work_orders w ON i.work_order_id = w.id
WHERE w.id IS NULL;

-- 1b. Inward sessions referencing non-existent work order strings
SELECT 'orphan_inward_sessions' AS check_name, COUNT(*) AS orphan_count
FROM rrh_inward_sessions s
LEFT JOIN rrh_work_orders w ON s.work_order_id = w.work_order_id
WHERE w.work_order_id IS NULL;

-- 1c. IVI sessions referencing non-existent work order strings
SELECT 'orphan_ivi_sessions' AS check_name, COUNT(*) AS orphan_count
FROM rrh_ivi_sessions iv
LEFT JOIN rrh_work_orders w ON iv.work_order_id = w.work_order_id
WHERE w.work_order_id IS NULL;

-- 1d. Inward scans referencing non-existent sessions
SELECT 'orphan_inward_scans' AS check_name, COUNT(*) AS orphan_count
FROM rrh_inward_scans sc
LEFT JOIN rrh_inward_sessions s ON sc.rrh_inward_session_id = s.id
WHERE s.id IS NULL;

-- 1e. IVI inspections referencing non-existent IVI sessions
SELECT 'orphan_ivi_inspections' AS check_name, COUNT(*) AS orphan_count
FROM rrh_ivi_inspections insp
LEFT JOIN rrh_ivi_sessions iv ON insp.session_id = iv.id
WHERE iv.id IS NULL;

-- ----------------------------------------------------------------------------------------------------
-- 2. DUPLICATE INWARD SCANS
-- Check for duplicate serial numbers scanned within the same active/live session
-- ----------------------------------------------------------------------------------------------------
SELECT 
    rrh_inward_session_id, 
    TRIM(serial_number) AS serial_number, 
    COUNT(*) AS scan_count,
    ARRAY_AGG(id ORDER BY id) AS scan_ids,
    ARRAY_AGG(status ORDER BY id) AS statuses
FROM rrh_inward_scans
WHERE is_deleted = false
GROUP BY rrh_inward_session_id, TRIM(serial_number)
HAVING COUNT(*) > 1;

-- ----------------------------------------------------------------------------------------------------
-- 3. CROSS-SESSION MASTER CONSUMPTION
-- Check if the same inventory_id has been consumed across multiple distinct sessions
-- (Helps evaluate whether master inventory consumption is globally one-time or per-session)
-- ----------------------------------------------------------------------------------------------------
SELECT 
    inventory_id, 
    COUNT(DISTINCT session_id) AS session_count,
    ARRAY_AGG(DISTINCT session_id) AS session_ids,
    COUNT(*) AS total_consumption_records
FROM rrh_inward_session_master_consumption
GROUP BY inventory_id
HAVING COUNT(DISTINCT session_id) > 1;

-- ----------------------------------------------------------------------------------------------------
-- 4. DUPLICATE MASTER INVENTORY IDENTIFIERS
-- Check for duplicate (import_id, sl_no) or (import_id, band_serial_no) within the same import
-- ----------------------------------------------------------------------------------------------------
-- 4a. Duplicate SL No within an import
SELECT 
    import_id, 
    UPPER(TRIM(sl_no)) AS sl_no, 
    COUNT(*) AS duplicate_count,
    ARRAY_AGG(id ORDER BY id) AS inventory_ids
FROM rrh_inventory
WHERE sl_no IS NOT NULL AND TRIM(sl_no) != ''
GROUP BY import_id, UPPER(TRIM(sl_no))
HAVING COUNT(*) > 1;

-- 4b. Duplicate Band Serial No within an import
SELECT 
    import_id, 
    UPPER(TRIM(band_serial_no)) AS band_serial_no, 
    COUNT(*) AS duplicate_count,
    ARRAY_AGG(id ORDER BY id) AS inventory_ids
FROM rrh_inventory
WHERE band_serial_no IS NOT NULL AND TRIM(band_serial_no) != ''
GROUP BY import_id, UPPER(TRIM(band_serial_no))
HAVING COUNT(*) > 1;

-- ----------------------------------------------------------------------------------------------------
-- 5. STRUCTURAL DUPLICATES (REVISIONS, ROWS, CELLS)
-- ----------------------------------------------------------------------------------------------------
-- 5a. Duplicate (work_order_id, revision) in rrh_excel_imports
SELECT 
    work_order_id, 
    revision, 
    COUNT(*) AS count,
    ARRAY_AGG(id) AS import_ids
FROM rrh_excel_imports
GROUP BY work_order_id, revision
HAVING COUNT(*) > 1;

-- 5b. Duplicate (sheet_id, row_number) in rrh_excel_rows
SELECT 
    sheet_id, 
    row_number, 
    COUNT(*) AS count
FROM rrh_excel_rows
GROUP BY sheet_id, row_number
HAVING COUNT(*) > 1;

-- 5c. Duplicate (row_id, column_number) in rrh_excel_cells
SELECT 
    row_id, 
    column_number, 
    COUNT(*) AS count
FROM rrh_excel_cells
GROUP BY row_id, column_number
HAVING COUNT(*) > 1;

-- ----------------------------------------------------------------------------------------------------
-- 6. DISTINCT STATUS VALUES & CARDINALITY ACROSS ALL TABLES
-- ----------------------------------------------------------------------------------------------------
SELECT 'rrh_work_orders' AS table_name, status, COUNT(*) AS count 
FROM rrh_work_orders GROUP BY status
UNION ALL
SELECT 'rrh_excel_imports' AS table_name, status, COUNT(*) AS count 
FROM rrh_excel_imports GROUP BY status
UNION ALL
SELECT 'rrh_inward_sessions' AS table_name, status, COUNT(*) AS count 
FROM rrh_inward_sessions GROUP BY status
UNION ALL
SELECT 'rrh_inward_scans' AS table_name, status, COUNT(*) AS count 
FROM rrh_inward_scans GROUP BY status
UNION ALL
SELECT 'rrh_ivi_sessions' AS table_name, status, COUNT(*) AS count 
FROM rrh_ivi_sessions GROUP BY status
UNION ALL
SELECT 'rrh_ivi_inspections' AS table_name, status, COUNT(*) AS count 
FROM rrh_ivi_inspections GROUP BY status;

-- ----------------------------------------------------------------------------------------------------
-- 7. WORK ORDER DATE VALUES & FORMATS (wo_date / work_order_date / date)
-- ----------------------------------------------------------------------------------------------------
-- 7a. rrh_ivi_inspections.wo_date value patterns
SELECT 
    wo_date, 
    COUNT(*) AS occurrences,
    CASE 
        WHEN wo_date IS NULL THEN 'NULL'
        WHEN wo_date ~ '^\d{4}-\d{2}-\d{2}$' THEN 'ISO Date (YYYY-MM-DD)'
        WHEN wo_date ~ '^\d{2}/\d{2}/\d{4}$' THEN 'Slash Date (DD/MM/YYYY or MM/DD/YYYY)'
        WHEN wo_date ~ '^\d{2}-\d{2}-\d{4}$' THEN 'Hyphen Date (DD-MM-YYYY)'
        ELSE 'Non-Standard / String Text'
    END AS format_category
FROM rrh_ivi_inspections
GROUP BY wo_date, format_category
ORDER BY occurrences DESC
LIMIT 50;

-- 7b. rrh_work_orders date vs work_order_date consistency
SELECT 
    COUNT(*) AS total_wos,
    COUNT(work_order_date) AS non_null_work_order_date,
    COUNT(date) AS non_null_date,
    COUNT(CASE WHEN work_order_date IS DISTINCT FROM date THEN 1 END) AS differing_date_count
FROM rrh_work_orders;

-- ----------------------------------------------------------------------------------------------------
-- 8. MAXIMUM FIELD LENGTHS FOR THE 32 MASTER DATA COLUMNS
-- ----------------------------------------------------------------------------------------------------
SELECT
    -- Base Inventory (1..14)
    MAX(LENGTH(sl_no)) AS max_len_sl_no,
    MAX(LENGTH(tejas_dc_no)) AS max_len_tejas_dc_no,
    MAX(LENGTH(tejas_obd_no)) AS max_len_tejas_obd_no,
    MAX(LENGTH(physical_tpn)) AS max_len_physical_tpn,
    MAX(LENGTH(band_serial_no)) AS max_len_band_serial_no,
    MAX(LENGTH(pr_no)) AS max_len_pr_no,
    MAX(LENGTH(invoice_rma_no)) AS max_len_invoice_rma_no,
    MAX(LENGTH(vendor_name_for_rework)) AS max_len_vendor_name,
    MAX(LENGTH(coordinator_name)) AS max_len_coordinator_name,
    MAX(LENGTH(lot)) AS max_len_lot,
    MAX(LENGTH(remarks)) AS max_len_remarks,
    MAX(LENGTH(failure_description)) AS max_len_failure_description,
    MAX(LENGTH(remarks_2)) AS max_len_remarks_2
FROM rrh_inventory;

SELECT
    -- Existing Inventory (15..24)
    MAX(LENGTH(rfpc_no)) AS max_len_rfpc_no,
    MAX(LENGTH(pam0_sl_no)) AS max_len_pam0_sl_no,
    MAX(LENGTH(pam1_sl_no)) AS max_len_pam1_sl_no,
    MAX(LENGTH(pam2_sl_no)) AS max_len_pam2_sl_no,
    MAX(LENGTH(pam3_sl_no)) AS max_len_pam3_sl_no,
    MAX(LENGTH(lna_sl_no)) AS max_len_lna_sl_no,
    MAX(LENGTH(rfpc_model_no)) AS max_len_rfpc_model_no,
    MAX(LENGTH(sw_version)) AS max_len_sw_version,
    MAX(LENGTH(sfp0_serial_no)) AS max_len_sfp0_serial_no,
    MAX(LENGTH(sfp1_serial_no)) AS max_len_sfp1_serial_no
FROM rrh_existing_inventory;

SELECT
    -- Replaced Inventory (25..32)
    MAX(LENGTH(rfpc_no)) AS max_len_repl_rfpc_no,
    MAX(LENGTH(pam0_sl_no)) AS max_len_repl_pam0_sl_no,
    MAX(LENGTH(pam1_sl_no)) AS max_len_repl_pam1_sl_no,
    MAX(LENGTH(pam2_sl_no)) AS max_len_repl_pam2_sl_no,
    MAX(LENGTH(pam3_sl_no)) AS max_len_repl_pam3_sl_no,
    MAX(LENGTH(lna_sl_no)) AS max_len_repl_lna_sl_no,
    MAX(LENGTH(sfp0_serial_no)) AS max_len_repl_sfp0_serial_no,
    MAX(LENGTH(sfp1_serial_no)) AS max_len_repl_sfp1_serial_no
FROM rrh_replaced_inventory;

-- ----------------------------------------------------------------------------------------------------
-- 9. TABLE AND INDEX SIZES (PHYSICAL DISK FOOTPRINT)
-- ----------------------------------------------------------------------------------------------------
SELECT 
    relname AS table_name,
    pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
    pg_size_pretty(pg_relation_size(relid)) AS table_size,
    pg_size_pretty(pg_total_relation_size(relid) - pg_relation_size(relid)) AS index_and_toast_size,
    n_live_tup AS estimated_row_count
FROM pg_stat_user_tables
WHERE relname LIKE 'rrh_%'
ORDER BY pg_total_relation_size(relid) DESC;

-- ----------------------------------------------------------------------------------------------------
-- 10. UNUSED AND UNDERUTILIZED INDEXES
-- ----------------------------------------------------------------------------------------------------
SELECT 
    relname AS table_name,
    indexrelname AS index_name,
    idx_scan AS number_of_scans,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE relname LIKE 'rrh_%'
ORDER BY idx_scan ASC, pg_relation_size(indexrelid) DESC;
