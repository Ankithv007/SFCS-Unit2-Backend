-- ============================================================================
-- Migration 032: Enterprise Archival Referential Integrity, Constraint 
--               Alignment, Duplicate Audit Quarantine & Sync Hardening
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Non-Superuser Privilege Safety for pg_trgm Extension
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN insufficient_privilege THEN
    RAISE WARNING 'Insufficient privilege to create extension pg_trgm. Please ensure pg_trgm is enabled by database administrator.';
END $$;

-- ----------------------------------------------------------------------------
-- 2. Archival Status Model & Constraint Alignment
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    ALTER TABLE rrh_work_orders DROP CONSTRAINT IF EXISTS chk_rrh_work_orders_status;
    ALTER TABLE rrh_work_orders 
        ADD CONSTRAINT chk_rrh_work_orders_status 
        CHECK (status IN ('CREATED', 'IMPORTING', 'IN_PROGRESS', 'COMPLETED', 'PAUSED', 'CANCELLED', 'CLOSED', 'ARCHIVED'));

    ALTER TABLE rrh_work_orders ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT NULL;
    ALTER TABLE rrh_work_orders ADD COLUMN IF NOT EXISTS archived_by VARCHAR(100) DEFAULT NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_rrh_work_orders_archival 
ON rrh_work_orders (status, updated_at) 
WHERE status IN ('COMPLETED', 'CLOSED');

-- ----------------------------------------------------------------------------
-- 3. Archive Tables Column Synchronization & Completeness
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    tbl text;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'rrh_ivi_inspections_archive',
        'rrh_ipqc_inspections_archive',
        'rrh_programming_inspections_archive',
        'rrh_pre_burn_in_inspections_archive',
        'rrh_hipot_inspections_archive',
        'rrh_post_burn_in_inspections_archive'
    ] LOOP
        EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS superseded_by_id INT DEFAULT NULL;', tbl);
        EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ DEFAULT NULL;', tbl);
        EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;', tbl);
    END LOOP;

    -- Ensure programming live and archive tables are dependency-complete
    ALTER TABLE rrh_programming_inspections 
        ADD COLUMN IF NOT EXISTS firmware_version VARCHAR(255),
        ADD COLUMN IF NOT EXISTS mac_address VARCHAR(255),
        ADD COLUMN IF NOT EXISTS programming_status VARCHAR(255),
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

    ALTER TABLE rrh_programming_inspections_archive 
        ADD COLUMN IF NOT EXISTS firmware_version VARCHAR(255),
        ADD COLUMN IF NOT EXISTS mac_address VARCHAR(255),
        ADD COLUMN IF NOT EXISTS programming_status VARCHAR(255),
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

    ALTER TABLE rrh_inward_scans_archive ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
END $$;

-- ----------------------------------------------------------------------------
-- 4. Duplicate Inspection Audit Quarantine & Reporting
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rrh_migration_duplicate_quarantine (
    id SERIAL PRIMARY KEY,
    table_name VARCHAR(100) NOT NULL,
    record_id INTEGER NOT NULL,
    session_id INTEGER,
    work_order_id VARCHAR(100),
    serial_number VARCHAR(255) NOT NULL,
    scanned_at TIMESTAMP,
    superseded_by_id INTEGER,
    resolution_action VARCHAR(50) NOT NULL,
    quarantined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    audit_notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_rrh_dup_quarantine_serial 
ON rrh_migration_duplicate_quarantine (table_name, UPPER(TRIM(serial_number)));

CREATE OR REPLACE FUNCTION generate_inspection_duplicate_audit_report(p_auto_resolve BOOLEAN DEFAULT false)
RETURNS TABLE(
    stage_name VARCHAR(100),
    duplicates_found BIGINT,
    records_quarantined BIGINT
) AS $$
DECLARE
    r_dup RECORD;
    v_c_ivi BIGINT := 0;
    v_c_ipqc BIGINT := 0;
    v_c_prog BIGINT := 0;
    v_c_pbi BIGINT := 0;
    v_c_hipot BIGINT := 0;
    v_c_post_bi BIGINT := 0;
BEGIN
    -- 1. IVI
    FOR r_dup IN (
        SELECT id, session_id, work_order_id, serial_number, scanned_at,
               ROW_NUMBER() OVER (PARTITION BY session_id, UPPER(TRIM(serial_number)) ORDER BY scanned_at DESC, id DESC) as rn,
               FIRST_VALUE(id) OVER (PARTITION BY session_id, UPPER(TRIM(serial_number)) ORDER BY scanned_at DESC, id DESC) as keeper_id
        FROM rrh_ivi_inspections
        WHERE is_deleted = false
    ) LOOP
        IF r_dup.rn > 1 THEN
            v_c_ivi := v_c_ivi + 1;
            INSERT INTO rrh_migration_duplicate_quarantine 
                (table_name, record_id, session_id, work_order_id, serial_number, scanned_at, superseded_by_id, resolution_action, audit_notes)
            VALUES 
                ('rrh_ivi_inspections', r_dup.id, r_dup.session_id, r_dup.work_order_id, r_dup.serial_number, r_dup.scanned_at, 
                 r_dup.keeper_id, CASE WHEN p_auto_resolve THEN 'SUPERSEDED_AUDITED' ELSE 'DUPLICATE_REPORTED' END,
                 'Audited duplicate serial: ' || r_dup.serial_number);

            IF p_auto_resolve THEN
                UPDATE rrh_ivi_inspections 
                SET is_deleted = true, superseded_by_id = r_dup.keeper_id, superseded_at = CURRENT_TIMESTAMP 
                WHERE id = r_dup.id;
            END IF;
        END IF;
    END LOOP;

    -- 2. IPQC
    FOR r_dup IN (
        SELECT id, session_id, work_order_id, serial_number, scanned_at,
               ROW_NUMBER() OVER (PARTITION BY session_id, UPPER(TRIM(serial_number)) ORDER BY scanned_at DESC, id DESC) as rn,
               FIRST_VALUE(id) OVER (PARTITION BY session_id, UPPER(TRIM(serial_number)) ORDER BY scanned_at DESC, id DESC) as keeper_id
        FROM rrh_ipqc_inspections
        WHERE is_deleted = false
    ) LOOP
        IF r_dup.rn > 1 THEN
            v_c_ipqc := v_c_ipqc + 1;
            INSERT INTO rrh_migration_duplicate_quarantine 
                (table_name, record_id, session_id, work_order_id, serial_number, scanned_at, superseded_by_id, resolution_action, audit_notes)
            VALUES 
                ('rrh_ipqc_inspections', r_dup.id, r_dup.session_id, r_dup.work_order_id, r_dup.serial_number, r_dup.scanned_at, 
                 r_dup.keeper_id, CASE WHEN p_auto_resolve THEN 'SUPERSEDED_AUDITED' ELSE 'DUPLICATE_REPORTED' END,
                 'Audited duplicate serial: ' || r_dup.serial_number);

            IF p_auto_resolve THEN
                UPDATE rrh_ipqc_inspections 
                SET is_deleted = true, superseded_by_id = r_dup.keeper_id, superseded_at = CURRENT_TIMESTAMP 
                WHERE id = r_dup.id;
            END IF;
        END IF;
    END LOOP;

    -- 3. Programming
    FOR r_dup IN (
        SELECT id, session_id, work_order_id, serial_number, scanned_at,
               ROW_NUMBER() OVER (PARTITION BY session_id, UPPER(TRIM(serial_number)) ORDER BY scanned_at DESC, id DESC) as rn,
               FIRST_VALUE(id) OVER (PARTITION BY session_id, UPPER(TRIM(serial_number)) ORDER BY scanned_at DESC, id DESC) as keeper_id
        FROM rrh_programming_inspections
        WHERE is_deleted = false
    ) LOOP
        IF r_dup.rn > 1 THEN
            v_c_prog := v_c_prog + 1;
            INSERT INTO rrh_migration_duplicate_quarantine 
                (table_name, record_id, session_id, work_order_id, serial_number, scanned_at, superseded_by_id, resolution_action, audit_notes)
            VALUES 
                ('rrh_programming_inspections', r_dup.id, r_dup.session_id, r_dup.work_order_id, r_dup.serial_number, r_dup.scanned_at, 
                 r_dup.keeper_id, CASE WHEN p_auto_resolve THEN 'SUPERSEDED_AUDITED' ELSE 'DUPLICATE_REPORTED' END,
                 'Audited duplicate serial: ' || r_dup.serial_number);

            IF p_auto_resolve THEN
                UPDATE rrh_programming_inspections 
                SET is_deleted = true, superseded_by_id = r_dup.keeper_id, superseded_at = CURRENT_TIMESTAMP 
                WHERE id = r_dup.id;
            END IF;
        END IF;
    END LOOP;

    -- 4. Pre-Burn-In
    FOR r_dup IN (
        SELECT id, session_id, work_order_id, serial_number, scanned_at,
               ROW_NUMBER() OVER (PARTITION BY session_id, UPPER(TRIM(serial_number)) ORDER BY scanned_at DESC, id DESC) as rn,
               FIRST_VALUE(id) OVER (PARTITION BY session_id, UPPER(TRIM(serial_number)) ORDER BY scanned_at DESC, id DESC) as keeper_id
        FROM rrh_pre_burn_in_inspections
        WHERE is_deleted = false
    ) LOOP
        IF r_dup.rn > 1 THEN
            v_c_pbi := v_c_pbi + 1;
            INSERT INTO rrh_migration_duplicate_quarantine 
                (table_name, record_id, session_id, work_order_id, serial_number, scanned_at, superseded_by_id, resolution_action, audit_notes)
            VALUES 
                ('rrh_pre_burn_in_inspections', r_dup.id, r_dup.session_id, r_dup.work_order_id, r_dup.serial_number, r_dup.scanned_at, 
                 r_dup.keeper_id, CASE WHEN p_auto_resolve THEN 'SUPERSEDED_AUDITED' ELSE 'DUPLICATE_REPORTED' END,
                 'Audited duplicate serial: ' || r_dup.serial_number);

            IF p_auto_resolve THEN
                UPDATE rrh_pre_burn_in_inspections 
                SET is_deleted = true, superseded_by_id = r_dup.keeper_id, superseded_at = CURRENT_TIMESTAMP 
                WHERE id = r_dup.id;
            END IF;
        END IF;
    END LOOP;

    -- 5. Hipot
    FOR r_dup IN (
        SELECT id, session_id, work_order_id, serial_number, scanned_at,
               ROW_NUMBER() OVER (PARTITION BY session_id, UPPER(TRIM(serial_number)) ORDER BY scanned_at DESC, id DESC) as rn,
               FIRST_VALUE(id) OVER (PARTITION BY session_id, UPPER(TRIM(serial_number)) ORDER BY scanned_at DESC, id DESC) as keeper_id
        FROM rrh_hipot_inspections
        WHERE is_deleted = false
    ) LOOP
        IF r_dup.rn > 1 THEN
            v_c_hipot := v_c_hipot + 1;
            INSERT INTO rrh_migration_duplicate_quarantine 
                (table_name, record_id, session_id, work_order_id, serial_number, scanned_at, superseded_by_id, resolution_action, audit_notes)
            VALUES 
                ('rrh_hipot_inspections', r_dup.id, r_dup.session_id, r_dup.work_order_id, r_dup.serial_number, r_dup.scanned_at, 
                 r_dup.keeper_id, CASE WHEN p_auto_resolve THEN 'SUPERSEDED_AUDITED' ELSE 'DUPLICATE_REPORTED' END,
                 'Audited duplicate serial: ' || r_dup.serial_number);

            IF p_auto_resolve THEN
                UPDATE rrh_hipot_inspections 
                SET is_deleted = true, superseded_by_id = r_dup.keeper_id, superseded_at = CURRENT_TIMESTAMP 
                WHERE id = r_dup.id;
            END IF;
        END IF;
    END LOOP;

    -- 6. Post-Burn-In
    FOR r_dup IN (
        SELECT id, session_id, work_order_id, serial_number, scanned_at,
               ROW_NUMBER() OVER (PARTITION BY session_id, UPPER(TRIM(serial_number)) ORDER BY scanned_at DESC, id DESC) as rn,
               FIRST_VALUE(id) OVER (PARTITION BY session_id, UPPER(TRIM(serial_number)) ORDER BY scanned_at DESC, id DESC) as keeper_id
        FROM rrh_post_burn_in_inspections
        WHERE is_deleted = false
    ) LOOP
        IF r_dup.rn > 1 THEN
            v_c_post_bi := v_c_post_bi + 1;
            INSERT INTO rrh_migration_duplicate_quarantine 
                (table_name, record_id, session_id, work_order_id, serial_number, scanned_at, superseded_by_id, resolution_action, audit_notes)
            VALUES 
                ('rrh_post_burn_in_inspections', r_dup.id, r_dup.session_id, r_dup.work_order_id, r_dup.serial_number, r_dup.scanned_at, 
                 r_dup.keeper_id, CASE WHEN p_auto_resolve THEN 'SUPERSEDED_AUDITED' ELSE 'DUPLICATE_REPORTED' END,
                 'Audited duplicate serial: ' || r_dup.serial_number);

            IF p_auto_resolve THEN
                UPDATE rrh_post_burn_in_inspections 
                SET is_deleted = true, superseded_by_id = r_dup.keeper_id, superseded_at = CURRENT_TIMESTAMP 
                WHERE id = r_dup.id;
            END IF;
        END IF;
    END LOOP;

    RETURN QUERY VALUES 
        ('IVI'::VARCHAR, v_c_ivi, v_c_ivi),
        ('IPQC'::VARCHAR, v_c_ipqc, v_c_ipqc),
        ('Programming'::VARCHAR, v_c_prog, v_c_prog),
        ('Pre-Burn-In'::VARCHAR, v_c_pbi, v_c_pbi),
        ('Hipot'::VARCHAR, v_c_hipot, v_c_hipot),
        ('Post-Burn-In'::VARCHAR, v_c_post_bi, v_c_post_bi);
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 5. Bidirectional Work-Order Synchronization & Conflict Rejection
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_rrh_work_order_internal_id()
RETURNS TRIGGER AS $$
DECLARE
    v_expected_wo_id VARCHAR(255);
BEGIN
    -- 1. On UPDATE: Handle single-identifier updates
    IF TG_OP = 'UPDATE' THEN
        -- If work_order_id changed but work_order_internal_id was left untouched
        IF NEW.work_order_id IS DISTINCT FROM OLD.work_order_id 
           AND NEW.work_order_internal_id IS NOT DISTINCT FROM OLD.work_order_internal_id THEN
            IF NEW.work_order_id IS NULL THEN
                NEW.work_order_internal_id := NULL;
                RETURN NEW;
            END IF;
            SELECT id INTO NEW.work_order_internal_id 
            FROM rrh_work_orders 
            WHERE UPPER(TRIM(work_order_id)) = UPPER(TRIM(NEW.work_order_id)) 
            LIMIT 1;
            IF NEW.work_order_internal_id IS NULL THEN
                RAISE EXCEPTION 'Foreign key violation: work_order_id "%" does not exist in rrh_work_orders', NEW.work_order_id;
            END IF;
            RETURN NEW;
        -- If work_order_internal_id changed but work_order_id was left untouched
        ELSIF NEW.work_order_internal_id IS DISTINCT FROM OLD.work_order_internal_id 
              AND NEW.work_order_id IS NOT DISTINCT FROM OLD.work_order_id THEN
            IF NEW.work_order_internal_id IS NULL THEN
                NEW.work_order_id := NULL;
                RETURN NEW;
            END IF;
            SELECT work_order_id INTO NEW.work_order_id 
            FROM rrh_work_orders 
            WHERE id = NEW.work_order_internal_id 
            LIMIT 1;
            IF NEW.work_order_id IS NULL THEN
                RAISE EXCEPTION 'Foreign key violation: work_order_internal_id % does not exist in rrh_work_orders', NEW.work_order_internal_id;
            END IF;
            RETURN NEW;
        END IF;
    END IF;

    -- 2. Handle missing one-sided values (INSERT or UPDATE)
    IF NEW.work_order_internal_id IS NULL AND NEW.work_order_id IS NOT NULL THEN
        SELECT id INTO NEW.work_order_internal_id 
        FROM rrh_work_orders 
        WHERE UPPER(TRIM(work_order_id)) = UPPER(TRIM(NEW.work_order_id)) 
        LIMIT 1;
        IF NEW.work_order_internal_id IS NULL THEN
            RAISE EXCEPTION 'Foreign key violation: work_order_id "%" does not exist in rrh_work_orders', NEW.work_order_id;
        END IF;
        RETURN NEW;
    ELSIF NEW.work_order_id IS NULL AND NEW.work_order_internal_id IS NOT NULL THEN
        SELECT work_order_id INTO NEW.work_order_id 
        FROM rrh_work_orders 
        WHERE id = NEW.work_order_internal_id 
        LIMIT 1;
        IF NEW.work_order_id IS NULL THEN
            RAISE EXCEPTION 'Foreign key violation: work_order_internal_id % does not exist in rrh_work_orders', NEW.work_order_internal_id;
        END IF;
        RETURN NEW;
    END IF;

    -- 3. If BOTH identifiers are provided: STRICTLY VERIFY CONSISTENCY
    IF NEW.work_order_id IS NOT NULL AND NEW.work_order_internal_id IS NOT NULL THEN
        SELECT work_order_id INTO v_expected_wo_id 
        FROM rrh_work_orders 
        WHERE id = NEW.work_order_internal_id 
        LIMIT 1;
        IF v_expected_wo_id IS NULL THEN
            RAISE EXCEPTION 'Foreign key violation: work_order_internal_id % does not exist in rrh_work_orders', NEW.work_order_internal_id;
        ELSIF UPPER(TRIM(v_expected_wo_id)) <> UPPER(TRIM(NEW.work_order_id)) THEN
            RAISE EXCEPTION 'Conflicting work order identifiers: work_order_id "%" does not match work_order_internal_id % (expected "%")',
                NEW.work_order_id, NEW.work_order_internal_id, v_expected_wo_id
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach triggers across all 14 session and scan/inspection tables
DO $$
DECLARE
    tbl text;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'rrh_inward_sessions', 'rrh_inward_scans',
        'rrh_ivi_sessions', 'rrh_ivi_inspections',
        'rrh_ipqc_sessions', 'rrh_ipqc_inspections',
        'rrh_programming_sessions', 'rrh_programming_inspections',
        'rrh_pre_burn_in_sessions', 'rrh_pre_burn_in_inspections',
        'rrh_hipot_sessions', 'rrh_hipot_inspections',
        'rrh_post_burn_in_sessions', 'rrh_post_burn_in_inspections'
    ] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_sync_wo_internal_%I ON %I;', tbl, tbl);
        EXECUTE format('CREATE TRIGGER trg_sync_wo_internal_%I 
                        BEFORE INSERT OR UPDATE ON %I 
                        FOR EACH ROW 
                        EXECUTE FUNCTION sync_rrh_work_order_internal_id();', tbl, tbl);
    END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 6. Redesign Archival Around Reverse Dependency Referential Integrity
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION archive_closed_work_orders_history(p_retention_days INT DEFAULT 180, p_max_orders INT DEFAULT 5)
RETURNS INTEGER AS $$
DECLARE
    v_archived_orders INTEGER := 0;
    v_rows_moved INTEGER;
    v_remaining_live INTEGER;
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

        -- ====================================================================
        -- 1. STAGE 7: Move Post-Burn-In (Leaf child of Hipot, PBI, Prog, IPQC, IVI)
        -- ====================================================================
        LOOP
            WITH moved AS (
                DELETE FROM rrh_post_burn_in_inspections 
                WHERE id IN (
                    SELECT id FROM rrh_post_burn_in_inspections 
                    WHERE work_order_internal_id = r_wo.id 
                    LIMIT 500
                )
                RETURNING *
            )
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
            FROM moved
            ON CONFLICT (id) DO NOTHING;

            GET DIAGNOSTICS v_rows_moved = ROW_COUNT;
            EXIT WHEN v_rows_moved = 0;
        END LOOP;

        SELECT count(*) INTO v_remaining_live FROM rrh_post_burn_in_inspections WHERE work_order_internal_id = r_wo.id;
        IF v_remaining_live > 0 THEN
            RAISE EXCEPTION 'Referential integrity check failed: % unarchived Post-Burn-In rows remaining for work order %', v_remaining_live, r_wo.work_order_id;
        END IF;

        -- ====================================================================
        -- 2. STAGE 6: Move Hipot (Child of PBI, Prog, IPQC, IVI)
        -- ====================================================================
        LOOP
            WITH moved AS (
                DELETE FROM rrh_hipot_inspections 
                WHERE id IN (
                    SELECT id FROM rrh_hipot_inspections 
                    WHERE work_order_internal_id = r_wo.id 
                    LIMIT 500
                )
                RETURNING *
            )
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
            FROM moved
            ON CONFLICT (id) DO NOTHING;

            GET DIAGNOSTICS v_rows_moved = ROW_COUNT;
            EXIT WHEN v_rows_moved = 0;
        END LOOP;

        SELECT count(*) INTO v_remaining_live FROM rrh_hipot_inspections WHERE work_order_internal_id = r_wo.id;
        IF v_remaining_live > 0 THEN
            RAISE EXCEPTION 'Referential integrity check failed: % unarchived Hipot rows remaining for work order %', v_remaining_live, r_wo.work_order_id;
        END IF;

        -- ====================================================================
        -- 3. STAGE 5: Move Pre-Burn-In (Child of Prog, IPQC, IVI)
        -- ====================================================================
        LOOP
            WITH moved AS (
                DELETE FROM rrh_pre_burn_in_inspections 
                WHERE id IN (
                    SELECT id FROM rrh_pre_burn_in_inspections 
                    WHERE work_order_internal_id = r_wo.id 
                    LIMIT 500
                )
                RETURNING *
            )
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
            FROM moved
            ON CONFLICT (id) DO NOTHING;

            GET DIAGNOSTICS v_rows_moved = ROW_COUNT;
            EXIT WHEN v_rows_moved = 0;
        END LOOP;

        SELECT count(*) INTO v_remaining_live FROM rrh_pre_burn_in_inspections WHERE work_order_internal_id = r_wo.id;
        IF v_remaining_live > 0 THEN
            RAISE EXCEPTION 'Referential integrity check failed: % unarchived Pre-Burn-In rows remaining for work order %', v_remaining_live, r_wo.work_order_id;
        END IF;

        -- ====================================================================
        -- 4. STAGE 4: Move Programming (Child of IPQC, IVI)
        -- ====================================================================
        LOOP
            WITH moved AS (
                DELETE FROM rrh_programming_inspections 
                WHERE id IN (
                    SELECT id FROM rrh_programming_inspections 
                    WHERE work_order_internal_id = r_wo.id 
                    LIMIT 500
                )
                RETURNING *
            )
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
            FROM moved
            ON CONFLICT (id) DO NOTHING;

            GET DIAGNOSTICS v_rows_moved = ROW_COUNT;
            EXIT WHEN v_rows_moved = 0;
        END LOOP;

        SELECT count(*) INTO v_remaining_live FROM rrh_programming_inspections WHERE work_order_internal_id = r_wo.id;
        IF v_remaining_live > 0 THEN
            RAISE EXCEPTION 'Referential integrity check failed: % unarchived Programming rows remaining for work order %', v_remaining_live, r_wo.work_order_id;
        END IF;

        -- ====================================================================
        -- 5. STAGE 3: Move IPQC (Child of IVI)
        -- ====================================================================
        LOOP
            WITH moved AS (
                DELETE FROM rrh_ipqc_inspections 
                WHERE id IN (
                    SELECT id FROM rrh_ipqc_inspections 
                    WHERE work_order_internal_id = r_wo.id 
                    LIMIT 500
                )
                RETURNING *
            )
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
            FROM moved
            ON CONFLICT (id) DO NOTHING;

            GET DIAGNOSTICS v_rows_moved = ROW_COUNT;
            EXIT WHEN v_rows_moved = 0;
        END LOOP;

        SELECT count(*) INTO v_remaining_live FROM rrh_ipqc_inspections WHERE work_order_internal_id = r_wo.id;
        IF v_remaining_live > 0 THEN
            RAISE EXCEPTION 'Referential integrity check failed: % unarchived IPQC rows remaining for work order %', v_remaining_live, r_wo.work_order_id;
        END IF;

        -- ====================================================================
        -- 6. STAGE 2: Move IVI (Child of Inward Scans)
        -- ====================================================================
        LOOP
            WITH moved AS (
                DELETE FROM rrh_ivi_inspections 
                WHERE id IN (
                    SELECT id FROM rrh_ivi_inspections 
                    WHERE work_order_internal_id = r_wo.id 
                    LIMIT 500
                )
                RETURNING *
            )
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
            FROM moved
            ON CONFLICT (id) DO NOTHING;

            GET DIAGNOSTICS v_rows_moved = ROW_COUNT;
            EXIT WHEN v_rows_moved = 0;
        END LOOP;

        SELECT count(*) INTO v_remaining_live FROM rrh_ivi_inspections WHERE work_order_internal_id = r_wo.id;
        IF v_remaining_live > 0 THEN
            RAISE EXCEPTION 'Referential integrity check failed: % unarchived IVI rows remaining for work order %', v_remaining_live, r_wo.work_order_id;
        END IF;

        -- ====================================================================
        -- 7. STAGE 1: Move Inward Scans
        -- ====================================================================
        LOOP
            WITH moved AS (
                DELETE FROM rrh_inward_scans 
                WHERE id IN (
                    SELECT id FROM rrh_inward_scans 
                    WHERE work_order_internal_id = r_wo.id 
                    LIMIT 500
                )
                RETURNING *
            )
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
            FROM moved
            ON CONFLICT (id) DO NOTHING;

            GET DIAGNOSTICS v_rows_moved = ROW_COUNT;
            EXIT WHEN v_rows_moved = 0;
        END LOOP;

        SELECT count(*) INTO v_remaining_live FROM rrh_inward_scans WHERE work_order_internal_id = r_wo.id;
        IF v_remaining_live > 0 THEN
            RAISE EXCEPTION 'Referential integrity check failed: % unarchived Inward rows remaining for work order %', v_remaining_live, r_wo.work_order_id;
        END IF;

        -- ====================================================================
        -- 8. Finalize Work Order Archival State & Audit Timestamps
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
