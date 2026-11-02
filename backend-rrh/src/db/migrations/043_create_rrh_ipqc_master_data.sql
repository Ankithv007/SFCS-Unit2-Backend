-- Migration: 043_create_rrh_ipqc_master_data.sql
-- Description: Creates rrh_ipqc_master_data table for dynamic PAM master data management

CREATE TABLE IF NOT EXISTS rrh_ipqc_master_data (
    id SERIAL PRIMARY KEY,
    band VARCHAR(100) NOT NULL,
    e_level VARCHAR(100) NOT NULL,
    pam1_2 VARCHAR(100) NOT NULL,
    pam3_4 VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rrh_ipqc_master_data_e_level_upper 
    ON rrh_ipqc_master_data (UPPER(TRIM(e_level)));

CREATE INDEX IF NOT EXISTS idx_rrh_ipqc_master_data_band 
    ON rrh_ipqc_master_data (band);
