-- Migration 036: Solder Paste Management Parent-Child Architecture
-- Create new normalized tables and migrate data safely. Do NOT drop old tables yet.

-- 1. Create Solder Paste Master table (Parent)
CREATE TABLE IF NOT EXISTS smt_solder_paste_master (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model       VARCHAR(100) NOT NULL,
    make        VARCHAR(100) NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_by  VARCHAR(255),
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by  VARCHAR(255),
    updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT smt_solder_paste_master_model_make_unique UNIQUE (model, make)
);

-- 2. Create Solder Paste Cans table (Child)
CREATE TABLE IF NOT EXISTS smt_solder_paste_cans (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    master_id           UUID NOT NULL REFERENCES smt_solder_paste_master(id) ON DELETE CASCADE,
    can_id              VARCHAR(100) UNIQUE NOT NULL,
    manufacturing_date  DATE NOT NULL,
    expiry_date         DATE NOT NULL,
    total_weight_g      NUMERIC(10,2) NOT NULL CHECK (total_weight_g > 0),
    used_weight_g       NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (used_weight_g >= 0),
    min_thawing_hours   NUMERIC(5,2) NOT NULL DEFAULT 4 CHECK (min_thawing_hours >= 0),
    max_working_hours   NUMERIC(5,2) NOT NULL DEFAULT 8 CHECK (max_working_hours > 0),
    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_by          VARCHAR(255),
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by          VARCHAR(255),
    updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT smt_solder_paste_cans_used_lte_total CHECK (used_weight_g <= total_weight_g)
);

-- 3. Create Solder Paste Sessions table
CREATE TABLE IF NOT EXISTS smt_solder_paste_sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    can_id              UUID NOT NULL REFERENCES smt_solder_paste_cans(id) ON DELETE CASCADE,
    removed_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    thawing_ready_at    TIMESTAMP NOT NULL,
    working_expires_at  TIMESTAMP NOT NULL,
    operator            VARCHAR(255),
    notes               TEXT,
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. Create Solder Paste Usage History table (Audit log + Consumption log)
CREATE TABLE IF NOT EXISTS smt_solder_paste_usage_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    can_id          UUID NOT NULL REFERENCES smt_solder_paste_cans(id) ON DELETE CASCADE,
    master_id       UUID NOT NULL REFERENCES smt_solder_paste_master(id) ON DELETE CASCADE,
    weight_used_g   NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (weight_used_g >= 0),
    operator        VARCHAR(255),
    machine         VARCHAR(100),
    work_order      VARCHAR(100),
    logged_date     DATE NOT NULL DEFAULT CURRENT_DATE,
    logged_time     TIME NOT NULL DEFAULT CURRENT_TIME,
    action          VARCHAR(100) NOT NULL, -- 'CREATE' | 'UPDATE' | 'DEACTIVATE' | 'SESSION_START' | 'CONSUME'
    notes           TEXT,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 5. Create Indexes
CREATE INDEX IF NOT EXISTS idx_smt_solder_paste_master_model_make ON smt_solder_paste_master(model, make);
CREATE INDEX IF NOT EXISTS idx_smt_solder_paste_cans_master_id ON smt_solder_paste_cans(master_id);
CREATE INDEX IF NOT EXISTS idx_smt_solder_paste_cans_expiry ON smt_solder_paste_cans(expiry_date ASC);
CREATE INDEX IF NOT EXISTS idx_smt_solder_paste_cans_active ON smt_solder_paste_cans(is_active);
CREATE INDEX IF NOT EXISTS idx_smt_solder_paste_cans_can_id ON smt_solder_paste_cans(can_id);
CREATE INDEX IF NOT EXISTS idx_smt_solder_paste_usage_can ON smt_solder_paste_usage_history(can_id);
CREATE INDEX IF NOT EXISTS idx_smt_solder_paste_usage_master ON smt_solder_paste_usage_history(master_id);

-- 6. Safe Migration of Existing Data
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'smt_sp_master') THEN
        -- Migrate to smt_solder_paste_master
        INSERT INTO smt_solder_paste_master (model, make, is_active, created_by, created_at, updated_by, updated_at)
        SELECT DISTINCT model, make, is_active, created_by, created_at, updated_by, updated_at
        FROM smt_sp_master
        ON CONFLICT (model, make) DO NOTHING;

        -- Migrate to smt_solder_paste_cans
        INSERT INTO smt_solder_paste_cans (id, master_id, can_id, manufacturing_date, expiry_date, total_weight_g, used_weight_g, min_thawing_hours, max_working_hours, is_active, created_by, created_at, updated_by, updated_at)
        SELECT m.id, pm.id, m.can_id, m.manufacturing_date, m.expiry_date, m.total_weight_g, m.used_weight_g, m.min_thawing_hours, m.max_working_hours, m.is_active, m.created_by, m.created_at, m.updated_by, m.updated_at
        FROM smt_sp_master m
        JOIN smt_solder_paste_master pm ON pm.model = m.model AND pm.make = m.make
        ON CONFLICT (can_id) DO NOTHING;
    END IF;

    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'smt_sp_sessions') THEN
        -- Migrate to smt_solder_paste_sessions
        INSERT INTO smt_solder_paste_sessions (id, can_id, removed_at, thawing_ready_at, working_expires_at, operator, notes, created_at)
        SELECT s.id, s.can_id, s.removed_at, s.thawing_ready_at, s.working_expires_at, s.operator, s.notes, s.created_at
        FROM smt_sp_sessions s
        JOIN smt_solder_paste_cans c ON s.can_id = c.id
        ON CONFLICT DO NOTHING;
    END IF;

    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'smt_sp_consumption') THEN
        -- Migrate to smt_solder_paste_usage_history (consumptions)
        INSERT INTO smt_solder_paste_usage_history (id, can_id, master_id, weight_used_g, operator, logged_date, logged_time, action, notes, created_at)
        SELECT c.id, c.can_id, cn.master_id, c.weight_consumed_g, c.consumed_by, c.consumed_at::date, c.consumed_at::time, 'CONSUME', c.notes, c.consumed_at
        FROM smt_sp_consumption c
        JOIN smt_solder_paste_cans cn ON c.can_id = cn.id
        ON CONFLICT DO NOTHING;
    END IF;

    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'smt_sp_audit') THEN
        -- Migrate to smt_solder_paste_usage_history (audits)
        INSERT INTO smt_solder_paste_usage_history (id, can_id, master_id, weight_used_g, operator, logged_date, logged_time, action, notes, created_at)
        SELECT a.id, a.can_id, cn.master_id, 0, a.performed_by, a.performed_at::date, a.performed_at::time, a.action, a.notes, a.performed_at
        FROM smt_sp_audit a
        JOIN smt_solder_paste_cans cn ON a.can_id = cn.id
        WHERE a.id NOT IN (SELECT id FROM smt_solder_paste_usage_history)
        ON CONFLICT DO NOTHING;
    END IF;
END $$;
