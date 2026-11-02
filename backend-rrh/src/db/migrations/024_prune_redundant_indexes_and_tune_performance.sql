-- ============================================================================
-- Migration 024: Prune Massive Redundant Index Bloat & Eliminate Write Latency Penalties
-- ============================================================================

-- 1. rrh_excel_cells: Drop expensive GIN trigram index that chokes master data ingestion
DROP INDEX IF EXISTS idx_rrh_excel_cells_display_trgm;

-- 2. rrh_inward_scans: Prune redundant and duplicate indexes
DROP INDEX IF EXISTS idx_inward_scans_serial;
DROP INDEX IF EXISTS idx_inward_scans_serial_ci;
DROP INDEX IF EXISTS idx_inward_scans_band_serial_ci;
DROP INDEX IF EXISTS idx_inward_scans_wo_ci;
DROP INDEX IF EXISTS idx_rrh_inward_scans_wo_id;
DROP INDEX IF EXISTS idx_rrh_inward_scans_matched_inventory;
DROP INDEX IF EXISTS idx_rrh_inward_scans_session_perf;
DROP INDEX IF EXISTS idx_inward_scans_session_id;
DROP INDEX IF EXISTS idx_rrh_inward_scans_status;

-- 3. rrh_ivi_inspections: Prune duplicate and dead-weight GIN indexes
DROP INDEX IF EXISTS idx_rrh_ivi_image_urls_gin;
DROP INDEX IF EXISTS idx_ivi_inspections_sl_no;
DROP INDEX IF EXISTS idx_rrh_ivi_session_status_scanned;
DROP INDEX IF EXISTS idx_rrh_ivi_inspections_serial;
DROP INDEX IF EXISTS idx_rrh_ivi_inspections_band_serial;
DROP INDEX IF EXISTS idx_rrh_ivi_inspections_serial_ci;
DROP INDEX IF EXISTS idx_rrh_ivi_inspections_band_serial_ci;
DROP INDEX IF EXISTS idx_rrh_ivi_inspections_session;
DROP INDEX IF EXISTS idx_rrh_ivi_inspections_wo;
DROP INDEX IF EXISTS idx_rrh_ivi_inspections_wo_ci;
DROP INDEX IF EXISTS idx_rrh_ivi_inspections_wo_serial_upper_trim;
DROP INDEX IF EXISTS idx_rrh_ivi_wo_upper_serial;
DROP INDEX IF EXISTS idx_rrh_ivi_wo_upper_band;
DROP INDEX IF EXISTS idx_rrh_ivi_session_upper_serial;
DROP INDEX IF EXISTS idx_rrh_ivi_session_upper_band;
DROP INDEX IF EXISTS idx_rrh_ivi_inspections_route_status;

-- 4. rrh_ipqc_inspections: Prune duplicate and dead-weight GIN indexes
DROP INDEX IF EXISTS idx_rrh_ipqc_checkpoints_gin;
DROP INDEX IF EXISTS idx_rrh_ipqc_session_status_scanned;
DROP INDEX IF EXISTS idx_rrh_ipqc_inspections_serial_ci;
DROP INDEX IF EXISTS idx_rrh_ipqc_inspections_band_serial_ci;
DROP INDEX IF EXISTS idx_rrh_ipqc_inspections_wo_ci;
DROP INDEX IF EXISTS idx_rrh_ipqc_wo_upper_serial;
DROP INDEX IF EXISTS idx_rrh_ipqc_wo_upper_band;
DROP INDEX IF EXISTS idx_rrh_ipqc_session_upper_serial;
DROP INDEX IF EXISTS idx_rrh_ipqc_session_upper_band;
DROP INDEX IF EXISTS idx_rrh_ipqc_ivi_id_active;

-- 5. rrh_programming_inspections: Prune duplicate session, wo, and serial indexes
DROP INDEX IF EXISTS idx_rrh_prog_inspections_serial;
DROP INDEX IF EXISTS idx_rrh_prog_inspections_band_serial;
DROP INDEX IF EXISTS idx_rrh_prog_inspections_upper_serial;
DROP INDEX IF EXISTS idx_rrh_prog_inspections_upper_band;
DROP INDEX IF EXISTS idx_rrh_prog_inspections_wo_upper;
DROP INDEX IF EXISTS idx_rrh_prog_inspections_wo;
DROP INDEX IF EXISTS idx_rrh_prog_inspections_status;
DROP INDEX IF EXISTS idx_rrh_prog_inspections_session;
DROP INDEX IF EXISTS idx_rrh_prog_inspections_scanned;
DROP INDEX IF EXISTS idx_rrh_prog_session_scanned_id;
DROP INDEX IF EXISTS idx_rrh_prog_sess_pagination;
DROP INDEX IF EXISTS idx_rrh_prog_lookup;

-- 6. rrh_pre_burn_in_inspections: Prune duplicate session and wo indexes
DROP INDEX IF EXISTS idx_rrh_pbi_inspections_session;
DROP INDEX IF EXISTS idx_rrh_pbi_inspections_session_scanned_id;
DROP INDEX IF EXISTS idx_rrh_pbi_inspections_status;
DROP INDEX IF EXISTS idx_rrh_pbi_inspections_wo;
DROP INDEX IF EXISTS idx_rrh_pbi_sess_pagination;

-- 7. rrh_hipot_inspections: Prune duplicate session and wo indexes
DROP INDEX IF EXISTS idx_rrh_hipot_inspections_session;
DROP INDEX IF EXISTS idx_rrh_hipot_inspections_session_scanned_id;
DROP INDEX IF EXISTS idx_rrh_hipot_inspections_status;
DROP INDEX IF EXISTS idx_rrh_hipot_inspections_wo;
DROP INDEX IF EXISTS idx_rrh_hipot_sess_pagination;

-- 8. rrh_post_burn_in_inspections: Prune duplicate session and wo indexes
DROP INDEX IF EXISTS idx_rrh_post_bi_inspections_session;
DROP INDEX IF EXISTS idx_rrh_post_bi_inspections_session_scanned_id;
DROP INDEX IF EXISTS idx_rrh_post_bi_inspections_status;
DROP INDEX IF EXISTS idx_rrh_post_bi_inspections_wo;
DROP INDEX IF EXISTS idx_rrh_post_bi_sess_pagination;

-- 9. Autovacuum Tuning for Hot Transactional Scan Tables
-- (Prevents dead tuple accumulation, table bloat, and index fragmentation)
ALTER TABLE rrh_inward_scans SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE rrh_ivi_inspections SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE rrh_ipqc_inspections SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE rrh_programming_inspections SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE rrh_pre_burn_in_inspections SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE rrh_hipot_inspections SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE rrh_post_burn_in_inspections SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);
