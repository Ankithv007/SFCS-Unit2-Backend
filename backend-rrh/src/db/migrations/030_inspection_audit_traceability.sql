-- ============================================================================
-- Migration 030: Full ISO-9001 Inspection Audit Traceability
-- Adds superseded_by_id and superseded_at to link failed inspections to their passing resolutions
-- ============================================================================

DO $$
DECLARE
    tbl text;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'rrh_ivi_inspections',
        'rrh_ipqc_inspections',
        'rrh_programming_inspections',
        'rrh_pre_burn_in_inspections',
        'rrh_hipot_inspections',
        'rrh_post_burn_in_inspections'
    ] LOOP
        EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS superseded_by_id INT DEFAULT NULL;', tbl);
        EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ DEFAULT NULL;', tbl);
        EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_superseded ON %I (superseded_by_id) WHERE superseded_by_id IS NOT NULL;', tbl, tbl);
    END LOOP;
END $$;
