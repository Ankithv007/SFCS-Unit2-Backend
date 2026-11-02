-- ============================================================
-- Migration 035: Solder Paste Management (Complete Redesign)
-- New centralized tables for FIFO can management
-- NOTE: smt_work_orders solder_paste_* columns are NOT dropped
--       to preserve SMT Traceability read-only display.
-- ============================================================

-- 1. Solder Paste Can Inventory (Master List)
CREATE TABLE IF NOT EXISTS smt_sp_master (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model               VARCHAR(100)   NOT NULL,
    make                VARCHAR(100)   NOT NULL,
    can_id              VARCHAR(100)   NOT NULL,
    manufacturing_date  DATE           NOT NULL,
    expiry_date         DATE           NOT NULL,
    total_weight_g      NUMERIC(10,2)  NOT NULL CHECK (total_weight_g  > 0),
    used_weight_g       NUMERIC(10,2)  NOT NULL DEFAULT 0 CHECK (used_weight_g >= 0),
    min_thawing_hours   NUMERIC(5,2)   NOT NULL DEFAULT 4  CHECK (min_thawing_hours >= 0),
    max_working_hours   NUMERIC(5,2)   NOT NULL DEFAULT 8  CHECK (max_working_hours  > 0),
    is_active           BOOLEAN        NOT NULL DEFAULT true,
    created_by          VARCHAR(255),
    created_at          TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by          VARCHAR(255),
    updated_at          TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT smt_sp_master_can_id_unique UNIQUE (can_id),
    CONSTRAINT smt_sp_master_expiry_after_mfg CHECK (expiry_date > manufacturing_date),
    CONSTRAINT smt_sp_master_used_lte_total  CHECK (used_weight_g <= total_weight_g)
);

-- 2. Refrigerator Removal Sessions
CREATE TABLE IF NOT EXISTS smt_sp_sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    can_id              UUID           NOT NULL REFERENCES smt_sp_master(id) ON DELETE RESTRICT,
    removed_at          TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    thawing_ready_at    TIMESTAMP      NOT NULL,
    working_expires_at  TIMESTAMP      NOT NULL,
    operator            VARCHAR(255),
    notes               TEXT,
    created_at          TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Weight Consumption History
CREATE TABLE IF NOT EXISTS smt_sp_consumption (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    can_id              UUID           NOT NULL REFERENCES smt_sp_master(id) ON DELETE RESTRICT,
    session_id          UUID               REFERENCES smt_sp_sessions(id)  ON DELETE SET NULL,
    weight_consumed_g   NUMERIC(10,2)  NOT NULL CHECK (weight_consumed_g > 0),
    consumed_by         VARCHAR(255),
    consumed_at         TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notes               TEXT
);

-- 4. Audit Log
CREATE TABLE IF NOT EXISTS smt_sp_audit (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    can_id       UUID           REFERENCES smt_sp_master(id) ON DELETE SET NULL,
    action       VARCHAR(60)    NOT NULL,  -- CREATE | UPDATE | DEACTIVATE | SESSION_START | CONSUME
    performed_by VARCHAR(255),
    performed_at TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    old_data     JSONB,
    new_data     JSONB,
    notes        TEXT
);

-- Indexes for query performance
CREATE INDEX IF NOT EXISTS idx_smt_sp_master_model      ON smt_sp_master(LOWER(model));
CREATE INDEX IF NOT EXISTS idx_smt_sp_master_make       ON smt_sp_master(LOWER(make));
CREATE INDEX IF NOT EXISTS idx_smt_sp_master_expiry     ON smt_sp_master(expiry_date ASC);
CREATE INDEX IF NOT EXISTS idx_smt_sp_master_active     ON smt_sp_master(is_active);
CREATE INDEX IF NOT EXISTS idx_smt_sp_sessions_can      ON smt_sp_sessions(can_id);
CREATE INDEX IF NOT EXISTS idx_smt_sp_sessions_removed  ON smt_sp_sessions(removed_at DESC);
CREATE INDEX IF NOT EXISTS idx_smt_sp_consumption_can   ON smt_sp_consumption(can_id);
CREATE INDEX IF NOT EXISTS idx_smt_sp_audit_can         ON smt_sp_audit(can_id);
