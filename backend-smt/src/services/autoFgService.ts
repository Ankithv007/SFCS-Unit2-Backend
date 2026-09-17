/**
 * autoFgService.ts
 *
 * Handles all logic for the automatic Post-AOI → SMT-FG transition.
 *
 * Responsibilities:
 *  1. scheduleAutoFgJob()      — called from postAoiController after a Top PASS
 *  2. processAutoFgJobs()      — polling loop, called every 10 s from index.ts
 *  3. resetNeedsOperatorJobs() — called from smtFgOperatorController when an
 *                                 assignment is created/updated for a WO
 */

import pool, { authPool } from '../config/db';
import { createLogger } from '../utils/logger';
import { notifySmtDashboardUpdate } from '../utils/dashboardEmitter';
import { getAutoPopulateDetailsHelper } from '../utils/smtHelper';

const logger = createLogger('AutoFgService');

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AssignedOperator {
    user_id: number;
    employee_code: string;
    employee_name: string;
}

// ─── 1. Operator Lookup & Fallback Helpers ─────────────────────────────────────

/**
 * Validate that a user_id exists, is active, and has an employee_code in auth DB.
 */
export const validateSmtOperator = async (userId: number): Promise<boolean> => {
    try {
        const res = await authPool.query(
            `SELECT u.id
             FROM users u
             WHERE u.id = $1
               AND (u.deleted_at IS NULL)
               AND (u.status = 'active' OR u.status IS NULL)
             LIMIT 1`,
            [userId]
        );
        return res.rows.length > 0;
    } catch (err: any) {
        logger.error(`[AutoFG] validateSmtOperator error: ${err.message}`);
        return false;
    }
};

/**
 * Fetch default active operator (prioritizing SMT department) to ensure
 * production never stalls even if the admin has not yet assigned an operator.
 */
export const getDefaultSmtOperator = async (): Promise<AssignedOperator | null> => {
    try {
        const res = await authPool.query(
            `SELECT u.id, u.employee_code, u.name AS employee_name
             FROM users u
             LEFT JOIN department_users du ON du.user_id = u.id
             LEFT JOIN departments d ON d.id = du.department_id
             WHERE (u.deleted_at IS NULL)
               AND (u.status = 'active' OR u.status IS NULL)
               AND u.employee_code IS NOT NULL
               AND TRIM(u.employee_code) != ''
             ORDER BY (CASE WHEN UPPER(TRIM(d.name)) = 'SMT' THEN 0 ELSE 1 END), u.id ASC
             LIMIT 1`
        );
        if (res.rows.length > 0) {
            return {
                user_id: res.rows[0].id,
                employee_code: res.rows[0].employee_code,
                employee_name: res.rows[0].employee_name,
            };
        }
        return null;
    } catch (err: any) {
        logger.error(`[AutoFG] getDefaultSmtOperator error: ${err.message}`);
        return null;
    }
};

// ─── 2. Schedule a Job ────────────────────────────────────────────────────────

/**
 * Called immediately after a final applicable Post-AOI PASS is committed.
 *
 * Preconditions already met by postAoiController:
 *   - The Post-AOI stage is the final applicable stage for this Work Order side flow.
 *   - targetSide is 'Top' or 'Bottom'.
 *
 * This function runs in the same request context but OUTSIDE the already-
 * committed transaction so that a failure here does not roll back the PASS.
 */
export const scheduleAutoFgJob = async (
    workOrderId: string,
    serialId: number,
    scannedBarcode: string,
    postAoiSessionId: string,
    targetSide: string = 'Top'
): Promise<void> => {
    try {
        const sideNorm = (targetSide || 'Top').trim().toLowerCase() === 'bottom' ? 'Bottom' : 'Top';

        // 1. Look up the currently assigned SMT-FG operator for this WO
        let assignmentRes = await pool.query(
            `SELECT user_id, employee_code, employee_name
             FROM smt_fg_operator_assignments
             WHERE work_order_id = $1`,
            [workOrderId]
        );

        let assignedOp: AssignedOperator | null = null;

        if (assignmentRes.rows.length > 0) {
            const row = assignmentRes.rows[0];
            const validOp = await validateSmtOperator(row.user_id);
            if (validOp) {
                assignedOp = {
                    user_id: row.user_id,
                    employee_code: row.employee_code,
                    employee_name: row.employee_name,
                };
            } else {
                logger.warn(
                    `[AutoFG] WO ${workOrderId}: assigned operator user_id=${row.user_id} ` +
                    `(${row.employee_code}) is no longer active or in SMT department.`
                );
            }
        }

        // If no operator is pre-assigned by Admin, auto-assign the active SMT department operator
        // to smt_fg_operator_assignments so production never stalls and operator is tracked on the WO.
        if (!assignedOp) {
            const defaultOp = await getDefaultSmtOperator();
            if (defaultOp) {
                await pool.query(
                    `INSERT INTO smt_fg_operator_assignments (
                        work_order_id, user_id, employee_code, employee_name,
                        assigned_by, assigned_by_id, updated_at
                     ) VALUES ($1, $2, $3, $4, 'System', $2, NOW())
                     ON CONFLICT (work_order_id) DO NOTHING`,
                    [workOrderId, defaultOp.user_id, defaultOp.employee_code, defaultOp.employee_name]
                );
                assignedOp = defaultOp;
                logger.info(
                    `[AutoFG] WO ${workOrderId}: Auto-assigned eligible SMT operator ${defaultOp.employee_code} (${defaultOp.employee_name}).`
                );
            }
        }

        const status = assignedOp ? 'PENDING' : 'NEEDS_OPERATOR';

        // 2. Random delay: 20–40 seconds per barcode
        const delaySec = Math.floor(Math.random() * 21) + 20; // [20, 40]
        const executeAfter = new Date(Date.now() + delaySec * 1000);

        // Pre-check for duplicate pending job
        const existingJob = await pool.query(
            `SELECT id FROM pending_auto_fg_jobs
             WHERE post_aoi_session_id = $1 AND serial_id = $2
               AND status NOT IN ('DONE', 'FAILED')
             LIMIT 1`,
            [postAoiSessionId, serialId]
        );
        if (existingJob.rows.length > 0) {
            logger.info(`[AutoFG] Job already exists for postAoiSessionId=${postAoiSessionId}, serialId=${serialId}`);
            return;
        }

        await pool.query(
            `INSERT INTO pending_auto_fg_jobs (
                work_order_id, serial_id, scanned_barcode, post_aoi_session_id,
                assigned_user_id, assigned_employee_code, assigned_employee_name,
                execute_after, status, side
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (post_aoi_session_id, serial_id) WHERE status NOT IN ('DONE', 'FAILED') DO NOTHING`,
            [
                workOrderId,
                serialId,
                scannedBarcode,
                postAoiSessionId,
                assignedOp?.user_id ?? null,
                assignedOp?.employee_code ?? null,
                assignedOp?.employee_name ?? null,
                executeAfter.toISOString(),
                status,
                sideNorm,
            ]
        );

        console.log(`
==================================================
AUTO-FG CREATED
WO: ${workOrderId}
Barcode: ${scannedBarcode}
Serial ID: ${serialId}
Post-AOI inspection ID: ${postAoiSessionId}
FG side: ${sideNorm}
Execute after: ${executeAfter.toISOString()} (${delaySec}s delay)
Operator: ${assignedOp ? `${assignedOp.employee_name} (${assignedOp.employee_code})` : 'MISSING (NEEDS_OPERATOR)'}
==================================================`);

    } catch (err: any) {
        // Log but do NOT rethrow — must not affect the Post-AOI response
        logger.error(`[AutoFG] scheduleAutoFgJob error for WO ${workOrderId}:`, err.message);
    }
};

// ─── 3. Process Pending Jobs (polling) ───────────────────────────────────────

/**
 * Runs on a setInterval in index.ts.
 * Picks up overdue PENDING & recoverable NEEDS_OPERATOR jobs, executes the SMT-FG PASS, marks them DONE.
 */
export const processAutoFgJobs = async (): Promise<void> => {
    const client = await pool.connect();
    try {
        // Claim a batch of up to 25 overdue jobs atomically
        const claimRes = await client.query(
            `UPDATE pending_auto_fg_jobs
             SET status = 'PROCESSING', updated_at = NOW()
             WHERE id = ANY(
                 SELECT id FROM pending_auto_fg_jobs
                 WHERE status IN ('PENDING', 'NEEDS_OPERATOR')
                   AND execute_after <= NOW()
                 ORDER BY execute_after
                 LIMIT 25
                 FOR UPDATE SKIP LOCKED
             )
             RETURNING *`
        );

        if (claimRes.rows.length === 0) return;

        for (const job of claimRes.rows) {
            await processOneJob(client, job);
        }
    } catch (err: any) {
        logger.error('[AutoFG] processAutoFgJobs outer error:', err.message);
    } finally {
        client.release();
    }
};

// ─── Internal: Process One Job ────────────────────────────────────────────────

const processOneJob = async (client: any, job: any): Promise<void> => {
    const {
        id: jobId,
        work_order_id: workOrderId,
        serial_id: serialId,
        scanned_barcode: scannedBarcode,
    } = job;
    const jobSide = (job.side || 'Top').trim().toLowerCase() === 'bottom' ? 'Bottom' : 'Top';

    let assignedUserId = job.assigned_user_id;
    let assignedEmployeeCode = job.assigned_employee_code;
    let assignedEmployeeName = job.assigned_employee_name;

    console.log(`
==================================================
AUTO-FG EXECUTING
WO: ${workOrderId}
Barcode: ${scannedBarcode}
Job ID: ${jobId}
==================================================`);

    try {
        // 1. Operator verification & auto-recovery
        let validOp = false;
        if (assignedUserId) {
            validOp = await validateSmtOperator(assignedUserId);
        }

        if (!validOp) {
            // Check smt_fg_operator_assignments
            const assignRes = await client.query(
                `SELECT user_id, employee_code, employee_name FROM smt_fg_operator_assignments WHERE work_order_id = $1`,
                [workOrderId]
            );
            if (assignRes.rows.length > 0) {
                const row = assignRes.rows[0];
                if (await validateSmtOperator(row.user_id)) {
                    assignedUserId = row.user_id;
                    assignedEmployeeCode = row.employee_code;
                    assignedEmployeeName = row.employee_name;
                    validOp = true;
                }
            }
        }

        if (!validOp) {
            // Auto-resolve eligible SMT department operator
            const defaultOp = await getDefaultSmtOperator();
            if (defaultOp) {
                assignedUserId = defaultOp.user_id;
                assignedEmployeeCode = defaultOp.employee_code;
                assignedEmployeeName = defaultOp.employee_name;
                validOp = true;
                await client.query(
                    `INSERT INTO smt_fg_operator_assignments (
                        work_order_id, user_id, employee_code, employee_name,
                        assigned_by, assigned_by_id, updated_at
                     ) VALUES ($1, $2, $3, $4, 'System', $2, NOW())
                     ON CONFLICT (work_order_id) DO UPDATE
                     SET user_id = EXCLUDED.user_id,
                         employee_code = EXCLUDED.employee_code,
                         employee_name = EXCLUDED.employee_name,
                         updated_at = NOW()`,
                    [workOrderId, defaultOp.user_id, defaultOp.employee_code, defaultOp.employee_name]
                );
            }
        }

        if (!validOp) {
            logger.warn(`[AutoFG] Job ${jobId} has no valid assigned SMT operator. Setting status to NEEDS_OPERATOR.`);
            await client.query(
                `UPDATE pending_auto_fg_jobs SET status='NEEDS_OPERATOR', updated_at=NOW() WHERE id=$1`,
                [jobId]
            );
            console.log(`
==================================================
AUTO-FG FAILED
WO: ${workOrderId}
Barcode: ${scannedBarcode}
Reason: No active SMT-FG operator assigned or available in SMT department.
==================================================`);
            return;
        }

        // 2. Get WO details
        const woRes = await client.query(
            `SELECT id, quantity, sides FROM smt_work_orders WHERE id=$1`,
            [workOrderId]
        );
        if (woRes.rows.length === 0) {
            await markJobFailed(client, jobId, `Work order ${workOrderId} not found.`);
            console.log(`
==================================================
AUTO-FG FAILED
WO: ${workOrderId}
Barcode: ${scannedBarcode}
Reason: Work order ${workOrderId} not found.
==================================================`);
            return;
        }
        const wo = woRes.rows[0];

        // 3. Get/create the SMT-FG session for the target side of this WO
        const fgSession = await getOrCreateFgSession(client, workOrderId, assignedEmployeeCode, wo, jobSide);
        if (!fgSession) {
            await markJobFailed(client, jobId, `Could not obtain SMT-FG session for WO ${workOrderId} ${jobSide}.`);
            console.log(`
==================================================
AUTO-FG FAILED
WO: ${workOrderId}
Barcode: ${scannedBarcode}
Reason: Could not obtain SMT-FG session for WO ${workOrderId} ${jobSide}.
==================================================`);
            return;
        }

        // 4. Idempotency: check if this barcode or serial is already PASS in this FG session
        const dupCheck = await client.query(
            `SELECT id FROM smt_inspections
             WHERE fg_session_id=$1 AND (serial_id=$2 OR scanned_barcode=$3) AND status='PASS'`,
            [fgSession.id, serialId, scannedBarcode]
        );
        if (dupCheck.rows.length > 0) {
            logger.info(`[AutoFG] Job ${jobId}: barcode ${scannedBarcode} already PASS in FG session ${fgSession.id}. Marking DONE.`);
            await client.query(
                `UPDATE pending_auto_fg_jobs
                 SET status='DONE', fg_session_id=$2,
                     assigned_user_id=$3, assigned_employee_code=$4, assigned_employee_name=$5,
                     updated_at=NOW()
                 WHERE id=$1`,
                [jobId, String(fgSession.id), assignedUserId, assignedEmployeeCode, assignedEmployeeName]
            );
            console.log(`
==================================================
AUTO-FG SUCCESS (IDEMPOTENT)
WO: ${workOrderId}
Barcode: ${scannedBarcode}
FG Session: ${fgSession.id}
Operator: ${assignedEmployeeName} (${assignedEmployeeCode})
==================================================`);
            return;
        }

        // 5. Insert the SMT-FG PASS inspection (matching exact manual FG inspection schema)
        const insRes = await client.query(
            `INSERT INTO smt_inspections (
                serial_id, process_step, scanned_by, status,
                work_order_id, fg_session_id, scanned_barcode
             ) VALUES ($1, 'SMT FG', $2, 'PASS', $3, $4, $5)
             RETURNING *`,
            [serialId, assignedEmployeeCode, workOrderId, fgSession.id, scannedBarcode]
        );
        const inspection = insRes.rows[0];

        // 6. Audit log
        await client.query(
            `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description, new_value)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                'PASS_INSPECTION',
                'SMT_FG_SESSION',
                String(fgSession.id),
                assignedEmployeeCode,
                `Recorded SMT FG PASS inspection for barcode: ${scannedBarcode} (WO ${workOrderId} side ${jobSide}). ` +
                `Operator: ${assignedEmployeeName} (${assignedEmployeeCode}).`,
                JSON.stringify(inspection),
            ]
        );

        // 7. Check session auto-completion
        const passRes = await client.query(
            `SELECT COUNT(DISTINCT COALESCE(serial_id::text, scanned_barcode)) AS count
             FROM smt_inspections
             WHERE fg_session_id=$1 AND status='PASS'`,
            [fgSession.id]
        );
        const passCount = parseInt(passRes.rows[0].count, 10);
        const workOrderQty = parseInt(wo.quantity, 10) || 0;

        if (passCount >= workOrderQty) {
            await client.query(
                `UPDATE smt_fg_sessions SET status='Completed', updated_at=NOW() WHERE id=$1`,
                [fgSession.id]
            );

            const sides = (wo.sides || '').trim().toLowerCase();
            const isDoubleSided = sides === 'top / bottom' || sides.includes('/');
            const isFinal = !isDoubleSided || fgSession.side.toLowerCase() === 'top';

            if (isFinal) {
                await client.query(
                    `UPDATE smt_work_orders SET smt_production_status='Completed' WHERE id=$1`,
                    [workOrderId]
                );
            }

            await client.query(
                `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description)
                 VALUES ($1,$2,$3,$4,$5)`,
                [
                    'SESSION_COMPLETED', 'SMT_FG_SESSION', String(fgSession.id), 'System',
                    `Auto SMT-FG session completed. Pass count (${passCount}) reached WO qty (${workOrderQty}).`,
                ]
            );
            logger.info(`[AutoFG] SMT-FG session ${fgSession.id} auto-completed for WO ${workOrderId}.`);
        }

        // 8. Mark job DONE
        await client.query(
            `UPDATE pending_auto_fg_jobs
             SET status='DONE', fg_session_id=$2, inspection_id=$3,
                 assigned_user_id=$4, assigned_employee_code=$5, assigned_employee_name=$6,
                 updated_at=NOW()
             WHERE id=$1`,
            [jobId, String(fgSession.id), inspection.id, assignedUserId, assignedEmployeeCode, assignedEmployeeName]
        );

        notifySmtDashboardUpdate(workOrderId);
        console.log(`
==================================================
AUTO-FG SUCCESS
WO: ${workOrderId}
Barcode: ${scannedBarcode}
FG Session: ${fgSession.id}
Inspection: ${inspection.id}
Operator: ${assignedEmployeeName} (${assignedEmployeeCode})
==================================================`);

    } catch (err: any) {
        logger.error(`[AutoFG] processOneJob error for job ${jobId}:`, err.message);
        await markJobFailed(client, jobId, err.message).catch(() => { /* swallow */ });
        console.log(`
==================================================
AUTO-FG FAILED
WO: ${workOrderId}
Barcode: ${scannedBarcode}
Reason: ${err.message}
==================================================`);
    }
};

// ─── 4. Reset NEEDS_OPERATOR jobs for a WO ───────────────────────────────────

/**
 * Called by smtFgOperatorController when an operator assignment is saved for a WO.
 * Snapshots the new operator into any NEEDS_OPERATOR jobs for that WO.
 */
export const resetNeedsOperatorJobs = async (
    workOrderId: string,
    operator: AssignedOperator
): Promise<number> => {
    const res = await pool.query(
        `UPDATE pending_auto_fg_jobs
         SET status = 'PENDING',
             assigned_user_id = $2,
             assigned_employee_code = $3,
             assigned_employee_name = $4,
             updated_at = NOW()
         WHERE work_order_id = $1
           AND status = 'NEEDS_OPERATOR'
         RETURNING id`,
        [workOrderId, operator.user_id, operator.employee_code, operator.employee_name]
    );
    return res.rows.length;
};

// ─── 5. Get or Create FG Session ──────────────────────────────────────────────

/**
 * Find an existing In Progress / Pending SMT-FG session for this WO + target side,
 * or create a new one by calling getAutoPopulateDetailsHelper.
 */
const getOrCreateFgSession = async (
    client: any,
    workOrderId: string,
    operatorCode: string,
    wo: any,
    targetSide: string = 'Top'
): Promise<any | null> => {
    const sideNorm = targetSide.trim().toLowerCase() === 'bottom' ? 'Bottom' : 'Top';

    // 1. Look for an existing active session (wait on row lock to prevent race condition)
    const existing = await client.query(
        `SELECT * FROM smt_fg_sessions
         WHERE work_order_id = $1
           AND LOWER(side) = LOWER($2)
           AND status IN ('Pending', 'In Progress')
           AND is_deleted = false
         ORDER BY created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [workOrderId, sideNorm]
    );

    if (existing.rows.length > 0) {
        const session = existing.rows[0];
        // Ensure it is In Progress
        if (session.status !== 'In Progress') {
            await client.query(
                `UPDATE smt_fg_sessions SET status='In Progress', updated_at=NOW() WHERE id=$1`,
                [session.id]
            );
            session.status = 'In Progress';
        }
        return session;
    }

    // 2. Ensure there is no already-Completed session for this side
    const completed = await client.query(
        `SELECT id FROM smt_fg_sessions
         WHERE work_order_id=$1 AND LOWER(side)=LOWER($2) AND status='Completed' AND is_deleted=false`,
        [workOrderId, sideNorm]
    );
    if (completed.rows.length > 0) {
        logger.warn(`[AutoFG] WO ${workOrderId}: SMT-FG ${sideNorm} already Completed. Job is a duplicate.`);
        return null;
    }

    // 3. Fetch auto-populate details (stencil, squeegee, solder paste)
    let details: any;
    try {
        details = await getAutoPopulateDetailsHelper(workOrderId, sideNorm, 'smt_fg_sessions');
    } catch (err: any) {
        logger.error(`[AutoFG] Cannot get auto-populate details for WO ${workOrderId} side ${sideNorm}:`, err.message);
        return null;
    }

    // 4. Create the session
    const insRes = await client.query(
        `INSERT INTO smt_fg_sessions (
            work_order_id, stencil_lifecycle_id, squeegee_front_number,
            squeegee_rear_number, solder_paste_barcode, side, status,
            created_by, created_by_name, updated_by, updated_by_name
         ) VALUES ($1,$2,$3,$4,$5,$6,'In Progress',$7,$8,$7,$8)
         RETURNING *`,
        [
            workOrderId,
            details.stencilLifecycleId,
            details.squeegeeFrontNumber,
            details.squeegeeRearNumber,
            details.solderPasteBarcode,
            sideNorm,
            operatorCode,
            operatorCode,
        ]
    );
    const session = insRes.rows[0];

    // Update WO production status if still Pending
    await client.query(
        `UPDATE smt_work_orders
         SET smt_production_status='In Progress'
         WHERE id=$1 AND smt_production_status='Pending'`,
        [workOrderId]
    );

    await client.query(
        `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description)
         VALUES ($1,$2,$3,$4,$5)`,
        [
            'SESSION_CREATED', 'SMT_FG_SESSION', String(session.id), operatorCode,
            `Auto-created SMT-FG session for WO ${workOrderId} on ${sideNorm} side.`,
        ]
    );

    logger.info(`[AutoFG] Created new SMT-FG session ${session.id} for WO ${workOrderId} ${sideNorm}.`);
    return session;
};

const markJobFailed = async (client: any, jobId: number, message: string): Promise<void> => {
    await client.query(
        `UPDATE pending_auto_fg_jobs
         SET status='FAILED', error_message=$2, updated_at=NOW()
         WHERE id=$1`,
        [jobId, message]
    );
    logger.error(`[AutoFG] Job ${jobId} marked FAILED: ${message}`);
};
