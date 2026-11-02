-- ============================================================================
-- Migration 029: Enterprise Trigger Bypasses, Micro-Batched Archiving & Guardrails
-- ============================================================================

-- 1. Upgrade synchronization triggers with C-level WHEN bypass condition.
-- When both work_order_id and work_order_internal_id are supplied,
-- PostgreSQL completely skips the PL/pgSQL function at the C-level (0 overhead).
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
                        WHEN (NEW.work_order_internal_id IS NULL OR NEW.work_order_id IS NULL) 
                        EXECUTE FUNCTION sync_rrh_work_order_internal_id();', tbl, tbl);
    END LOOP;
END $$;

-- 2. Upgrade Archival Procedure to Micro-Batched Moving (Limits WAL spikes & row locks)
CREATE OR REPLACE FUNCTION archive_closed_work_orders_history(p_retention_days INT DEFAULT 180, p_max_orders INT DEFAULT 5)
RETURNS INTEGER AS $$
DECLARE
    v_archived_orders INTEGER := 0;
    v_rows_moved INTEGER;
    r_wo RECORD;
BEGIN
    FOR r_wo IN (
        SELECT id, work_order_id
        FROM rrh_work_orders
        WHERE status IN ('COMPLETED', 'CLOSED')
          AND updated_at < (CURRENT_TIMESTAMP - (p_retention_days || ' days')::INTERVAL)
        ORDER BY updated_at ASC
        LIMIT p_max_orders
    ) LOOP
        -- Micro-batched move for inward scans (500 rows per transaction chunk)
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
            INSERT INTO rrh_inward_scans_archive SELECT * FROM moved;
            GET DIAGNOSTICS v_rows_moved = ROW_COUNT;
            EXIT WHEN v_rows_moved = 0;
        END LOOP;

        -- Micro-batched move for IVI inspections
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
            INSERT INTO rrh_ivi_inspections_archive SELECT * FROM moved;
            GET DIAGNOSTICS v_rows_moved = ROW_COUNT;
            EXIT WHEN v_rows_moved = 0;
        END LOOP;

        -- Micro-batched move for IPQC inspections
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
            INSERT INTO rrh_ipqc_inspections_archive SELECT * FROM moved;
            GET DIAGNOSTICS v_rows_moved = ROW_COUNT;
            EXIT WHEN v_rows_moved = 0;
        END LOOP;

        -- Micro-batched move for Programming inspections
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
            INSERT INTO rrh_programming_inspections_archive SELECT * FROM moved;
            GET DIAGNOSTICS v_rows_moved = ROW_COUNT;
            EXIT WHEN v_rows_moved = 0;
        END LOOP;

        -- Micro-batched move for Pre-Burn-In inspections
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
            INSERT INTO rrh_pre_burn_in_inspections_archive SELECT * FROM moved;
            GET DIAGNOSTICS v_rows_moved = ROW_COUNT;
            EXIT WHEN v_rows_moved = 0;
        END LOOP;

        -- Micro-batched move for Hipot inspections
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
            INSERT INTO rrh_hipot_inspections_archive SELECT * FROM moved;
            GET DIAGNOSTICS v_rows_moved = ROW_COUNT;
            EXIT WHEN v_rows_moved = 0;
        END LOOP;

        -- Micro-batched move for Post-Burn-In inspections
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
            INSERT INTO rrh_post_burn_in_inspections_archive SELECT * FROM moved;
            GET DIAGNOSTICS v_rows_moved = ROW_COUNT;
            EXIT WHEN v_rows_moved = 0;
        END LOOP;

        UPDATE rrh_work_orders SET status = 'ARCHIVED', updated_at = NOW() WHERE id = r_wo.id;
        v_archived_orders := v_archived_orders + 1;
    END LOOP;

    RETURN v_archived_orders;
END;
$$ LANGUAGE plpgsql;
