-- =====================================================================================
-- Migration Down 034: Rollback Canonical Work Order Identity Hardening
-- =====================================================================================

BEGIN;

DROP TRIGGER IF EXISTS trg_rrh_work_orders_canonicalize ON rrh_work_orders;
DROP FUNCTION IF EXISTS rrh_work_orders_canonicalize_identity();

-- Revert sync_rrh_work_order_internal_id to 033 version (without canonical NEW.work_order_id assignment)
CREATE OR REPLACE FUNCTION sync_rrh_work_order_internal_id()
RETURNS TRIGGER AS $$
DECLARE
    v_expected_wo_id VARCHAR(255);
BEGIN
    IF TG_OP = 'UPDATE' THEN
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

COMMIT;
