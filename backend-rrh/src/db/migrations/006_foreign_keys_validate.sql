-- ====================================================================================================
-- MIGRATION: 006_foreign_keys_validate.sql
-- DESCRIPTION: Guarded foreign keys added with ON DELETE NO ACTION, created as NOT VALID, 
--              and validated in separate distinct statements to minimize lock duration.
-- ====================================================================================================

-- 1. Inward scans -> Inward sessions
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_rrh_inward_scans_session') THEN
        ALTER TABLE rrh_inward_scans 
        ADD CONSTRAINT fk_rrh_inward_scans_session 
        FOREIGN KEY (rrh_inward_session_id) REFERENCES rrh_inward_sessions(id) ON DELETE NO ACTION NOT VALID;
    END IF;
END $$;

ALTER TABLE rrh_inward_scans VALIDATE CONSTRAINT fk_rrh_inward_scans_session;

-- 2. Inward scans -> Inventory (matched inventory)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_rrh_inward_scans_matched_inv') THEN
        ALTER TABLE rrh_inward_scans 
        ADD CONSTRAINT fk_rrh_inward_scans_matched_inv 
        FOREIGN KEY (matched_inventory_id) REFERENCES rrh_inventory(id) ON DELETE NO ACTION NOT VALID;
    END IF;
END $$;

ALTER TABLE rrh_inward_scans VALIDATE CONSTRAINT fk_rrh_inward_scans_matched_inv;

-- 3. Inward sessions -> Work orders (work_order_id string key)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_rrh_inward_sessions_wo_id') THEN
        ALTER TABLE rrh_inward_sessions 
        ADD CONSTRAINT fk_rrh_inward_sessions_wo_id 
        FOREIGN KEY (work_order_id) REFERENCES rrh_work_orders(work_order_id) ON DELETE NO ACTION NOT VALID;
    END IF;
END $$;

ALTER TABLE rrh_inward_sessions VALIDATE CONSTRAINT fk_rrh_inward_sessions_wo_id;

-- 4. Inward scans -> Work orders (work_order_id string key)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_rrh_inward_scans_wo_id') THEN
        ALTER TABLE rrh_inward_scans 
        ADD CONSTRAINT fk_rrh_inward_scans_wo_id 
        FOREIGN KEY (work_order_id) REFERENCES rrh_work_orders(work_order_id) ON DELETE NO ACTION NOT VALID;
    END IF;
END $$;

ALTER TABLE rrh_inward_scans VALIDATE CONSTRAINT fk_rrh_inward_scans_wo_id;

-- 5. IVI sessions -> Work orders (work_order_id string key)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_rrh_ivi_sessions_wo_id') THEN
        ALTER TABLE rrh_ivi_sessions 
        ADD CONSTRAINT fk_rrh_ivi_sessions_wo_id 
        FOREIGN KEY (work_order_id) REFERENCES rrh_work_orders(work_order_id) ON DELETE NO ACTION NOT VALID;
    END IF;
END $$;

ALTER TABLE rrh_ivi_sessions VALIDATE CONSTRAINT fk_rrh_ivi_sessions_wo_id;

-- 6. IVI inspections -> Work orders (work_order_id string key)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_rrh_ivi_inspections_wo_id') THEN
        ALTER TABLE rrh_ivi_inspections 
        ADD CONSTRAINT fk_rrh_ivi_inspections_wo_id 
        FOREIGN KEY (work_order_id) REFERENCES rrh_work_orders(work_order_id) ON DELETE NO ACTION NOT VALID;
    END IF;
END $$;

ALTER TABLE rrh_ivi_inspections VALIDATE CONSTRAINT fk_rrh_ivi_inspections_wo_id;

-- 7. IVI inspections -> IVI sessions
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_rrh_ivi_inspections_session') THEN
        ALTER TABLE rrh_ivi_inspections 
        ADD CONSTRAINT fk_rrh_ivi_inspections_session 
        FOREIGN KEY (session_id) REFERENCES rrh_ivi_sessions(id) ON DELETE NO ACTION NOT VALID;
    END IF;
END $$;

ALTER TABLE rrh_ivi_inspections VALIDATE CONSTRAINT fk_rrh_ivi_inspections_session;
