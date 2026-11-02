-- ROLLBACK FOR 003_status_checks.sql
ALTER TABLE rrh_work_orders DROP CONSTRAINT IF EXISTS chk_rrh_work_orders_status;
ALTER TABLE rrh_excel_imports DROP CONSTRAINT IF EXISTS chk_rrh_excel_imports_status;
ALTER TABLE rrh_inward_sessions DROP CONSTRAINT IF EXISTS chk_rrh_inward_sessions_status;
ALTER TABLE rrh_inward_scans DROP CONSTRAINT IF EXISTS chk_rrh_inward_scans_status;
ALTER TABLE rrh_ivi_sessions DROP CONSTRAINT IF EXISTS chk_rrh_ivi_sessions_status;
ALTER TABLE rrh_ivi_inspections DROP CONSTRAINT IF EXISTS chk_rrh_ivi_inspections_status;
