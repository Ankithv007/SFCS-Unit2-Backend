-- 012_allow_scrap_status_in_ivi_inspections.sql
-- Allow 'SCRAP' status in rrh_ivi_inspections check constraints

DO $$ 
DECLARE
    r RECORD;
BEGIN
    -- Drop any existing CHECK constraints on rrh_ivi_inspections status column
    FOR r IN (
        SELECT conname 
        FROM pg_constraint 
        WHERE conrelid = 'rrh_ivi_inspections'::regclass 
          AND contype = 'c' 
          AND pg_get_constraintdef(oid) LIKE '%status%'
    ) LOOP
        EXECUTE 'ALTER TABLE rrh_ivi_inspections DROP CONSTRAINT IF EXISTS ' || quote_ident(r.conname);
    END LOOP;

    -- Add updated status check constraint allowing 'PASS', 'FAIL', 'REINSPECTED', 'SCRAP'
    ALTER TABLE rrh_ivi_inspections 
    ADD CONSTRAINT chk_rrh_ivi_inspections_status 
    CHECK (status IN ('PASS', 'FAIL', 'REINSPECTED', 'SCRAP')) NOT VALID;
    
    ALTER TABLE rrh_ivi_inspections VALIDATE CONSTRAINT chk_rrh_ivi_inspections_status;
END $$;
