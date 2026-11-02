-- =====================================================================================
-- Migration Down 035: Revert to Migration 034 archival & restoration logic
-- =====================================================================================

BEGIN;

-- Revert archive_closed_work_orders_history to Migration 033/034 version
CREATE OR REPLACE FUNCTION archive_closed_work_orders_history(p_retention_days INT DEFAULT 180, p_max_orders INT DEFAULT 5)
RETURNS INTEGER AS $$
DECLARE
    v_archived_orders INTEGER := 0;
    v_live_count INTEGER;
    v_archive_count INTEGER;
    r_wo RECORD;
BEGIN
    FOR r_wo IN (
        SELECT id, work_order_id
        FROM rrh_work_orders
        WHERE status IN ('COMPLETED', 'CLOSED')
          AND updated_at < (CURRENT_TIMESTAMP - (p_retention_days || ' days')::INTERVAL)
        ORDER BY updated_at ASC
        LIMIT p_max_orders
        FOR UPDATE SKIP LOCKED
    ) LOOP
        UPDATE rrh_inward_scans SET work_order_internal_id = r_wo.id WHERE work_order_internal_id IS NULL AND UPPER(TRIM(work_order_id)) = UPPER(TRIM(r_wo.work_order_id));
        UPDATE rrh_ivi_inspections SET work_order_internal_id = r_wo.id WHERE work_order_internal_id IS NULL AND UPPER(TRIM(work_order_id)) = UPPER(TRIM(r_wo.work_order_id));
        UPDATE rrh_ipqc_inspections SET work_order_internal_id = r_wo.id WHERE work_order_internal_id IS NULL AND UPPER(TRIM(work_order_id)) = UPPER(TRIM(r_wo.work_order_id));
        UPDATE rrh_programming_inspections SET work_order_internal_id = r_wo.id WHERE work_order_internal_id IS NULL AND UPPER(TRIM(work_order_id)) = UPPER(TRIM(r_wo.work_order_id));
        UPDATE rrh_pre_burn_in_inspections SET work_order_internal_id = r_wo.id WHERE work_order_internal_id IS NULL AND UPPER(TRIM(work_order_id)) = UPPER(TRIM(r_wo.work_order_id));
        UPDATE rrh_hipot_inspections SET work_order_internal_id = r_wo.id WHERE work_order_internal_id IS NULL AND UPPER(TRIM(work_order_id)) = UPPER(TRIM(r_wo.work_order_id));
        UPDATE rrh_post_burn_in_inspections SET work_order_internal_id = r_wo.id WHERE work_order_internal_id IS NULL AND UPPER(TRIM(work_order_id)) = UPPER(TRIM(r_wo.work_order_id));

        -- Post-Burn-In
        INSERT INTO rrh_post_burn_in_inspections_archive (
            id, session_id, work_order_id, serial_number, band_serial_no, physical_serial_number, physical_tpn,
            band, inspection_date, e_label, pam_tpn, pam1, pam2, pam3, pam4, rfpc_tpn, rfpc_sl_no,
            status, remarks, scanned_by, scanned_at, hipot_inspection_id, pre_burn_in_inspection_id,
            programming_inspection_id, ipqc_inspection_id, ivi_inspection_id, checkpoints,
            is_reinspected, defect_fixed, sl_no, debug_status, debug_remarks, debug_by, debug_at,
            updated_at, is_deleted, work_order_internal_id, superseded_by_id, superseded_at, archived_at
        )
        SELECT 
            id, session_id, work_order_id, serial_number, band_serial_no, physical_serial_number, physical_tpn,
            band, inspection_date, e_label, pam_tpn, pam1, pam2, pam3, pam4, rfpc_tpn, rfpc_sl_no,
            status, remarks, scanned_by, scanned_at, hipot_inspection_id, pre_burn_in_inspection_id,
            programming_inspection_id, ipqc_inspection_id, ivi_inspection_id, checkpoints,
            is_reinspected, defect_fixed, sl_no, debug_status, debug_remarks, debug_by, debug_at,
            updated_at, is_deleted, work_order_internal_id, superseded_by_id, superseded_at, CURRENT_TIMESTAMP
        FROM rrh_post_burn_in_inspections
        WHERE work_order_internal_id = r_wo.id
        ON CONFLICT (id) DO UPDATE SET updated_at = EXCLUDED.updated_at, archived_at = CURRENT_TIMESTAMP;

        DELETE FROM rrh_post_burn_in_inspections WHERE work_order_internal_id = r_wo.id;

        -- Inward Scans
        INSERT INTO rrh_inward_scans_archive (
            id, rrh_inward_session_id, work_order_id, serial_number, original_serial_number,
            corrected_serial_number, physical_tpn, band_serial_no, matched_inventory_id,
            status, remark, repair_remark, repair_time, repaired_by, scanned_by, scanned_at,
            is_deleted, sl_no, updated_at, work_order_internal_id, archived_at
        )
        SELECT 
            id, rrh_inward_session_id, work_order_id, serial_number, original_serial_number,
            corrected_serial_number, physical_tpn, band_serial_no, matched_inventory_id,
            status, remark, repair_remark, repair_time, repaired_by, scanned_by, scanned_at,
            is_deleted, sl_no, updated_at, work_order_internal_id, CURRENT_TIMESTAMP
        FROM rrh_inward_scans
        WHERE work_order_internal_id = r_wo.id
        ON CONFLICT (id) DO UPDATE SET updated_at = EXCLUDED.updated_at, archived_at = CURRENT_TIMESTAMP;

        DELETE FROM rrh_inward_scans WHERE work_order_internal_id = r_wo.id;

        UPDATE rrh_work_orders SET status = 'ARCHIVED', archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = r_wo.id;
        v_archived_orders := v_archived_orders + 1;
    END LOOP;
    RETURN v_archived_orders;
END;
$$ LANGUAGE plpgsql;

COMMIT;
