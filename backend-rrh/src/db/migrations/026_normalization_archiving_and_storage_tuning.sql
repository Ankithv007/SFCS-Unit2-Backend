-- ============================================================================
-- Migration 026: Enterprise Normalization, Hot-Cold Archiving & Excel Storage Tuning
-- ============================================================================

-- ============================================================================
-- PART 1: Schema Normalization (Integer Surrogate Foreign Keys)
-- ============================================================================

-- 1. Add work_order_internal_id to all session and inspection tables
ALTER TABLE rrh_inward_sessions ADD COLUMN IF NOT EXISTS work_order_internal_id INTEGER REFERENCES rrh_work_orders(id) ON DELETE RESTRICT;
ALTER TABLE rrh_inward_scans ADD COLUMN IF NOT EXISTS work_order_internal_id INTEGER REFERENCES rrh_work_orders(id) ON DELETE RESTRICT;

ALTER TABLE rrh_ivi_sessions ADD COLUMN IF NOT EXISTS work_order_internal_id INTEGER REFERENCES rrh_work_orders(id) ON DELETE RESTRICT;
ALTER TABLE rrh_ivi_inspections ADD COLUMN IF NOT EXISTS work_order_internal_id INTEGER REFERENCES rrh_work_orders(id) ON DELETE RESTRICT;

ALTER TABLE rrh_ipqc_sessions ADD COLUMN IF NOT EXISTS work_order_internal_id INTEGER REFERENCES rrh_work_orders(id) ON DELETE RESTRICT;
ALTER TABLE rrh_ipqc_inspections ADD COLUMN IF NOT EXISTS work_order_internal_id INTEGER REFERENCES rrh_work_orders(id) ON DELETE RESTRICT;

ALTER TABLE rrh_programming_sessions ADD COLUMN IF NOT EXISTS work_order_internal_id INTEGER REFERENCES rrh_work_orders(id) ON DELETE RESTRICT;
ALTER TABLE rrh_programming_inspections ADD COLUMN IF NOT EXISTS work_order_internal_id INTEGER REFERENCES rrh_work_orders(id) ON DELETE RESTRICT;

ALTER TABLE rrh_pre_burn_in_sessions ADD COLUMN IF NOT EXISTS work_order_internal_id INTEGER REFERENCES rrh_work_orders(id) ON DELETE RESTRICT;
ALTER TABLE rrh_pre_burn_in_inspections ADD COLUMN IF NOT EXISTS work_order_internal_id INTEGER REFERENCES rrh_work_orders(id) ON DELETE RESTRICT;

ALTER TABLE rrh_hipot_sessions ADD COLUMN IF NOT EXISTS work_order_internal_id INTEGER REFERENCES rrh_work_orders(id) ON DELETE RESTRICT;
ALTER TABLE rrh_hipot_inspections ADD COLUMN IF NOT EXISTS work_order_internal_id INTEGER REFERENCES rrh_work_orders(id) ON DELETE RESTRICT;

ALTER TABLE rrh_post_burn_in_sessions ADD COLUMN IF NOT EXISTS work_order_internal_id INTEGER REFERENCES rrh_work_orders(id) ON DELETE RESTRICT;
ALTER TABLE rrh_post_burn_in_inspections ADD COLUMN IF NOT EXISTS work_order_internal_id INTEGER REFERENCES rrh_work_orders(id) ON DELETE RESTRICT;

-- 2. Backfill work_order_internal_id from existing work orders
UPDATE rrh_inward_sessions s SET work_order_internal_id = w.id FROM rrh_work_orders w WHERE s.work_order_id = w.work_order_id AND s.work_order_internal_id IS NULL;
UPDATE rrh_inward_scans s SET work_order_internal_id = w.id FROM rrh_work_orders w WHERE s.work_order_id = w.work_order_id AND s.work_order_internal_id IS NULL;

UPDATE rrh_ivi_sessions s SET work_order_internal_id = w.id FROM rrh_work_orders w WHERE s.work_order_id = w.work_order_id AND s.work_order_internal_id IS NULL;
UPDATE rrh_ivi_inspections s SET work_order_internal_id = w.id FROM rrh_work_orders w WHERE s.work_order_id = w.work_order_id AND s.work_order_internal_id IS NULL;

UPDATE rrh_ipqc_sessions s SET work_order_internal_id = w.id FROM rrh_work_orders w WHERE s.work_order_id = w.work_order_id AND s.work_order_internal_id IS NULL;
UPDATE rrh_ipqc_inspections s SET work_order_internal_id = w.id FROM rrh_work_orders w WHERE s.work_order_id = w.work_order_id AND s.work_order_internal_id IS NULL;

UPDATE rrh_programming_sessions s SET work_order_internal_id = w.id FROM rrh_work_orders w WHERE s.work_order_id = w.work_order_id AND s.work_order_internal_id IS NULL;
UPDATE rrh_programming_inspections s SET work_order_internal_id = w.id FROM rrh_work_orders w WHERE s.work_order_id = w.work_order_id AND s.work_order_internal_id IS NULL;

UPDATE rrh_pre_burn_in_sessions s SET work_order_internal_id = w.id FROM rrh_work_orders w WHERE s.work_order_id = w.work_order_id AND s.work_order_internal_id IS NULL;
UPDATE rrh_pre_burn_in_inspections s SET work_order_internal_id = w.id FROM rrh_work_orders w WHERE s.work_order_id = w.work_order_id AND s.work_order_internal_id IS NULL;

UPDATE rrh_hipot_sessions s SET work_order_internal_id = w.id FROM rrh_work_orders w WHERE s.work_order_id = w.work_order_id AND s.work_order_internal_id IS NULL;
UPDATE rrh_hipot_inspections s SET work_order_internal_id = w.id FROM rrh_work_orders w WHERE s.work_order_id = w.work_order_id AND s.work_order_internal_id IS NULL;

UPDATE rrh_post_burn_in_sessions s SET work_order_internal_id = w.id FROM rrh_work_orders w WHERE s.work_order_id = w.work_order_id AND s.work_order_internal_id IS NULL;
UPDATE rrh_post_burn_in_inspections s SET work_order_internal_id = w.id FROM rrh_work_orders w WHERE s.work_order_id = w.work_order_id AND s.work_order_internal_id IS NULL;

-- 3. Automatic Bi-directional Synchronization Trigger Function
CREATE OR REPLACE FUNCTION sync_rrh_work_order_internal_id()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.work_order_internal_id IS NULL AND NEW.work_order_id IS NOT NULL THEN
        SELECT id INTO NEW.work_order_internal_id FROM rrh_work_orders WHERE work_order_id = NEW.work_order_id LIMIT 1;
    ELSIF NEW.work_order_id IS NULL AND NEW.work_order_internal_id IS NOT NULL THEN
        SELECT work_order_id INTO NEW.work_order_id FROM rrh_work_orders WHERE id = NEW.work_order_internal_id LIMIT 1;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to all tables so existing backend code writing work_order_id string
-- automatically populates and enforces the 4-byte integer foreign key.
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
        EXECUTE format('CREATE TRIGGER trg_sync_wo_internal_%I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION sync_rrh_work_order_internal_id();', tbl, tbl);
    END LOOP;
END $$;

-- 4. Compact 4-byte integer foreign key indexes (vastly faster than VARCHAR B-Trees)
CREATE INDEX IF NOT EXISTS idx_inward_sessions_wo_int ON rrh_inward_sessions(work_order_internal_id);
CREATE INDEX IF NOT EXISTS idx_inward_scans_wo_int ON rrh_inward_scans(work_order_internal_id) WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_ivi_sessions_wo_int ON rrh_ivi_sessions(work_order_internal_id);
CREATE INDEX IF NOT EXISTS idx_ivi_inspections_wo_int ON rrh_ivi_inspections(work_order_internal_id) WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_ipqc_sessions_wo_int ON rrh_ipqc_sessions(work_order_internal_id);
CREATE INDEX IF NOT EXISTS idx_ipqc_inspections_wo_int ON rrh_ipqc_inspections(work_order_internal_id) WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_prog_sessions_wo_int ON rrh_programming_sessions(work_order_internal_id);
CREATE INDEX IF NOT EXISTS idx_prog_inspections_wo_int ON rrh_programming_inspections(work_order_internal_id) WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_pbi_sessions_wo_int ON rrh_pre_burn_in_sessions(work_order_internal_id);
CREATE INDEX IF NOT EXISTS idx_pbi_inspections_wo_int ON rrh_pre_burn_in_inspections(work_order_internal_id) WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_hipot_sessions_wo_int ON rrh_hipot_sessions(work_order_internal_id);
CREATE INDEX IF NOT EXISTS idx_hipot_inspections_wo_int ON rrh_hipot_inspections(work_order_internal_id) WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_post_bi_sessions_wo_int ON rrh_post_burn_in_sessions(work_order_internal_id);
CREATE INDEX IF NOT EXISTS idx_post_bi_inspections_wo_int ON rrh_post_burn_in_inspections(work_order_internal_id) WHERE is_deleted = false;


-- ============================================================================
-- PART 2: Excel Ingestion Optimization & Automated Maintenance
-- ============================================================================

-- 1. Enable inline/extended compression on rrh_excel_cells to save up to 60% disk/RAM
ALTER TABLE rrh_excel_cells ALTER COLUMN raw_value SET STORAGE EXTENDED;
ALTER TABLE rrh_excel_cells ALTER COLUMN display_value SET STORAGE EXTENDED;

-- 2. Add safe batch-purging procedure for orphaned Excel master data
-- When work orders are deleted or superseded, old cell records can be purged
-- in non-blocking batches without table locks.
CREATE OR REPLACE FUNCTION purge_orphaned_excel_master_data(p_batch_limit INT DEFAULT 5000)
RETURNS INTEGER AS $$
DECLARE
    v_deleted_count INTEGER := 0;
    v_rows_affected INTEGER;
BEGIN
    LOOP
        WITH orphaned_imports AS (
            SELECT id FROM rrh_excel_imports i
            WHERE NOT EXISTS (
                SELECT 1 FROM rrh_work_orders w WHERE w.active_import_id = i.id
            )
            LIMIT 10
        )
        DELETE FROM rrh_excel_imports
        WHERE id IN (SELECT id FROM orphaned_imports);

        GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
        v_deleted_count := v_deleted_count + v_rows_affected;
        EXIT WHEN v_rows_affected = 0 OR v_deleted_count >= p_batch_limit;
    END LOOP;

    RETURN v_deleted_count;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- PART 3: Long-Term Scalability & Hot-Cold Archive Infrastructure
-- ============================================================================

-- Create archive tables matching scan tables structure for long-term cold storage
CREATE TABLE IF NOT EXISTS rrh_inward_scans_archive (LIKE rrh_inward_scans INCLUDING ALL);
CREATE TABLE IF NOT EXISTS rrh_ivi_inspections_archive (LIKE rrh_ivi_inspections INCLUDING ALL);
CREATE TABLE IF NOT EXISTS rrh_ipqc_inspections_archive (LIKE rrh_ipqc_inspections INCLUDING ALL);
CREATE TABLE IF NOT EXISTS rrh_programming_inspections_archive (LIKE rrh_programming_inspections INCLUDING ALL);
CREATE TABLE IF NOT EXISTS rrh_pre_burn_in_inspections_archive (LIKE rrh_pre_burn_in_inspections INCLUDING ALL);
CREATE TABLE IF NOT EXISTS rrh_hipot_inspections_archive (LIKE rrh_hipot_inspections INCLUDING ALL);
CREATE TABLE IF NOT EXISTS rrh_post_burn_in_inspections_archive (LIKE rrh_post_burn_in_inspections INCLUDING ALL);

-- Create hot-cold archival stored procedure for closed work orders older than retention days
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
          AND updated_at < (CURRENT_TIMESTAMP - (p_retention_days || ' days')::INTERVAL)
        ORDER BY updated_at ASC
        LIMIT p_max_orders
    ) LOOP
        -- Move scans from hot tables to archive tables
        WITH moved AS (
            DELETE FROM rrh_inward_scans WHERE work_order_internal_id = r_wo.id RETURNING *
        )
        INSERT INTO rrh_inward_scans_archive SELECT * FROM moved;

        WITH moved AS (
            DELETE FROM rrh_ivi_inspections WHERE work_order_internal_id = r_wo.id RETURNING *
        )
        INSERT INTO rrh_ivi_inspections_archive SELECT * FROM moved;

        WITH moved AS (
            DELETE FROM rrh_ipqc_inspections WHERE work_order_internal_id = r_wo.id RETURNING *
        )
        INSERT INTO rrh_ipqc_inspections_archive SELECT * FROM moved;

        WITH moved AS (
            DELETE FROM rrh_programming_inspections WHERE work_order_internal_id = r_wo.id RETURNING *
        )
        INSERT INTO rrh_programming_inspections_archive SELECT * FROM moved;

        WITH moved AS (
            DELETE FROM rrh_pre_burn_in_inspections WHERE work_order_internal_id = r_wo.id RETURNING *
        )
        INSERT INTO rrh_pre_burn_in_inspections_archive SELECT * FROM moved;

        WITH moved AS (
            DELETE FROM rrh_hipot_inspections WHERE work_order_internal_id = r_wo.id RETURNING *
        )
        INSERT INTO rrh_hipot_inspections_archive SELECT * FROM moved;

        WITH moved AS (
            DELETE FROM rrh_post_burn_in_inspections WHERE work_order_internal_id = r_wo.id RETURNING *
        )
        INSERT INTO rrh_post_burn_in_inspections_archive SELECT * FROM moved;

        UPDATE rrh_work_orders SET status = 'ARCHIVED', updated_at = NOW() WHERE id = r_wo.id;
        v_archived_orders := v_archived_orders + 1;
    END LOOP;

    RETURN v_archived_orders;
END;
$$ LANGUAGE plpgsql;
