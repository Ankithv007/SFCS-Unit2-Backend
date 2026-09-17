/**
 * smtFgOperatorController.ts
 *
 * Admin Panel endpoints for managing the SMT-FG operator assignment per Work Order.
 *
 *  GET    /api/smt-fg/work-orders/:woId/operator-assignment
 *  POST   /api/smt-fg/work-orders/:woId/operator-assignment
 *  GET    /api/smt-fg/smt-operators            (dropdown list for Admin Panel)
 *  GET    /api/smt-fg/pending-fg-jobs           (Admin visibility into NEEDS_OPERATOR jobs)
 */

import { Request, Response } from 'express';
import pool, { authPool } from '../config/db';
import { createLogger } from '../utils/logger';
import { resetNeedsOperatorJobs } from '../services/autoFgService';

const logger = createLogger('SmtFgOperatorController');

// ─── Helper: get requesting user from JWT middleware ──────────────────────────

const getRequestingUser = (req: Request) => {
    const user = (req as any).user;
    return {
        id: user?.id || user?.userId || null,
        name: user?.employee_code || user?.email || user?.name || 'Unknown',
    };
};

// ─── Helper: validate that a user_id is active and belongs to SMT dept ────────

const validateSmtOperatorOrFail = async (
    userId: number
): Promise<{ user_id: number; employee_code: string; employee_name: string } | null> => {
    const res = await authPool.query(
        `SELECT u.id, u.employee_code, u.name AS employee_name
         FROM users u
         LEFT JOIN department_users du ON du.user_id = u.id
         LEFT JOIN departments d ON d.id = du.department_id
         WHERE u.id = $1
           AND (u.deleted_at IS NULL)
           AND (u.status = 'active' OR u.status IS NULL)
           AND u.employee_code IS NOT NULL
           AND TRIM(u.employee_code) != ''
         LIMIT 1`,
        [userId]
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
        user_id: row.id,
        employee_code: row.employee_code,
        employee_name: row.employee_name,
    };
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/smt-fg/smt-operators
// Returns active users who belong to SMT department (or all active operators with employee_code).
// Used to populate the Admin Panel dropdown.
// ─────────────────────────────────────────────────────────────────────────────

export const getSmtOperators = async (req: Request, res: Response) => {
    try {
        const result = await authPool.query(
            `SELECT u.id, u.employee_code, u.name AS employee_name, u.email
             FROM users u
             LEFT JOIN department_users du ON du.user_id = u.id
             LEFT JOIN departments d ON d.id = du.department_id
             WHERE (u.deleted_at IS NULL)
               AND (u.status = 'active' OR u.status IS NULL)
               AND u.employee_code IS NOT NULL
               AND TRIM(u.employee_code) != ''
               AND (UPPER(TRIM(d.name)) = 'SMT' OR NOT EXISTS (
                   SELECT 1 FROM department_users du2 
                   JOIN departments d2 ON d2.id = du2.department_id 
                   WHERE UPPER(TRIM(d2.name)) = 'SMT'
               ))
             ORDER BY (CASE WHEN UPPER(TRIM(d.name)) = 'SMT' THEN 0 ELSE 1 END), u.name ASC`
        );
        return res.status(200).json(result.rows);
    } catch (err: any) {
        logger.error('Error fetching SMT operators:', err.message);
        return res.status(500).json({ message: 'Internal server error fetching SMT operators.' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/smt-fg/work-orders/:woId/operator-assignment
// Returns the current SMT-FG operator assignment for a Work Order, or null.
// ─────────────────────────────────────────────────────────────────────────────

export const getOperatorAssignment = async (req: Request, res: Response) => {
    const { woId } = req.params;
    try {
        const result = await pool.query(
            `SELECT a.*
             FROM smt_fg_operator_assignments a
             WHERE a.work_order_id = $1`,
            [woId]
        );
        if (result.rows.length === 0) {
            return res.status(200).json(null);
        }
        const row = result.rows[0];
        try {
            const userCheck = await authPool.query(
                `SELECT (deleted_at IS NULL AND (status = 'active' OR status IS NULL)) AS operator_is_active
                 FROM users WHERE id = $1`,
                [row.user_id]
            );
            row.operator_is_active = userCheck.rows[0]?.operator_is_active ?? true;
        } catch {
            row.operator_is_active = true;
        }
        return res.status(200).json(row);
    } catch (err: any) {
        logger.error('Error fetching FG operator assignment:', err.message);
        return res.status(500).json({ message: 'Internal server error.' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/smt-fg/work-orders/:woId/operator-assignment
// Body: { user_id: number }
//
// Creates or replaces the SMT-FG operator assignment for a Work Order.
// Backend validates: employee exists, is active.
// Snapshots operator into any NEEDS_OPERATOR pending jobs for this WO.
// ─────────────────────────────────────────────────────────────────────────────

export const assignOperator = async (req: Request, res: Response) => {
    const { woId } = req.params;
    const { user_id } = req.body;
    const admin = getRequestingUser(req);

    if (!user_id || typeof user_id !== 'number') {
        return res.status(400).json({ message: 'user_id (number) is required.' });
    }

    // 1. Confirm work order exists
    const woCheck = await pool.query(
        `SELECT id FROM smt_work_orders WHERE id = $1`,
        [woId]
    );
    if (woCheck.rows.length === 0) {
        return res.status(404).json({ message: `Work Order ${woId} not found.` });
    }

    // 2. Validate the operator belongs to SMT and is active
    const validOp = await validateSmtOperatorOrFail(user_id);
    if (!validOp) {
        return res.status(400).json({
            message:
                'The selected user does not exist, is not active, or does not have an employee code.',
        });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 3. Fetch previous assignment for audit
        const prevRes = await client.query(
            `SELECT user_id, employee_code, employee_name FROM smt_fg_operator_assignments WHERE work_order_id=$1`,
            [woId]
        );
        const prevRow = prevRes.rows[0] || null;

        // 4. Upsert the assignment
        await client.query(
            `INSERT INTO smt_fg_operator_assignments (
                work_order_id, user_id, employee_code, employee_name,
                assigned_by, assigned_by_id, updated_at
             ) VALUES ($1,$2,$3,$4,$5,$6,NOW())
             ON CONFLICT (work_order_id) DO UPDATE
             SET user_id          = EXCLUDED.user_id,
                 employee_code    = EXCLUDED.employee_code,
                 employee_name    = EXCLUDED.employee_name,
                 assigned_by      = EXCLUDED.assigned_by,
                 assigned_by_id   = EXCLUDED.assigned_by_id,
                 updated_at       = NOW()`,
            [
                woId,
                validOp.user_id,
                validOp.employee_code,
                validOp.employee_name,
                admin.name,
                admin.id,
            ]
        );

        // 5. Audit log
        await client.query(
            `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description, old_value, new_value)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [
                'SMT_FG_OPERATOR_ASSIGNED',
                'WORK_ORDER',
                woId,
                admin.name,
                `SMT-FG operator for WO ${woId} ${prevRow ? 'changed' : 'assigned'} to ${validOp.employee_code} (${validOp.employee_name}).`,
                prevRow ? JSON.stringify({ employee_code: prevRow.employee_code, employee_name: prevRow.employee_name }) : null,
                JSON.stringify({ user_id: validOp.user_id, employee_code: validOp.employee_code, employee_name: validOp.employee_name }),
            ]
        );

        await client.query('COMMIT');

        // 6. Outside the transaction: reset any NEEDS_OPERATOR jobs for this WO
        //    (non-fatal if it fails)
        try {
            const resetCount = await resetNeedsOperatorJobs(woId, validOp);
            if (resetCount > 0) {
                logger.info(`[FgOperator] Reset ${resetCount} NEEDS_OPERATOR job(s) to PENDING for WO ${woId}.`);
            }
        } catch (resetErr: any) {
            logger.warn(`[FgOperator] resetNeedsOperatorJobs failed for WO ${woId}: ${resetErr.message}`);
        }

        return res.status(200).json({
            message: `SMT-FG operator assigned successfully.`,
            assignment: {
                work_order_id: woId,
                user_id: validOp.user_id,
                employee_code: validOp.employee_code,
                employee_name: validOp.employee_name,
            },
        });
    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error('Error assigning FG operator:', err.message);
        return res.status(500).json({ message: 'Internal server error.' });
    } finally {
        client.release();
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/smt-fg/pending-fg-jobs
// Query params: status (PENDING|NEEDS_OPERATOR|PROCESSING|DONE|FAILED), woId
// Returns pending auto-FG jobs for admin visibility.
// ─────────────────────────────────────────────────────────────────────────────

export const getPendingFgJobs = async (req: Request, res: Response) => {
    const { status, woId } = req.query;
    try {
        let query = `
            SELECT j.*,
                   wo.po_id,
                   wo.product_name
            FROM pending_auto_fg_jobs j
            LEFT JOIN smt_work_orders wo ON wo.id = j.work_order_id
            WHERE 1=1
        `;
        const params: any[] = [];
        let p = 1;

        if (status) {
            query += ` AND j.status = $${p++}`;
            params.push(status);
        }
        if (woId) {
            query += ` AND j.work_order_id = $${p++}`;
            params.push(woId);
        }

        query += ` ORDER BY j.created_at DESC LIMIT 200`;

        const result = await pool.query(query, params);
        return res.status(200).json(result.rows);
    } catch (err: any) {
        logger.error('Error fetching pending FG jobs:', err.message);
        return res.status(500).json({ message: 'Internal server error.' });
    }
};
