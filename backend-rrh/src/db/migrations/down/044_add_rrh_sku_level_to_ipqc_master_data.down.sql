-- Migration: 044_add_rrh_sku_level_to_ipqc_master_data.down.sql
DROP INDEX IF EXISTS idx_rrh_ipqc_master_data_sku;
ALTER TABLE rrh_ipqc_master_data DROP COLUMN IF EXISTS rrh_sku_level;
