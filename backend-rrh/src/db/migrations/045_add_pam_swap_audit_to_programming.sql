-- Migration: 045_add_pam_swap_audit_to_programming.sql
-- Description: Adds E-Level, PAM TPNs, and PAM swap audit trail columns to rrh_programming_inspections

ALTER TABLE rrh_programming_inspections 
    ADD COLUMN IF NOT EXISTS e_level VARCHAR(255),
    ADD COLUMN IF NOT EXISTS pam1_2_tpn VARCHAR(255),
    ADD COLUMN IF NOT EXISTS pam3_4_tpn VARCHAR(255),
    ADD COLUMN IF NOT EXISTS is_pam_changed BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS pam_change_remarks TEXT,
    ADD COLUMN IF NOT EXISTS changed_component VARCHAR(255) DEFAULT 'None',
    ADD COLUMN IF NOT EXISTS previous_band VARCHAR(255),
    ADD COLUMN IF NOT EXISTS previous_e_level VARCHAR(255),
    ADD COLUMN IF NOT EXISTS previous_pam1_2 VARCHAR(255),
    ADD COLUMN IF NOT EXISTS previous_pam3_4 VARCHAR(255),
    ADD COLUMN IF NOT EXISTS new_band VARCHAR(255),
    ADD COLUMN IF NOT EXISTS new_e_level VARCHAR(255),
    ADD COLUMN IF NOT EXISTS new_pam1_2 VARCHAR(255),
    ADD COLUMN IF NOT EXISTS new_pam3_4 VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_rrh_prog_is_pam_changed 
    ON rrh_programming_inspections (is_pam_changed) 
    WHERE is_deleted = false;
