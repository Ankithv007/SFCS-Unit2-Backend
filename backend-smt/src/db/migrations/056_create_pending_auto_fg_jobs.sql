-- Migration 056: Auto SMT-FG scheduling tables
-- 
-- SAFETY GATE (Correction 2):
-- Before this migration is applied in production, run the following query and
-- confirm it returns 0 rows. If any rows are returned, STOP and investigate:
--
--   SELECT fg_session_id, serial_id, COUNT(*) AS cnt
--   FROM smt_inspections
--   WHERE process_step = 'SMT FG' AND status = 'PASS'
--     AND fg_session_id IS NOT NULL AND serial_id IS NOT NULL
--   GROUP BY fg_session_id, serial_id
--   HAVING COUNT(*) > 1;
--
-- Only proceed when the above returns 0 rows.
-- ──────────────────────────────────────────────────────────────────────────────

-- 1. Work-order level SMT-FG operator assignments
CREATE TABLE IF NOT EXISTS smt_fg_operator_assignments (
    id                SERIAL       PRIMARY KEY,
    work_order_id     VARCHAR(100) NOT NULL REFERENCES smt_work_orders(id) ON DELETE CASCADE,
    user_id           INT          NOT NULL,               -- users.id in the shared DB
    employee_code     VARCHAR(100) NOT NULL,
    employee_name     VARCHAR(255) NOT NULL,
    assigned_by       VARCHAR(255) NOT NULL,               -- admin who made the change
    assigned_by_id    INT,                                 -- admin users.id
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT smt_fg_operator_assignments_wo_unique UNIQUE (work_order_id)
);

CREATE INDEX IF NOT EXISTS idx_smt_fg_operator_assignments_wo
    ON smt_fg_operator_assignments(work_order_id);

-- 2. Persistent pending automatic SMT-FG jobs
CREATE TABLE IF NOT EXISTS pending_auto_fg_jobs (
    id                    SERIAL       PRIMARY KEY,
    work_order_id         VARCHAR(100) NOT NULL,
    serial_id             INT          NOT NULL,
    scanned_barcode       VARCHAR(255) NOT NULL,
    post_aoi_session_id   VARCHAR(255) NOT NULL,           -- source session for audit trail

    -- Operator snapshotted at job-creation time
    assigned_user_id      INT,                             -- NULL → NEEDS_OPERATOR
    assigned_employee_code VARCHAR(100),
    assigned_employee_name VARCHAR(255),

    -- Scheduling
    execute_after         TIMESTAMPTZ  NOT NULL,
    status                VARCHAR(50)  NOT NULL DEFAULT 'PENDING',
                                                           -- PENDING | NEEDS_OPERATOR | PROCESSING | DONE | FAILED

    -- Outcome tracking
    fg_session_id         VARCHAR(255),                    -- filled on DONE
    inspection_id         INT,                             -- filled on DONE
    error_message         TEXT,

    created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Prevent duplicate pending jobs for the same barcode in the same session
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_auto_fg_unique
    ON pending_auto_fg_jobs(post_aoi_session_id, serial_id)
    WHERE status NOT IN ('DONE', 'FAILED');

-- Fast poller query: find overdue PENDING jobs
CREATE INDEX IF NOT EXISTS idx_pending_auto_fg_status_execute
    ON pending_auto_fg_jobs(status, execute_after)
    WHERE status = 'PENDING';

-- For admin "NEEDS_OPERATOR" dashboard view
CREATE INDEX IF NOT EXISTS idx_pending_auto_fg_needs_op
    ON pending_auto_fg_jobs(status)
    WHERE status = 'NEEDS_OPERATOR';
