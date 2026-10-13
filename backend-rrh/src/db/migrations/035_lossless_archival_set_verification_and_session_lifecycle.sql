-- =====================================================================================
-- Migration 035: Lossless Archival Set Verification, Conflict Defense & Session Lifecycle
-- Description:
--   1. Replaces junior row-count proxies (v_archive_count < v_live_count) with exact
--      set-difference verification (NOT EXISTS (SELECT 1 FROM archive WHERE a.id = l.id)),
--      mathematically guaranteeing 100% ID presence before live deletions.
--   2. Adds strict conflict validation on archive insertion:
--      WHERE archive.work_order_internal_id = EXCLUDED.work_order_internal_id
--      blocking cross-work-order data overwrites.
--   3. Preserves BOM inventory consumption lineage:
--      Explicitly copies and deletes rrh_inward_session_master_consumption before scans
--      are deleted, preventing scan_id from being mutated to NULL by ON DELETE SET NULL.
--   4. Eliminates zombie sessions:
--      Automatically marks all stage sessions for an archived order as 'ARCHIVED'.
--   5. Full bi-directional restoration:
--      Restores inventory consumption and resets stage sessions back to 'Completed'.
--   6. Per-work-order subtransactions (SAVEPOINT):
--      Isolates individual work order errors so one corrupt record does not abort
--      the entire archival batch.
-- =====================================================================================

BEGIN;

CREATE OR REPLACE FUNCTION archive_closed_work_orders_history(p_retention_days INT DEFAULT 180, p_max_orders INT DEFAULT 5)
RETURNS INTEGER AS $$
DECLARE
    v_archived_orders INTEGER := 0;
    r_wo RECORD;
BEGIN
    FOR r_wo IN (
        SELECT id, work_order_id
        FROM rrh_work_orders
        WHERE status IN ('COMPLETED', 'CLOSED')
          AND updated_at <= (CURRENT_TIMESTAMP - (p_retention_days || ' days')::INTERVAL)
        ORDER BY updated_at ASC
        LIMIT p_max_orders
        FOR UPDATE SKIP LOCKED
    ) LOOP
        BEGIN
            -- Ensure any unlinked legacy child rows are bound to r_wo.id before archiving
            UPDATE rrh_inward_scans SET work_order_internal_id = r_wo.id WHERE work_order_internal_id IS NULL AND UPPER(TRIM(work_order_id)) = UPPER(TRIM(r_wo.work_order_id));
            UPDATE rrh_ivi_inspections SET work_order_internal_id = r_wo.id WHERE work_order_internal_id IS NULL AND UPPER(TRIM(work_order_id)) = UPPER(TRIM(r_wo.work_order_id));
            UPDATE rrh_ipqc_inspections SET work_order_internal_id = r_wo.id WHERE work_order_internal_id IS NULL AND UPPER(TRIM(work_order_id)) = UPPER(TRIM(r_wo.work_order_id));
            UPDATE rrh_programming_inspections SET work_order_internal_id = r_wo.id WHERE work_order_internal_id IS NULL AND UPPER(TRIM(work_order_id)) = UPPER(TRIM(r_wo.work_order_id));
            UPDATE rrh_pre_burn_in_inspections SET work_order_internal_id = r_wo.id WHERE work_order_internal_id IS NULL AND UPPER(TRIM(work_order_id)) = UPPER(TRIM(r_wo.work_order_id));
            UPDATE rrh_hipot_inspections SET work_order_internal_id = r_wo.id WHERE work_order_internal_id IS NULL AND UPPER(TRIM(work_order_id)) = UPPER(TRIM(r_wo.work_order_id));
            UPDATE rrh_post_burn_in_inspections SET work_order_internal_id = r_wo.id WHERE work_order_internal_id IS NULL AND UPPER(TRIM(work_order_id)) = UPPER(TRIM(r_wo.work_order_id));

            -- 1. STAGE 7: Post-Burn-In (Copy -> Strict Set Verify -> Delete)
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
            ON CONFLICT (id) DO UPDATE SET 
                updated_at = EXCLUDED.updated_at,
                archived_at = CURRENT_TIMESTAMP
            WHERE rrh_post_burn_in_inspections_archive.work_order_internal_id = EXCLUDED.work_order_internal_id;

            IF EXISTS (
                SELECT 1 FROM rrh_post_burn_in_inspections l
                WHERE l.work_order_internal_id = r_wo.id
                  AND NOT EXISTS (
                      SELECT 1 FROM rrh_post_burn_in_inspections_archive a WHERE a.id = l.id
                  )
            ) THEN
                RAISE EXCEPTION 'Data loss detected: Missing unarchived Post-Burn-In inspection IDs for work order %', r_wo.work_order_id;
            END IF;

            DELETE FROM rrh_post_burn_in_inspections WHERE work_order_internal_id = r_wo.id;

            -- 2. STAGE 6: Hipot (Copy -> Strict Set Verify -> Delete)
            INSERT INTO rrh_hipot_inspections_archive (
                id, session_id, work_order_id, serial_number, band_serial_no, physical_serial_number, physical_tpn,
                band, inspection_date, e_label, pam_tpn, pam1, pam2, pam3, pam4, rfpc_tpn, rfpc_sl_no,
                status, remarks, scanned_by, scanned_at, pre_burn_in_inspection_id, programming_inspection_id,
                ipqc_inspection_id, ivi_inspection_id, checkpoints, is_reinspected, defect_fixed, sl_no,
                debug_status, debug_remarks, debug_by, debug_at, updated_at, is_deleted, work_order_internal_id,
                superseded_by_id, superseded_at, archived_at
            )
            SELECT 
                id, session_id, work_order_id, serial_number, band_serial_no, physical_serial_number, physical_tpn,
                band, inspection_date, e_label, pam_tpn, pam1, pam2, pam3, pam4, rfpc_tpn, rfpc_sl_no,
                status, remarks, scanned_by, scanned_at, pre_burn_in_inspection_id, programming_inspection_id,
                ipqc_inspection_id, ivi_inspection_id, checkpoints, is_reinspected, defect_fixed, sl_no,
                debug_status, debug_remarks, debug_by, debug_at, updated_at, is_deleted, work_order_internal_id,
                superseded_by_id, superseded_at, CURRENT_TIMESTAMP
            FROM rrh_hipot_inspections
            WHERE work_order_internal_id = r_wo.id
            ON CONFLICT (id) DO UPDATE SET 
                updated_at = EXCLUDED.updated_at,
                archived_at = CURRENT_TIMESTAMP
            WHERE rrh_hipot_inspections_archive.work_order_internal_id = EXCLUDED.work_order_internal_id;

            IF EXISTS (
                SELECT 1 FROM rrh_hipot_inspections l
                WHERE l.work_order_internal_id = r_wo.id
                  AND NOT EXISTS (
                      SELECT 1 FROM rrh_hipot_inspections_archive a WHERE a.id = l.id
                  )
            ) THEN
                RAISE EXCEPTION 'Data loss detected: Missing unarchived Hipot inspection IDs for work order %', r_wo.work_order_id;
            END IF;

            DELETE FROM rrh_hipot_inspections WHERE work_order_internal_id = r_wo.id;

            -- 3. STAGE 5: Pre-Burn-In (Copy -> Strict Set Verify -> Delete)
            INSERT INTO rrh_pre_burn_in_inspections_archive (
                id, session_id, work_order_id, serial_number, band_serial_no, physical_serial_number, physical_tpn,
                band, inspection_date, e_label, pam_tpn, pam1, pam2, pam3, pam4, rfpc_tpn, rfpc_sl_no,
                status, remarks, scanned_by, scanned_at, programming_inspection_id, ipqc_inspection_id,
                ivi_inspection_id, checkpoints, is_reinspected, defect_fixed, sl_no, debug_status,
                debug_remarks, debug_by, debug_at, updated_at, is_deleted, work_order_internal_id,
                superseded_by_id, superseded_at, archived_at
            )
            SELECT 
                id, session_id, work_order_id, serial_number, band_serial_no, physical_serial_number, physical_tpn,
                band, inspection_date, e_label, pam_tpn, pam1, pam2, pam3, pam4, rfpc_tpn, rfpc_sl_no,
                status, remarks, scanned_by, scanned_at, programming_inspection_id, ipqc_inspection_id,
                ivi_inspection_id, checkpoints, is_reinspected, defect_fixed, sl_no, debug_status,
                debug_remarks, debug_by, debug_at, updated_at, is_deleted, work_order_internal_id,
                superseded_by_id, superseded_at, CURRENT_TIMESTAMP
            FROM rrh_pre_burn_in_inspections
            WHERE work_order_internal_id = r_wo.id
            ON CONFLICT (id) DO UPDATE SET 
                updated_at = EXCLUDED.updated_at,
                archived_at = CURRENT_TIMESTAMP
            WHERE rrh_pre_burn_in_inspections_archive.work_order_internal_id = EXCLUDED.work_order_internal_id;

            IF EXISTS (
                SELECT 1 FROM rrh_pre_burn_in_inspections l
                WHERE l.work_order_internal_id = r_wo.id
                  AND NOT EXISTS (
                      SELECT 1 FROM rrh_pre_burn_in_inspections_archive a WHERE a.id = l.id
                  )
            ) THEN
                RAISE EXCEPTION 'Data loss detected: Missing unarchived Pre-Burn-In inspection IDs for work order %', r_wo.work_order_id;
            END IF;

            DELETE FROM rrh_pre_burn_in_inspections WHERE work_order_internal_id = r_wo.id;

            -- 4. STAGE 4: Programming (Copy -> Strict Set Verify -> Delete)
            INSERT INTO rrh_programming_inspections_archive (
                id, session_id, work_order_id, serial_number, band_serial_no, physical_serial_number, physical_tpn,
                sl_no, band, e_label, pam_tpn, pam1, pam2, pam3, pam4, rfpc_tpn, rfpc_sl_no, firmware_version,
                mac_address, programming_status, status, remarks, scanned_by, scanned_at, updated_at,
                ipqc_inspection_id, is_reinspected, defect_fixed, is_deleted, debug_status, debug_remarks,
                debug_by, debug_at, inspection_date, ivi_inspection_id, checkpoints, work_order_internal_id,
                superseded_by_id, superseded_at, archived_at
            )
            SELECT 
                id, session_id, work_order_id, serial_number, band_serial_no, physical_serial_number, physical_tpn,
                sl_no, band, e_label, pam_tpn, pam1, pam2, pam3, pam4, rfpc_tpn, rfpc_sl_no, firmware_version,
                mac_address, programming_status, status, remarks, scanned_by, scanned_at, updated_at,
                ipqc_inspection_id, is_reinspected, defect_fixed, is_deleted, debug_status, debug_remarks,
                debug_by, debug_at, inspection_date, ivi_inspection_id, checkpoints, work_order_internal_id,
                superseded_by_id, superseded_at, CURRENT_TIMESTAMP
            FROM rrh_programming_inspections
            WHERE work_order_internal_id = r_wo.id
            ON CONFLICT (id) DO UPDATE SET 
                updated_at = EXCLUDED.updated_at,
                archived_at = CURRENT_TIMESTAMP
            WHERE rrh_programming_inspections_archive.work_order_internal_id = EXCLUDED.work_order_internal_id;

            IF EXISTS (
                SELECT 1 FROM rrh_programming_inspections l
                WHERE l.work_order_internal_id = r_wo.id
                  AND NOT EXISTS (
                      SELECT 1 FROM rrh_programming_inspections_archive a WHERE a.id = l.id
                  )
            ) THEN
                RAISE EXCEPTION 'Data loss detected: Missing unarchived Programming inspection IDs for work order %', r_wo.work_order_id;
            END IF;

            DELETE FROM rrh_programming_inspections WHERE work_order_internal_id = r_wo.id;

            -- 5. STAGE 3: IPQC (Copy -> Strict Set Verify -> Delete)
            INSERT INTO rrh_ipqc_inspections_archive (
                id, session_id, work_order_id, serial_number, band_serial_no, physical_serial_number, physical_tpn,
                band, inspection_date, e_label, pam_tpn, pam1, pam2, pam3, pam4, rfpc_tpn, rfpc_sl_no,
                status, remarks, scanned_by, scanned_at, updated_at, ivi_inspection_id, checkpoints,
                is_reinspected, defect_fixed, is_deleted, sl_no, work_order_internal_id,
                superseded_by_id, superseded_at, archived_at
            )
            SELECT 
                id, session_id, work_order_id, serial_number, band_serial_no, physical_serial_number, physical_tpn,
                band, inspection_date, e_label, pam_tpn, pam1, pam2, pam3, pam4, rfpc_tpn, rfpc_sl_no,
                status, remarks, scanned_by, scanned_at, updated_at, ivi_inspection_id, checkpoints,
                is_reinspected, defect_fixed, is_deleted, sl_no, work_order_internal_id,
                superseded_by_id, superseded_at, CURRENT_TIMESTAMP
            FROM rrh_ipqc_inspections
            WHERE work_order_internal_id = r_wo.id
            ON CONFLICT (id) DO UPDATE SET 
                updated_at = EXCLUDED.updated_at,
                archived_at = CURRENT_TIMESTAMP
            WHERE rrh_ipqc_inspections_archive.work_order_internal_id = EXCLUDED.work_order_internal_id;

            IF EXISTS (
                SELECT 1 FROM rrh_ipqc_inspections l
                WHERE l.work_order_internal_id = r_wo.id
                  AND NOT EXISTS (
                      SELECT 1 FROM rrh_ipqc_inspections_archive a WHERE a.id = l.id
                  )
            ) THEN
                RAISE EXCEPTION 'Data loss detected: Missing unarchived IPQC inspection IDs for work order %', r_wo.work_order_id;
            END IF;

            DELETE FROM rrh_ipqc_inspections WHERE work_order_internal_id = r_wo.id;

            -- 6. STAGE 2: IVI (Copy -> Strict Set Verify -> Delete)
            INSERT INTO rrh_ivi_inspections_archive (
                id, session_id, work_order_id, serial_number, tejas_dc_no, tejas_obd_no, bat_lot_no, physical_tpn,
                band, wo_date, duplexer_main, duplexer_part_no, rrh_unit, image_urls, status, remarks,
                scanned_by, scanned_at, is_deleted, inward_scan_id, band_serial_no, sl_no, checkpoints,
                is_reinspected, defect_fixed, updated_at, route, passed_to_next_stage, passed_to_next_stage_at,
                passed_to_next_stage_by, work_order_internal_id, superseded_by_id, superseded_at, archived_at
            )
            SELECT 
                id, session_id, work_order_id, serial_number, tejas_dc_no, tejas_obd_no, bat_lot_no, physical_tpn,
                band, wo_date, duplexer_main, duplexer_part_no, rrh_unit, image_urls, status, remarks,
                scanned_by, scanned_at, is_deleted, inward_scan_id, band_serial_no, sl_no, checkpoints,
                is_reinspected, defect_fixed, updated_at, route, passed_to_next_stage, passed_to_next_stage_at,
                passed_to_next_stage_by, work_order_internal_id, superseded_by_id, superseded_at, CURRENT_TIMESTAMP
            FROM rrh_ivi_inspections
            WHERE work_order_internal_id = r_wo.id
            ON CONFLICT (id) DO UPDATE SET 
                updated_at = EXCLUDED.updated_at,
                archived_at = CURRENT_TIMESTAMP
            WHERE rrh_ivi_inspections_archive.work_order_internal_id = EXCLUDED.work_order_internal_id;

            IF EXISTS (
                SELECT 1 FROM rrh_ivi_inspections l
                WHERE l.work_order_internal_id = r_wo.id
                  AND NOT EXISTS (
                      SELECT 1 FROM rrh_ivi_inspections_archive a WHERE a.id = l.id
                  )
            ) THEN
                RAISE EXCEPTION 'Data loss detected: Missing unarchived IVI inspection IDs for work order %', r_wo.work_order_id;
            END IF;

            DELETE FROM rrh_ivi_inspections WHERE work_order_internal_id = r_wo.id;

            -- 7. STAGE 1B: Archive Inventory Consumption & Delete Explicitly (Preserving Lineage)
            INSERT INTO rrh_inward_session_master_consumption_archive (
                id, session_id, inventory_id, scan_id, consumed_at, archived_at
            )
            SELECT c.id, c.session_id, c.inventory_id, c.scan_id, c.consumed_at, CURRENT_TIMESTAMP
            FROM rrh_inward_session_master_consumption c
            JOIN rrh_inward_scans s ON s.id = c.scan_id
            WHERE s.work_order_internal_id = r_wo.id
            ON CONFLICT (id) DO UPDATE SET 
                session_id = EXCLUDED.session_id,
                inventory_id = EXCLUDED.inventory_id,
                scan_id = EXCLUDED.scan_id,
                archived_at = CURRENT_TIMESTAMP;

            IF EXISTS (
                SELECT 1 FROM rrh_inward_session_master_consumption c
                JOIN rrh_inward_scans s ON s.id = c.scan_id
                WHERE s.work_order_internal_id = r_wo.id
                  AND NOT EXISTS (
                      SELECT 1 FROM rrh_inward_session_master_consumption_archive a WHERE a.id = c.id
                  )
            ) THEN
                RAISE EXCEPTION 'Data loss detected: Missing unarchived consumption IDs for work order %', r_wo.work_order_id;
            END IF;

            -- Explicitly delete live consumption rows BEFORE scans are removed so scan_id is NEVER nullified!
            DELETE FROM rrh_inward_session_master_consumption c
            USING rrh_inward_scans s
            WHERE s.id = c.scan_id AND s.work_order_internal_id = r_wo.id;

            -- 8. STAGE 1: Inward Scans (Copy -> Strict Set Verify -> Delete)
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
            ON CONFLICT (id) DO UPDATE SET 
                updated_at = EXCLUDED.updated_at,
                archived_at = CURRENT_TIMESTAMP
            WHERE rrh_inward_scans_archive.work_order_internal_id = EXCLUDED.work_order_internal_id;

            IF EXISTS (
                SELECT 1 FROM rrh_inward_scans l
                WHERE l.work_order_internal_id = r_wo.id
                  AND NOT EXISTS (
                      SELECT 1 FROM rrh_inward_scans_archive a WHERE a.id = l.id
                  )
            ) THEN
                RAISE EXCEPTION 'Data loss detected: Missing unarchived Inward scan IDs for work order %', r_wo.work_order_id;
            END IF;

            DELETE FROM rrh_inward_scans WHERE work_order_internal_id = r_wo.id;

            -- 9. Archive Sessions: Mark Stage Sessions as ARCHIVED so they do not linger as live zombies
            UPDATE rrh_inward_sessions SET status = 'ARCHIVED', updated_at = CURRENT_TIMESTAMP WHERE work_order_internal_id = r_wo.id AND status <> 'ARCHIVED';
            UPDATE rrh_ivi_sessions SET status = 'ARCHIVED', updated_at = CURRENT_TIMESTAMP WHERE work_order_internal_id = r_wo.id AND status <> 'ARCHIVED';
            UPDATE rrh_ipqc_sessions SET status = 'ARCHIVED', updated_at = CURRENT_TIMESTAMP WHERE work_order_internal_id = r_wo.id AND status <> 'ARCHIVED';
            UPDATE rrh_programming_sessions SET status = 'ARCHIVED', updated_at = CURRENT_TIMESTAMP WHERE work_order_internal_id = r_wo.id AND status <> 'ARCHIVED';
            UPDATE rrh_pre_burn_in_sessions SET status = 'ARCHIVED', updated_at = CURRENT_TIMESTAMP WHERE work_order_internal_id = r_wo.id AND status <> 'ARCHIVED';
            UPDATE rrh_hipot_sessions SET status = 'ARCHIVED', updated_at = CURRENT_TIMESTAMP WHERE work_order_internal_id = r_wo.id AND status <> 'ARCHIVED';
            UPDATE rrh_post_burn_in_sessions SET status = 'ARCHIVED', updated_at = CURRENT_TIMESTAMP WHERE work_order_internal_id = r_wo.id AND status <> 'ARCHIVED';

            -- 10. Finalize Work Order Archival State
            UPDATE rrh_work_orders 
            SET status = 'ARCHIVED', 
                archived_at = CURRENT_TIMESTAMP, 
                updated_at = CURRENT_TIMESTAMP 
            WHERE id = r_wo.id;

            v_archived_orders := v_archived_orders + 1;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'Archival failed for work order ID % (%): %', r_wo.id, r_wo.work_order_id, SQLERRM;
            -- Continue loop for remaining work orders in batch
        END;
    END LOOP;

    RETURN v_archived_orders;
END;
$$ LANGUAGE plpgsql;

-- Enhanced restore_archived_work_order
CREATE OR REPLACE FUNCTION restore_archived_work_order(p_work_order_id VARCHAR)
RETURNS INTEGER AS $$
DECLARE
    v_wo_id INT;
    v_restored_count INTEGER := 0;
BEGIN
    SELECT id INTO v_wo_id FROM rrh_work_orders WHERE UPPER(TRIM(work_order_id)) = UPPER(TRIM(p_work_order_id)) AND status = 'ARCHIVED';
    IF v_wo_id IS NULL THEN
        RAISE EXCEPTION 'Work order "%" not found in ARCHIVED status.', p_work_order_id;
    END IF;

    -- 1. Restore Inward Scans
    INSERT INTO rrh_inward_scans (
        id, rrh_inward_session_id, work_order_id, serial_number, original_serial_number,
        corrected_serial_number, physical_tpn, band_serial_no, matched_inventory_id,
        status, remark, repair_remark, repair_time, repaired_by, scanned_by, scanned_at,
        is_deleted, sl_no, updated_at, work_order_internal_id
    )
    SELECT 
        id, rrh_inward_session_id, work_order_id, serial_number, original_serial_number,
        corrected_serial_number, physical_tpn, band_serial_no, matched_inventory_id,
        status, remark, repair_remark, repair_time, repaired_by, scanned_by, scanned_at,
        is_deleted, sl_no, updated_at, work_order_internal_id
    FROM rrh_inward_scans_archive
    WHERE work_order_internal_id = v_wo_id
    ON CONFLICT (id) DO UPDATE SET updated_at = EXCLUDED.updated_at;

    DELETE FROM rrh_inward_scans_archive WHERE work_order_internal_id = v_wo_id;

    -- 1B. Restore Inventory Consumption Lineage
    INSERT INTO rrh_inward_session_master_consumption (
        id, session_id, inventory_id, scan_id, consumed_at
    )
    SELECT id, session_id, inventory_id, scan_id, consumed_at
    FROM rrh_inward_session_master_consumption_archive a
    WHERE EXISTS (
        SELECT 1 FROM rrh_inward_scans s WHERE s.id = a.scan_id AND s.work_order_internal_id = v_wo_id
    )
    ON CONFLICT (id) DO NOTHING;

    DELETE FROM rrh_inward_session_master_consumption_archive a
    WHERE EXISTS (
        SELECT 1 FROM rrh_inward_scans s WHERE s.id = a.scan_id AND s.work_order_internal_id = v_wo_id
    );

    -- 2. Restore IVI Inspections
    INSERT INTO rrh_ivi_inspections (
        id, session_id, work_order_id, serial_number, tejas_dc_no, tejas_obd_no, bat_lot_no, physical_tpn,
        band, wo_date, duplexer_main, duplexer_part_no, rrh_unit, image_urls, status, remarks,
        scanned_by, scanned_at, is_deleted, inward_scan_id, band_serial_no, sl_no, checkpoints,
        is_reinspected, defect_fixed, updated_at, route, passed_to_next_stage, passed_to_next_stage_at,
        passed_to_next_stage_by, work_order_internal_id, superseded_by_id, superseded_at
    )
    SELECT 
        id, session_id, work_order_id, serial_number, tejas_dc_no, tejas_obd_no, bat_lot_no, physical_tpn,
        band, wo_date, duplexer_main, duplexer_part_no, rrh_unit, image_urls, status, remarks,
        scanned_by, scanned_at, is_deleted, inward_scan_id, band_serial_no, sl_no, checkpoints,
        is_reinspected, defect_fixed, updated_at, route, passed_to_next_stage, passed_to_next_stage_at,
        passed_to_next_stage_by, work_order_internal_id, superseded_by_id, superseded_at
    FROM rrh_ivi_inspections_archive
    WHERE work_order_internal_id = v_wo_id
    ON CONFLICT (id) DO UPDATE SET updated_at = EXCLUDED.updated_at;

    DELETE FROM rrh_ivi_inspections_archive WHERE work_order_internal_id = v_wo_id;

    -- 3. Restore IPQC Inspections
    INSERT INTO rrh_ipqc_inspections (
        id, session_id, work_order_id, serial_number, band_serial_no, physical_serial_number, physical_tpn,
        band, inspection_date, e_label, pam_tpn, pam1, pam2, pam3, pam4, rfpc_tpn, rfpc_sl_no,
        status, remarks, scanned_by, scanned_at, updated_at, ivi_inspection_id, checkpoints,
        is_reinspected, defect_fixed, is_deleted, sl_no, work_order_internal_id,
        superseded_by_id, superseded_at
    )
    SELECT 
        id, session_id, work_order_id, serial_number, band_serial_no, physical_serial_number, physical_tpn,
        band, inspection_date, e_label, pam_tpn, pam1, pam2, pam3, pam4, rfpc_tpn, rfpc_sl_no,
        status, remarks, scanned_by, scanned_at, updated_at, ivi_inspection_id, checkpoints,
        is_reinspected, defect_fixed, is_deleted, sl_no, work_order_internal_id,
        superseded_by_id, superseded_at
    FROM rrh_ipqc_inspections_archive
    WHERE work_order_internal_id = v_wo_id
    ON CONFLICT (id) DO UPDATE SET updated_at = EXCLUDED.updated_at;

    DELETE FROM rrh_ipqc_inspections_archive WHERE work_order_internal_id = v_wo_id;

    -- 4. Restore Programming Inspections
    INSERT INTO rrh_programming_inspections (
        id, session_id, work_order_id, serial_number, band_serial_no, physical_serial_number, physical_tpn,
        sl_no, band, e_label, pam_tpn, pam1, pam2, pam3, pam4, rfpc_tpn, rfpc_sl_no, firmware_version,
        mac_address, programming_status, status, remarks, scanned_by, scanned_at, updated_at,
        ipqc_inspection_id, is_reinspected, defect_fixed, is_deleted, debug_status, debug_remarks,
        debug_by, debug_at, inspection_date, ivi_inspection_id, checkpoints, work_order_internal_id,
        superseded_by_id, superseded_at
    )
    SELECT 
        id, session_id, work_order_id, serial_number, band_serial_no, physical_serial_number, physical_tpn,
        sl_no, band, e_label, pam_tpn, pam1, pam2, pam3, pam4, rfpc_tpn, rfpc_sl_no, firmware_version,
        mac_address, programming_status, status, remarks, scanned_by, scanned_at, updated_at,
        ipqc_inspection_id, is_reinspected, defect_fixed, is_deleted, debug_status, debug_remarks,
        debug_by, debug_at, inspection_date, ivi_inspection_id, checkpoints, work_order_internal_id,
        superseded_by_id, superseded_at
    FROM rrh_programming_inspections_archive
    WHERE work_order_internal_id = v_wo_id
    ON CONFLICT (id) DO UPDATE SET updated_at = EXCLUDED.updated_at;

    DELETE FROM rrh_programming_inspections_archive WHERE work_order_internal_id = v_wo_id;

    -- 5. Restore Pre-Burn-In Inspections
    INSERT INTO rrh_pre_burn_in_inspections (
        id, session_id, work_order_id, serial_number, band_serial_no, physical_serial_number, physical_tpn,
        band, inspection_date, e_label, pam_tpn, pam1, pam2, pam3, pam4, rfpc_tpn, rfpc_sl_no,
        status, remarks, scanned_by, scanned_at, programming_inspection_id, ipqc_inspection_id,
        ivi_inspection_id, checkpoints, is_reinspected, defect_fixed, sl_no, debug_status,
        debug_remarks, debug_by, debug_at, updated_at, is_deleted, work_order_internal_id,
        superseded_by_id, superseded_at
    )
    SELECT 
        id, session_id, work_order_id, serial_number, band_serial_no, physical_serial_number, physical_tpn,
        band, inspection_date, e_label, pam_tpn, pam1, pam2, pam3, pam4, rfpc_tpn, rfpc_sl_no,
        status, remarks, scanned_by, scanned_at, programming_inspection_id, ipqc_inspection_id,
        ivi_inspection_id, checkpoints, is_reinspected, defect_fixed, sl_no, debug_status,
        debug_remarks, debug_by, debug_at, updated_at, is_deleted, work_order_internal_id,
        superseded_by_id, superseded_at
    FROM rrh_pre_burn_in_inspections_archive
    WHERE work_order_internal_id = v_wo_id
    ON CONFLICT (id) DO UPDATE SET updated_at = EXCLUDED.updated_at;

    DELETE FROM rrh_pre_burn_in_inspections_archive WHERE work_order_internal_id = v_wo_id;

    -- 6. Restore Hipot Inspections
    INSERT INTO rrh_hipot_inspections (
        id, session_id, work_order_id, serial_number, band_serial_no, physical_serial_number, physical_tpn,
        band, inspection_date, e_label, pam_tpn, pam1, pam2, pam3, pam4, rfpc_tpn, rfpc_sl_no,
        status, remarks, scanned_by, scanned_at, pre_burn_in_inspection_id, programming_inspection_id,
        ipqc_inspection_id, ivi_inspection_id, checkpoints, is_reinspected, defect_fixed, sl_no,
        debug_status, debug_remarks, debug_by, debug_at, updated_at, is_deleted, work_order_internal_id,
        superseded_by_id, superseded_at
    )
    SELECT 
        id, session_id, work_order_id, serial_number, band_serial_no, physical_serial_number, physical_tpn,
        band, inspection_date, e_label, pam_tpn, pam1, pam2, pam3, pam4, rfpc_tpn, rfpc_sl_no,
        status, remarks, scanned_by, scanned_at, pre_burn_in_inspection_id, programming_inspection_id,
        ipqc_inspection_id, ivi_inspection_id, checkpoints, is_reinspected, defect_fixed, sl_no,
        debug_status, debug_remarks, debug_by, debug_at, updated_at, is_deleted, work_order_internal_id,
        superseded_by_id, superseded_at
    FROM rrh_hipot_inspections_archive
    WHERE work_order_internal_id = v_wo_id
    ON CONFLICT (id) DO UPDATE SET updated_at = EXCLUDED.updated_at;

    DELETE FROM rrh_hipot_inspections_archive WHERE work_order_internal_id = v_wo_id;

    -- 7. Restore Post-Burn-In Inspections
    INSERT INTO rrh_post_burn_in_inspections (
        id, session_id, work_order_id, serial_number, band_serial_no, physical_serial_number, physical_tpn,
        band, inspection_date, e_label, pam_tpn, pam1, pam2, pam3, pam4, rfpc_tpn, rfpc_sl_no,
        status, remarks, scanned_by, scanned_at, hipot_inspection_id, pre_burn_in_inspection_id,
        programming_inspection_id, ipqc_inspection_id, ivi_inspection_id, checkpoints,
        is_reinspected, defect_fixed, sl_no, debug_status, debug_remarks, debug_by, debug_at,
        updated_at, is_deleted, work_order_internal_id, superseded_by_id, superseded_at
    )
    SELECT 
        id, session_id, work_order_id, serial_number, band_serial_no, physical_serial_number, physical_tpn,
        band, inspection_date, e_label, pam_tpn, pam1, pam2, pam3, pam4, rfpc_tpn, rfpc_sl_no,
        status, remarks, scanned_by, scanned_at, hipot_inspection_id, pre_burn_in_inspection_id,
        programming_inspection_id, ipqc_inspection_id, ivi_inspection_id, checkpoints,
        is_reinspected, defect_fixed, sl_no, debug_status, debug_remarks, debug_by, debug_at,
        updated_at, is_deleted, work_order_internal_id, superseded_by_id, superseded_at
    FROM rrh_post_burn_in_inspections_archive
    WHERE work_order_internal_id = v_wo_id
    ON CONFLICT (id) DO UPDATE SET updated_at = EXCLUDED.updated_at;

    DELETE FROM rrh_post_burn_in_inspections_archive WHERE work_order_internal_id = v_wo_id;

    -- 8. Restore Stage Sessions: Reset from ARCHIVED back to Completed
    UPDATE rrh_inward_sessions SET status = 'Completed', updated_at = CURRENT_TIMESTAMP WHERE work_order_internal_id = v_wo_id AND status = 'ARCHIVED';
    UPDATE rrh_ivi_sessions SET status = 'Completed', updated_at = CURRENT_TIMESTAMP WHERE work_order_internal_id = v_wo_id AND status = 'ARCHIVED';
    UPDATE rrh_ipqc_sessions SET status = 'Completed', updated_at = CURRENT_TIMESTAMP WHERE work_order_internal_id = v_wo_id AND status = 'ARCHIVED';
    UPDATE rrh_programming_sessions SET status = 'Completed', updated_at = CURRENT_TIMESTAMP WHERE work_order_internal_id = v_wo_id AND status = 'ARCHIVED';
    UPDATE rrh_pre_burn_in_sessions SET status = 'Completed', updated_at = CURRENT_TIMESTAMP WHERE work_order_internal_id = v_wo_id AND status = 'ARCHIVED';
    UPDATE rrh_hipot_sessions SET status = 'Completed', updated_at = CURRENT_TIMESTAMP WHERE work_order_internal_id = v_wo_id AND status = 'ARCHIVED';
    UPDATE rrh_post_burn_in_sessions SET status = 'Completed', updated_at = CURRENT_TIMESTAMP WHERE work_order_internal_id = v_wo_id AND status = 'ARCHIVED';

    -- 9. Reset Work Order Status to COMPLETED
    UPDATE rrh_work_orders 
    SET status = 'COMPLETED', 
        archived_at = NULL, 
        updated_at = CURRENT_TIMESTAMP 
    WHERE id = v_wo_id;

    GET DIAGNOSTICS v_restored_count = ROW_COUNT;
    RETURN v_restored_count;
END;
$$ LANGUAGE plpgsql;

COMMIT;
