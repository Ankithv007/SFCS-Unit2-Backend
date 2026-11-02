-- Migration: 044_add_rrh_sku_level_to_ipqc_master_data.sql
-- Description: Adds rrh_sku_level column to rrh_ipqc_master_data table

ALTER TABLE rrh_ipqc_master_data 
    ADD COLUMN IF NOT EXISTS rrh_sku_level VARCHAR(100) DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_master_data_sku 
    ON rrh_ipqc_master_data (rrh_sku_level);
