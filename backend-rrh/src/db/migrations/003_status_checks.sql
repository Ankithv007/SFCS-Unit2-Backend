-- ====================================================================================================
-- MIGRATION: 003_status_checks.sql
-- DESCRIPTION: Enforce strict CHECK constraints on status columns across all RRH tables.
-- STRATEGY: ADD CONSTRAINT ... NOT VALID then VALIDATE CONSTRAINT to prevent table lockups.
-- ====================================================================================================

-- 1. rrh_work_orders
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_rrh_work_orders_status') THEN
        ALTER TABLE rrh_work_orders 
        ADD CONSTRAINT chk_rrh_work_orders_status 
        CHECK (status IN ('CREATED', 'IMPORTING', 'COMPLETED')) NOT VALID;
        
        ALTER TABLE rrh_work_orders VALIDATE CONSTRAINT chk_rrh_work_orders_status;
    END IF;
END $$;

-- 2. rrh_excel_imports
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_rrh_excel_imports_status') THEN
        ALTER TABLE rrh_excel_imports 
        ADD CONSTRAINT chk_rrh_excel_imports_status 
        CHECK (status IN ('PENDING', 'CONFIRMED')) NOT VALID;
        
        ALTER TABLE rrh_excel_imports VALIDATE CONSTRAINT chk_rrh_excel_imports_status;
    END IF;
END $$;

-- 3. rrh_inward_sessions
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_rrh_inward_sessions_status') THEN
        ALTER TABLE rrh_inward_sessions 
        ADD CONSTRAINT chk_rrh_inward_sessions_status 
        CHECK (status IN ('Pending', 'In Progress', 'Paused', 'Completed', 'Cancelled', 'Aborted')) NOT VALID;
        
        ALTER TABLE rrh_inward_sessions VALIDATE CONSTRAINT chk_rrh_inward_sessions_status;
    END IF;
END $$;

-- 4. rrh_inward_scans
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_rrh_inward_scans_status') THEN
        ALTER TABLE rrh_inward_scans 
        ADD CONSTRAINT chk_rrh_inward_scans_status 
        CHECK (status IN ('PASS', 'FAIL', 'INVALID', 'EDITED PASS')) NOT VALID;
        
        ALTER TABLE rrh_inward_scans VALIDATE CONSTRAINT chk_rrh_inward_scans_status;
    END IF;
END $$;

-- 5. rrh_ivi_sessions
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_rrh_ivi_sessions_status') THEN
        ALTER TABLE rrh_ivi_sessions 
        ADD CONSTRAINT chk_rrh_ivi_sessions_status 
        CHECK (status IN ('In Progress', 'Completed', 'Cancelled', 'Aborted')) NOT VALID;
        
        ALTER TABLE rrh_ivi_sessions VALIDATE CONSTRAINT chk_rrh_ivi_sessions_status;
    END IF;
END $$;

-- 6. rrh_ivi_inspections
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_rrh_ivi_inspections_status') THEN
        ALTER TABLE rrh_ivi_inspections 
        ADD CONSTRAINT chk_rrh_ivi_inspections_status 
        CHECK (status IN ('PASS', 'FAIL', 'REINSPECTED')) NOT VALID;
        
        ALTER TABLE rrh_ivi_inspections VALIDATE CONSTRAINT chk_rrh_ivi_inspections_status;
    END IF;
END $$;
