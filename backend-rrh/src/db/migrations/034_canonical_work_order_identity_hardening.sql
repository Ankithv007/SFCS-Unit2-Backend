-- =====================================================================================
-- Migration 034: Canonical Work Order Identity Hardening & Universal Trigger Sync
-- Description:
--   1. Implements automatic identity canonicalization (UPPER(TRIM(work_order_id)))
--      directly on rrh_work_orders via BEFORE INSERT OR UPDATE trigger.
--   2. Updates sync_rrh_work_order_internal_id() trigger across all 14 child stage tables
--      so that whenever work_order_id is provided or resolved, it is rewritten to the
--      canonical work_order_id from rrh_work_orders, eliminating casing and whitespace
--      divergence across foreign keys.
--   3. Safely verifies and synchronizes any legacy records across all child tables.
-- =====================================================================================

BEGIN;

-- -------------------------------------------------------------------------------------
-- 1. Automatic Identity Canonicalization Trigger on rrh_work_orders
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rrh_work_orders_canonicalize_identity()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.work_order_id IS NOT NULL THEN
        NEW.work_order_id := UPPER(TRIM(NEW.work_order_id));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rrh_work_orders_canonicalize ON rrh_work_orders;
CREATE TRIGGER trg_rrh_work_orders_canonicalize
    BEFORE INSERT OR UPDATE OF work_order_id ON rrh_work_orders
    FOR EACH ROW
    EXECUTE FUNCTION rrh_work_orders_canonicalize_identity();

-- -------------------------------------------------------------------------------------
-- 2. Enhanced Bidirectional & Canonical sync_rrh_work_order_internal_id() Trigger
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_rrh_work_order_internal_id()
RETURNS TRIGGER AS $$
DECLARE
    v_expected_wo_id VARCHAR(255);
    v_found_id BIGINT;
    v_found_wo VARCHAR(255);
BEGIN
    -- 1. On UPDATE: Handle single-identifier updates
    IF TG_OP = 'UPDATE' THEN
        IF NEW.work_order_id IS DISTINCT FROM OLD.work_order_id 
           AND NEW.work_order_internal_id IS NOT DISTINCT FROM OLD.work_order_internal_id THEN
            IF NEW.work_order_id IS NULL THEN
                NEW.work_order_internal_id := NULL;
                RETURN NEW;
            END IF;
            SELECT id, work_order_id INTO NEW.work_order_internal_id, NEW.work_order_id 
            FROM rrh_work_orders 
            WHERE UPPER(TRIM(work_order_id)) = UPPER(TRIM(NEW.work_order_id)) 
            LIMIT 1;
            IF NEW.work_order_internal_id IS NULL THEN
                RAISE EXCEPTION 'Foreign key violation: work_order_id "%" does not exist in rrh_work_orders', NEW.work_order_id;
            END IF;
            RETURN NEW;
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
        SELECT id, work_order_id INTO v_found_id, v_found_wo 
        FROM rrh_work_orders 
        WHERE UPPER(TRIM(work_order_id)) = UPPER(TRIM(NEW.work_order_id)) 
        LIMIT 1;
        IF v_found_id IS NULL THEN
            RAISE EXCEPTION 'Foreign key violation: work_order_id "%" does not exist in rrh_work_orders', NEW.work_order_id;
        END IF;
        NEW.work_order_internal_id := v_found_id;
        NEW.work_order_id := v_found_wo;
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

    -- 3. If BOTH identifiers are provided: STRICTLY VERIFY CONSISTENCY & CANONICALIZE
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
        ELSE
            -- Strictly normalize the string to match rrh_work_orders canonically
            NEW.work_order_id := v_expected_wo_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -------------------------------------------------------------------------------------
-- 3. Safe Backfill: Synchronize any existing slight casing differences across child tables
-- -------------------------------------------------------------------------------------
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
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = tbl) THEN
            EXECUTE format('
                UPDATE %I c
                SET work_order_id = w.work_order_id
                FROM rrh_work_orders w
                WHERE c.work_order_internal_id = w.id
                  AND c.work_order_id <> w.work_order_id;', tbl);
        END IF;
    END LOOP;
END $$;

COMMIT;
