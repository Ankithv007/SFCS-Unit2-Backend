-- ============================================================================
-- Migration 033: Canonical Identity, Lossless Copy-Verify-Delete Archival,
--               Cross-Import Verification, Date Sync Fix & Reconciliation
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Fix sync_work_order_dates() Edge Case
-- Prevents user-supplied 'date' from being overwritten by DEFAULT CURRENT_DATE
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_work_order_dates()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- If caller explicitly provided 'date', preserve it and sync work_order_date
        IF NEW.date IS NOT NULL AND (NEW.work_order_date IS NULL OR NEW.work_order_date = CURRENT_DATE) THEN
            NEW.work_order_date := NEW.date;
        ELSIF NEW.work_order_date IS NOT NULL AND NEW.date IS NULL THEN
            NEW.date := NEW.work_order_date;
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.date IS DISTINCT FROM OLD.date AND NEW.work_order_date IS NOT DISTINCT FROM OLD.work_order_date THEN
            NEW.work_order_date := NEW.date;
        ELSIF NEW.work_order_date IS DISTINCT FROM OLD.work_order_date AND NEW.date IS NOT DISTINCT FROM OLD.date THEN
            NEW.date := NEW.work_order_date;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 2. Guard active_import_id Against Cross-Work-Order References
-- Ensures active_import_id belongs strictly to the targeted work order
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION validate_rrh_work_order_active_import()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.active_import_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM rrh_excel_imports 
            WHERE id = NEW.active_import_id AND work_order_id = NEW.id
        ) THEN
            RAISE EXCEPTION 'Cross-work-order reference violation: active_import_id % does not belong to work order id %',
                NEW.active_import_id, NEW.id
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_wo_active_import ON rrh_work_orders;
CREATE TRIGGER trg_validate_wo_active_import
BEFORE INSERT OR UPDATE OF active_import_id ON rrh_work_orders
FOR EACH ROW
EXECUTE FUNCTION validate_rrh_work_order_active_import();

-- ----------------------------------------------------------------------------
-- 3. Legacy work_order_internal_id Backfill & Canonical Uniqueness
-- ----------------------------------------------------------------------------
-- Backfill any historical rows where work_order_internal_id was left NULL
UPDATE rrh_inward_sessions s SET work_order_internal_id = w.id FROM rrh_work_orders w WHERE UPPER(TRIM(s.work_order_id)) = UPPER(TRIM(w.work_order_id)) AND s.work_order_internal_id IS NULL;
UPDATE rrh_inward_scans s SET work_order_internal_id = w.id FROM rrh_work_orders w WHERE UPPER(TRIM(s.work_order_id)) = UPPER(TRIM(w.work_order_id)) AND s.work_order_internal_id IS NULL;
UPDATE rrh_ivi_sessions s SET work_order_internal_id = w.id FROM rrh_work_orders w WHERE UPPER(TRIM(s.work_order_id)) = UPPER(TRIM(w.work_order_id)) AND s.work_order_internal_id IS NULL;
UPDATE rrh_ivi_inspections s SET work_order_internal_id = w.id FROM rrh_work_orders w WHERE UPPER(TRIM(s.work_order_id)) = UPPER(TRIM(w.work_order_id)) AND s.work_order_internal_id IS NULL;
UPDATE rrh_ipqc_sessions s SET work_order_internal_id = w.id FROM rrh_work_orders w WHERE UPPER(TRIM(s.work_order_id)) = UPPER(TRIM(w.work_order_id)) AND s.work_order_internal_id IS NULL;
UPDATE rrh_ipqc_inspections s SET work_order_internal_id = w.id FROM rrh_work_orders w WHERE UPPER(TRIM(s.work_order_id)) = UPPER(TRIM(w.work_order_id)) AND s.work_order_internal_id IS NULL;
UPDATE rrh_programming_sessions s SET work_order_internal_id = w.id FROM rrh_work_orders w WHERE UPPER(TRIM(s.work_order_id)) = UPPER(TRIM(w.work_order_id)) AND s.work_order_internal_id IS NULL;
UPDATE rrh_programming_inspections s SET work_order_internal_id = w.id FROM rrh_work_orders w WHERE UPPER(TRIM(s.work_order_id)) = UPPER(TRIM(w.work_order_id)) AND s.work_order_internal_id IS NULL;
UPDATE rrh_pre_burn_in_sessions s SET work_order_internal_id = w.id FROM rrh_work_orders w WHERE UPPER(TRIM(s.work_order_id)) = UPPER(TRIM(w.work_order_id)) AND s.work_order_internal_id IS NULL;
UPDATE rrh_pre_burn_in_inspections s SET work_order_internal_id = w.id FROM rrh_work_orders w WHERE UPPER(TRIM(s.work_order_id)) = UPPER(TRIM(w.work_order_id)) AND s.work_order_internal_id IS NULL;
UPDATE rrh_hipot_sessions s SET work_order_internal_id = w.id FROM rrh_work_orders w WHERE UPPER(TRIM(s.work_order_id)) = UPPER(TRIM(w.work_order_id)) AND s.work_order_internal_id IS NULL;
UPDATE rrh_hipot_inspections s SET work_order_internal_id = w.id FROM rrh_work_orders w WHERE UPPER(TRIM(s.work_order_id)) = UPPER(TRIM(w.work_order_id)) AND s.work_order_internal_id IS NULL;
UPDATE rrh_post_burn_in_sessions s SET work_order_internal_id = w.id FROM rrh_work_orders w WHERE UPPER(TRIM(s.work_order_id)) = UPPER(TRIM(w.work_order_id)) AND s.work_order_internal_id IS NULL;
UPDATE rrh_post_burn_in_inspections s SET work_order_internal_id = w.id FROM rrh_work_orders w WHERE UPPER(TRIM(s.work_order_id)) = UPPER(TRIM(w.work_order_id)) AND s.work_order_internal_id IS NULL;

-- Quarantine any existing case-insensitive duplicate work order headers before creating unique index
DO $$
DECLARE
    r_dup RECORD;
BEGIN
    FOR r_dup IN (
        SELECT id, work_order_id,
               ROW_NUMBER() OVER (PARTITION BY UPPER(TRIM(work_order_id)) ORDER BY created_at ASC, id ASC) as rn,
               FIRST_VALUE(id) OVER (PARTITION BY UPPER(TRIM(work_order_id)) ORDER BY created_at ASC, id ASC) as keeper_id
        FROM rrh_work_orders
        WHERE is_deleted = false
    ) LOOP
        IF r_dup.rn > 1 THEN
            INSERT INTO rrh_migration_duplicate_quarantine 
                (table_name, record_id, work_order_id, serial_number, superseded_by_id, resolution_action, audit_notes)
            VALUES 
                ('rrh_work_orders', r_dup.id, r_dup.work_order_id, 'N/A', r_dup.keeper_id, 'QUARANTINED', 
                 'Duplicate canonical work_order_id detected during Migration 033: ' || r_dup.work_order_id);

            UPDATE rrh_work_orders SET is_deleted = true, deleted_at = CURRENT_TIMESTAMP, deleted_by = 'MIGRATION_033' WHERE id = r_dup.id;
        END IF;
    END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_rrh_work_orders_canonical_wo_id 
ON rrh_work_orders (UPPER(TRIM(work_order_id))) 
WHERE is_deleted = false;

-- ----------------------------------------------------------------------------
-- 4. Preserve Inward Scan Consumption Lineage During Archival
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rrh_inward_session_master_consumption_archive (
    LIKE rrh_inward_session_master_consumption INCLUDING ALL
);
ALTER TABLE rrh_inward_session_master_consumption_archive 
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

-- ----------------------------------------------------------------------------
-- 5. Lossless Archival Stored Procedure (Copy -> Verify -> Delete)
-- Replaces 'ON CONFLICT DO NOTHING' with atomic verified copying to eliminate silent data loss
-- ----------------------------------------------------------------------------
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

        -- Ensure any unlinked legacy child rows are bound to r_wo.id before archiving
        UPDATE rrh_inward_scans SET work_order_internal_id = r_wo.id WHERE work_order_internal_id IS NULL AND UPPER(TRIM(work_order_id)) = UPPER(TRIM(r_wo.work_order_id));
        UPDATE rrh_ivi_inspections SET work_order_internal_id = r_wo.id WHERE work_order_internal_id IS NULL AND UPPER(TRIM(work_order_id)) = UPPER(TRIM(r_wo.work_order_id));
        UPDATE rrh_ipqc_inspections SET work_order_internal_id = r_wo.id WHERE work_order_internal_id IS NULL AND UPPER(TRIM(work_order_id)) = UPPER(TRIM(r_wo.work_order_id));
        UPDATE rrh_programming_inspections SET work_order_internal_id = r_wo.id WHERE work_order_internal_id IS NULL AND UPPER(TRIM(work_order_id)) = UPPER(TRIM(r_wo.work_order_id));
        UPDATE rrh_pre_burn_in_inspections SET work_order_internal_id = r_wo.id WHERE work_order_internal_id IS NULL AND UPPER(TRIM(work_order_id)) = UPPER(TRIM(r_wo.work_order_id));
        UPDATE rrh_hipot_inspections SET work_order_internal_id = r_wo.id WHERE work_order_internal_id IS NULL AND UPPER(TRIM(work_order_id)) = UPPER(TRIM(r_wo.work_order_id));
        UPDATE rrh_post_burn_in_inspections SET work_order_internal_id = r_wo.id WHERE work_order_internal_id IS NULL AND UPPER(TRIM(work_order_id)) = UPPER(TRIM(r_wo.work_order_id));

        -- ====================================================================
        -- 1. STAGE 7: Post-Burn-In (Copy -> Verify -> Delete)
        -- ====================================================================
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
            archived_at = CURRENT_TIMESTAMP;

        SELECT count(*) INTO v_live_count FROM rrh_post_burn_in_inspections WHERE work_order_internal_id = r_wo.id;
        SELECT count(*) INTO v_archive_count FROM rrh_post_burn_in_inspections_archive WHERE work_order_internal_id = r_wo.id;
        IF v_archive_count < v_live_count THEN
            RAISE EXCEPTION 'Archival loss prevention halt: Post-Burn-In archive has % rows but live has % for work order %',
                v_archive_count, v_live_count, r_wo.work_order_id;
        END IF;

        DELETE FROM rrh_post_burn_in_inspections WHERE work_order_internal_id = r_wo.id;

        -- ====================================================================
        -- 2. STAGE 6: Hipot (Copy -> Verify -> Delete)
        -- ====================================================================
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
            archived_at = CURRENT_TIMESTAMP;

        SELECT count(*) INTO v_live_count FROM rrh_hipot_inspections WHERE work_order_internal_id = r_wo.id;
        SELECT count(*) INTO v_archive_count FROM rrh_hipot_inspections_archive WHERE work_order_internal_id = r_wo.id;
        IF v_archive_count < v_live_count THEN
            RAISE EXCEPTION 'Archival loss prevention halt: Hipot archive has % rows but live has % for work order %',
                v_archive_count, v_live_count, r_wo.work_order_id;
        END IF;

        DELETE FROM rrh_hipot_inspections WHERE work_order_internal_id = r_wo.id;

        -- ====================================================================
        -- 3. STAGE 5: Pre-Burn-In (Copy -> Verify -> Delete)
        -- ====================================================================
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
            archived_at = CURRENT_TIMESTAMP;

        SELECT count(*) INTO v_live_count FROM rrh_pre_burn_in_inspections WHERE work_order_internal_id = r_wo.id;
        SELECT count(*) INTO v_archive_count FROM rrh_pre_burn_in_inspections_archive WHERE work_order_internal_id = r_wo.id;
        IF v_archive_count < v_live_count THEN
            RAISE EXCEPTION 'Archival loss prevention halt: Pre-Burn-In archive has % rows but live has % for work order %',
                v_archive_count, v_live_count, r_wo.work_order_id;
        END IF;

        DELETE FROM rrh_pre_burn_in_inspections WHERE work_order_internal_id = r_wo.id;

        -- ====================================================================
        -- 4. STAGE 4: Programming (Copy -> Verify -> Delete)
        -- ====================================================================
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
            archived_at = CURRENT_TIMESTAMP;

        SELECT count(*) INTO v_live_count FROM rrh_programming_inspections WHERE work_order_internal_id = r_wo.id;
        SELECT count(*) INTO v_archive_count FROM rrh_programming_inspections_archive WHERE work_order_internal_id = r_wo.id;
        IF v_archive_count < v_live_count THEN
            RAISE EXCEPTION 'Archival loss prevention halt: Programming archive has % rows but live has % for work order %',
                v_archive_count, v_live_count, r_wo.work_order_id;
        END IF;

        DELETE FROM rrh_programming_inspections WHERE work_order_internal_id = r_wo.id;

        -- ====================================================================
        -- 5. STAGE 3: IPQC (Copy -> Verify -> Delete)
        -- ====================================================================
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
            archived_at = CURRENT_TIMESTAMP;

        SELECT count(*) INTO v_live_count FROM rrh_ipqc_inspections WHERE work_order_internal_id = r_wo.id;
        SELECT count(*) INTO v_archive_count FROM rrh_ipqc_inspections_archive WHERE work_order_internal_id = r_wo.id;
        IF v_archive_count < v_live_count THEN
            RAISE EXCEPTION 'Archival loss prevention halt: IPQC archive has % rows but live has % for work order %',
                v_archive_count, v_live_count, r_wo.work_order_id;
        END IF;

        DELETE FROM rrh_ipqc_inspections WHERE work_order_internal_id = r_wo.id;

        -- ====================================================================
        -- 6. STAGE 2: IVI (Copy -> Verify -> Delete)
        -- ====================================================================
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
            archived_at = CURRENT_TIMESTAMP;

        SELECT count(*) INTO v_live_count FROM rrh_ivi_inspections WHERE work_order_internal_id = r_wo.id;
        SELECT count(*) INTO v_archive_count FROM rrh_ivi_inspections_archive WHERE work_order_internal_id = r_wo.id;
        IF v_archive_count < v_live_count THEN
            RAISE EXCEPTION 'Archival loss prevention halt: IVI archive has % rows but live has % for work order %',
                v_archive_count, v_live_count, r_wo.work_order_id;
        END IF;

        DELETE FROM rrh_ivi_inspections WHERE work_order_internal_id = r_wo.id;

        -- ====================================================================
        -- 7. STAGE 1B: Archive Inventory Consumption Before Scans Are Removed
        -- ====================================================================
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

        -- ====================================================================
        -- 8. STAGE 1: Inward Scans (Copy -> Verify -> Delete)
        -- ====================================================================
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
            archived_at = CURRENT_TIMESTAMP;

        SELECT count(*) INTO v_live_count FROM rrh_inward_scans WHERE work_order_internal_id = r_wo.id;
        SELECT count(*) INTO v_archive_count FROM rrh_inward_scans_archive WHERE work_order_internal_id = r_wo.id;
        IF v_archive_count < v_live_count THEN
            RAISE EXCEPTION 'Archival loss prevention halt: Inward scans archive has % rows but live has % for work order %',
                v_archive_count, v_live_count, r_wo.work_order_id;
        END IF;

        DELETE FROM rrh_inward_scans WHERE work_order_internal_id = r_wo.id;

        -- ====================================================================
        -- 9. Finalize Work Order Archival State
        -- ====================================================================
        UPDATE rrh_work_orders 
        SET status = 'ARCHIVED', 
            archived_at = CURRENT_TIMESTAMP, 
            updated_at = CURRENT_TIMESTAMP 
        WHERE id = r_wo.id;

        v_archived_orders := v_archived_orders + 1;
    END LOOP;

    RETURN v_archived_orders;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 6. Operational Reconciliation & Restore Stored Procedure
-- Restores an archived work order back into live tables in forward dependency order
-- ----------------------------------------------------------------------------
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

    -- Reset Work Order Status to COMPLETED
    UPDATE rrh_work_orders 
    SET status = 'COMPLETED', 
        archived_at = NULL, 
        updated_at = CURRENT_TIMESTAMP 
    WHERE id = v_wo_id;

    GET DIAGNOSTICS v_restored_count = ROW_COUNT;
    RETURN v_restored_count;
END;
$$ LANGUAGE plpgsql;
