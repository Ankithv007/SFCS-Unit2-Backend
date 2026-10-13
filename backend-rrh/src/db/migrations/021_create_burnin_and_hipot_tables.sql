-- Migration: 021_create_burnin_and_hipot_tables.sql
-- Description: Create high-performance enterprise tables, constraints, and latency-optimized indexes for Pre Burn In, Hipot, and Post Burn In

-- ============================================================================
-- 1. PRE BURN IN STAGE (Data fed from Programming stage)
-- ============================================================================

CREATE TABLE IF NOT EXISTS rrh_pre_burn_in_sessions (
    id SERIAL PRIMARY KEY,
    work_order_id VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'In Progress',
    created_by VARCHAR(255),
    created_by_name VARCHAR(255),
    updated_by VARCHAR(255),
    updated_by_name VARCHAR(255),
    deleted_by VARCHAR(255),
    deleted_by_name VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP,
    is_deleted BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_rrh_pbi_sessions_wo ON rrh_pre_burn_in_sessions(work_order_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_pbi_sessions_status ON rrh_pre_burn_in_sessions(status) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_pbi_sessions_created ON rrh_pre_burn_in_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rrh_pbi_sessions_wo_upper ON rrh_pre_burn_in_sessions(UPPER(TRIM(work_order_id)), status) WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS rrh_pre_burn_in_inspections (
    id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES rrh_pre_burn_in_sessions(id) ON DELETE CASCADE,
    work_order_id VARCHAR(255) NOT NULL,
    serial_number VARCHAR(255) NOT NULL,
    band_serial_no VARCHAR(255),
    physical_serial_number VARCHAR(255),
    physical_tpn VARCHAR(255),
    band VARCHAR(255),
    inspection_date DATE DEFAULT CURRENT_DATE,
    e_label VARCHAR(255),
    pam_tpn VARCHAR(255),
    pam1 VARCHAR(255),
    pam2 VARCHAR(255),
    pam3 VARCHAR(255),
    pam4 VARCHAR(255),
    rfpc_tpn VARCHAR(255),
    rfpc_sl_no VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'COMPLETED',
    remarks TEXT,
    scanned_by VARCHAR(255),
    scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    programming_inspection_id INTEGER REFERENCES rrh_programming_inspections(id) ON DELETE SET NULL,
    ipqc_inspection_id INTEGER REFERENCES rrh_ipqc_inspections(id) ON DELETE SET NULL,
    ivi_inspection_id INTEGER REFERENCES rrh_ivi_inspections(id) ON DELETE SET NULL,
    checkpoints JSONB DEFAULT '[]'::jsonb,
    is_reinspected BOOLEAN DEFAULT false,
    defect_fixed TEXT,
    sl_no VARCHAR(255),
    debug_status VARCHAR(50),
    debug_remarks TEXT,
    debug_by VARCHAR(255),
    debug_at TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_rrh_pbi_inspections_session ON rrh_pre_burn_in_inspections(session_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_pbi_inspections_wo ON rrh_pre_burn_in_inspections(work_order_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_pbi_inspections_status ON rrh_pre_burn_in_inspections(status);
CREATE INDEX IF NOT EXISTS idx_rrh_pbi_inspections_session_status_scanned ON rrh_pre_burn_in_inspections(session_id, status, scanned_at DESC, id DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_pbi_inspections_session_scanned_id ON rrh_pre_burn_in_inspections(session_id, scanned_at DESC, id DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_pbi_inspections_wo_status_scanned ON rrh_pre_burn_in_inspections(work_order_id, status, scanned_at DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_pbi_inspections_prog_id ON rrh_pre_burn_in_inspections(programming_inspection_id) WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_rrh_pbi_upper_serial ON rrh_pre_burn_in_inspections(UPPER(TRIM(serial_number))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_pbi_upper_band_serial ON rrh_pre_burn_in_inspections(UPPER(TRIM(COALESCE(band_serial_no, '')))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_pbi_upper_phys_serial ON rrh_pre_burn_in_inspections(UPPER(TRIM(COALESCE(physical_serial_number, '')))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_pbi_wo_upper ON rrh_pre_burn_in_inspections(UPPER(TRIM(work_order_id))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_pbi_debug_status ON rrh_pre_burn_in_inspections(session_id, debug_status) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_pbi_debug_wo ON rrh_pre_burn_in_inspections(work_order_id, debug_status) WHERE is_deleted = false;


-- ============================================================================
-- 2. HIPOT STAGE (Data fed from Pre Burn In stage)
-- ============================================================================

CREATE TABLE IF NOT EXISTS rrh_hipot_sessions (
    id SERIAL PRIMARY KEY,
    work_order_id VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'In Progress',
    created_by VARCHAR(255),
    created_by_name VARCHAR(255),
    updated_by VARCHAR(255),
    updated_by_name VARCHAR(255),
    deleted_by VARCHAR(255),
    deleted_by_name VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP,
    is_deleted BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_rrh_hipot_sessions_wo ON rrh_hipot_sessions(work_order_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_hipot_sessions_status ON rrh_hipot_sessions(status) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_hipot_sessions_created ON rrh_hipot_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rrh_hipot_sessions_wo_upper ON rrh_hipot_sessions(UPPER(TRIM(work_order_id)), status) WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS rrh_hipot_inspections (
    id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES rrh_hipot_sessions(id) ON DELETE CASCADE,
    work_order_id VARCHAR(255) NOT NULL,
    serial_number VARCHAR(255) NOT NULL,
    band_serial_no VARCHAR(255),
    physical_serial_number VARCHAR(255),
    physical_tpn VARCHAR(255),
    band VARCHAR(255),
    inspection_date DATE DEFAULT CURRENT_DATE,
    e_label VARCHAR(255),
    pam_tpn VARCHAR(255),
    pam1 VARCHAR(255),
    pam2 VARCHAR(255),
    pam3 VARCHAR(255),
    pam4 VARCHAR(255),
    rfpc_tpn VARCHAR(255),
    rfpc_sl_no VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'COMPLETED',
    remarks TEXT,
    scanned_by VARCHAR(255),
    scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    pre_burn_in_inspection_id INTEGER REFERENCES rrh_pre_burn_in_inspections(id) ON DELETE SET NULL,
    programming_inspection_id INTEGER REFERENCES rrh_programming_inspections(id) ON DELETE SET NULL,
    ipqc_inspection_id INTEGER REFERENCES rrh_ipqc_inspections(id) ON DELETE SET NULL,
    ivi_inspection_id INTEGER REFERENCES rrh_ivi_inspections(id) ON DELETE SET NULL,
    checkpoints JSONB DEFAULT '[]'::jsonb,
    is_reinspected BOOLEAN DEFAULT false,
    defect_fixed TEXT,
    sl_no VARCHAR(255),
    debug_status VARCHAR(50),
    debug_remarks TEXT,
    debug_by VARCHAR(255),
    debug_at TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_rrh_hipot_inspections_session ON rrh_hipot_inspections(session_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_hipot_inspections_wo ON rrh_hipot_inspections(work_order_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_hipot_inspections_status ON rrh_hipot_inspections(status);
CREATE INDEX IF NOT EXISTS idx_rrh_hipot_inspections_session_status_scanned ON rrh_hipot_inspections(session_id, status, scanned_at DESC, id DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_hipot_inspections_session_scanned_id ON rrh_hipot_inspections(session_id, scanned_at DESC, id DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_hipot_inspections_wo_status_scanned ON rrh_hipot_inspections(work_order_id, status, scanned_at DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_hipot_inspections_pbi_id ON rrh_hipot_inspections(pre_burn_in_inspection_id) WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_rrh_hipot_upper_serial ON rrh_hipot_inspections(UPPER(TRIM(serial_number))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_hipot_upper_band_serial ON rrh_hipot_inspections(UPPER(TRIM(COALESCE(band_serial_no, '')))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_hipot_upper_phys_serial ON rrh_hipot_inspections(UPPER(TRIM(COALESCE(physical_serial_number, '')))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_hipot_wo_upper ON rrh_hipot_inspections(UPPER(TRIM(work_order_id))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_hipot_debug_status ON rrh_hipot_inspections(session_id, debug_status) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_hipot_debug_wo ON rrh_hipot_inspections(work_order_id, debug_status) WHERE is_deleted = false;


-- ============================================================================
-- 3. POST BURN IN STAGE (Data fed from Hipot stage)
-- ============================================================================

CREATE TABLE IF NOT EXISTS rrh_post_burn_in_sessions (
    id SERIAL PRIMARY KEY,
    work_order_id VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'In Progress',
    created_by VARCHAR(255),
    created_by_name VARCHAR(255),
    updated_by VARCHAR(255),
    updated_by_name VARCHAR(255),
    deleted_by VARCHAR(255),
    deleted_by_name VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP,
    is_deleted BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_rrh_post_bi_sessions_wo ON rrh_post_burn_in_sessions(work_order_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_post_bi_sessions_status ON rrh_post_burn_in_sessions(status) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_post_bi_sessions_created ON rrh_post_burn_in_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rrh_post_bi_sessions_wo_upper ON rrh_post_burn_in_sessions(UPPER(TRIM(work_order_id)), status) WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS rrh_post_burn_in_inspections (
    id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES rrh_post_burn_in_sessions(id) ON DELETE CASCADE,
    work_order_id VARCHAR(255) NOT NULL,
    serial_number VARCHAR(255) NOT NULL,
    band_serial_no VARCHAR(255),
    physical_serial_number VARCHAR(255),
    physical_tpn VARCHAR(255),
    band VARCHAR(255),
    inspection_date DATE DEFAULT CURRENT_DATE,
    e_label VARCHAR(255),
    pam_tpn VARCHAR(255),
    pam1 VARCHAR(255),
    pam2 VARCHAR(255),
    pam3 VARCHAR(255),
    pam4 VARCHAR(255),
    rfpc_tpn VARCHAR(255),
    rfpc_sl_no VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'COMPLETED',
    remarks TEXT,
    scanned_by VARCHAR(255),
    scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    hipot_inspection_id INTEGER REFERENCES rrh_hipot_inspections(id) ON DELETE SET NULL,
    pre_burn_in_inspection_id INTEGER REFERENCES rrh_pre_burn_in_inspections(id) ON DELETE SET NULL,
    programming_inspection_id INTEGER REFERENCES rrh_programming_inspections(id) ON DELETE SET NULL,
    ipqc_inspection_id INTEGER REFERENCES rrh_ipqc_inspections(id) ON DELETE SET NULL,
    ivi_inspection_id INTEGER REFERENCES rrh_ivi_inspections(id) ON DELETE SET NULL,
    checkpoints JSONB DEFAULT '[]'::jsonb,
    is_reinspected BOOLEAN DEFAULT false,
    defect_fixed TEXT,
    sl_no VARCHAR(255),
    debug_status VARCHAR(50),
    debug_remarks TEXT,
    debug_by VARCHAR(255),
    debug_at TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_rrh_post_bi_inspections_session ON rrh_post_burn_in_inspections(session_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_post_bi_inspections_wo ON rrh_post_burn_in_inspections(work_order_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_post_bi_inspections_status ON rrh_post_burn_in_inspections(status);
CREATE INDEX IF NOT EXISTS idx_rrh_post_bi_inspections_session_status_scanned ON rrh_post_burn_in_inspections(session_id, status, scanned_at DESC, id DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_post_bi_inspections_session_scanned_id ON rrh_post_burn_in_inspections(session_id, scanned_at DESC, id DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_post_bi_inspections_wo_status_scanned ON rrh_post_burn_in_inspections(work_order_id, status, scanned_at DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_post_bi_inspections_hipot_id ON rrh_post_burn_in_inspections(hipot_inspection_id) WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_rrh_post_bi_upper_serial ON rrh_post_burn_in_inspections(UPPER(TRIM(serial_number))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_post_bi_upper_band_serial ON rrh_post_burn_in_inspections(UPPER(TRIM(COALESCE(band_serial_no, '')))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_post_bi_upper_phys_serial ON rrh_post_burn_in_inspections(UPPER(TRIM(COALESCE(physical_serial_number, '')))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_post_bi_wo_upper ON rrh_post_burn_in_inspections(UPPER(TRIM(work_order_id))) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_post_bi_debug_status ON rrh_post_burn_in_inspections(session_id, debug_status) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rrh_post_bi_debug_wo ON rrh_post_burn_in_inspections(work_order_id, debug_status) WHERE is_deleted = false;
