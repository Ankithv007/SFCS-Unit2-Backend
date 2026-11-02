-- ============================================================================
-- Migration 025: Concurrency HOT Updates, FK Lockout Elimination & Autovacuum Tuning
-- ============================================================================

-- 1. Enable HOT (Heap-Only Tuple) In-Place Updates on Hot Scan Tables
-- By allocating 10% page free space (fillfactor = 90), row updates (status changes,
-- repairs, reinspections, remarks) execute in-place without generating index I/O.
ALTER TABLE rrh_inward_scans SET (fillfactor = 90);
ALTER TABLE rrh_ivi_inspections SET (fillfactor = 90);
ALTER TABLE rrh_ipqc_inspections SET (fillfactor = 90);
ALTER TABLE rrh_programming_inspections SET (fillfactor = 90);
ALTER TABLE rrh_pre_burn_in_inspections SET (fillfactor = 90);
ALTER TABLE rrh_hipot_inspections SET (fillfactor = 90);
ALTER TABLE rrh_post_burn_in_inspections SET (fillfactor = 90);

-- 2. Index Cross-Module Lineage Foreign Keys
-- Eliminates table-scan locks during upstream inspection updates/deletions.
CREATE INDEX IF NOT EXISTS idx_rrh_pbi_ipqc_fk ON rrh_pre_burn_in_inspections(ipqc_inspection_id) WHERE ipqc_inspection_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rrh_pbi_ivi_fk ON rrh_pre_burn_in_inspections(ivi_inspection_id) WHERE ivi_inspection_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rrh_hipot_prog_fk ON rrh_hipot_inspections(programming_inspection_id) WHERE programming_inspection_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rrh_hipot_ipqc_fk ON rrh_hipot_inspections(ipqc_inspection_id) WHERE ipqc_inspection_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rrh_hipot_ivi_fk ON rrh_hipot_inspections(ivi_inspection_id) WHERE ivi_inspection_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rrh_post_bi_pbi_fk ON rrh_post_burn_in_inspections(pre_burn_in_inspection_id) WHERE pre_burn_in_inspection_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rrh_post_bi_prog_fk ON rrh_post_burn_in_inspections(programming_inspection_id) WHERE programming_inspection_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rrh_post_bi_ipqc_fk ON rrh_post_burn_in_inspections(ipqc_inspection_id) WHERE ipqc_inspection_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rrh_post_bi_ivi_fk ON rrh_post_burn_in_inspections(ivi_inspection_id) WHERE ivi_inspection_id IS NOT NULL;

-- 3. Autovacuum Tuning for High-Volume Excel Master Data Tables
ALTER TABLE rrh_excel_cells SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE rrh_excel_rows SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);
