import { Request, Response } from 'express';
import pool from '../config/db';
import { createLogger } from '../utils/logger';

const logger = createLogger('SolderPaste');

// Thawing duration in milliseconds: 4 hours
const THAWING_DURATION_MS = 4 * 60 * 60 * 1000;

/**
 * Helper to check and dynamically update thawing status if 4 hours have passed.
 */
const verifyThawingTimer = async (woId: string): Promise<any> => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Select work order with row locking
        const result = await client.query(
            `SELECT * FROM smt_work_orders WHERE id = $1 FOR UPDATE`,
            [woId]
        );
        
        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return null;
        }

        const wo = result.rows[0];

        if (
            wo.solder_paste_stage2_status === 'In Progress' &&
            wo.solder_paste_stage2_start_at
        ) {
            const startAt = new Date(wo.solder_paste_stage2_start_at).getTime();
            const elapsed = Date.now() - startAt;

            if (elapsed >= THAWING_DURATION_MS) {
                // Thawing is complete. Update status dynamically.
                const updated = await client.query(
                    `UPDATE smt_work_orders 
                     SET solder_paste_stage2_status = 'Ready For Mixing',
                         solder_paste_status = 'Ready For Mixing',
                         solder_paste_stage2_completed_at = $1
                     WHERE id = $2 RETURNING *`,
                    [new Date(startAt + THAWING_DURATION_MS), woId]
                );

                // Log system-level audit entry for thawing completion
                await client.query(
                    `INSERT INTO smt_inspections (work_order_id, process_step, scanned_by, status, rework_reason)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [
                        woId,
                        'Solder Paste - Thawing',
                        'System (Timer)',
                        'Ready For Mixing',
                        '4-hour thawing completed'
                    ]
                );

                await client.query('COMMIT');
                return updated.rows[0];
            }
        }

        await client.query('COMMIT');
        return wo;
    } catch (err) {
        await client.query('ROLLBACK');
        logger.error(`Error in verifyThawingTimer for Work Order ${woId}:`, err);
        throw err;
    } finally {
        client.release();
    }
};

/**
 * GET /solder-paste/status/:woId
 * Fetches current solder paste management state.
 */
export const getSolderPasteStatus = async (req: Request, res: Response) => {
    const { woId } = req.params;
    try {
        const wo = await verifyThawingTimer(woId);
        if (!wo) {
            return res.status(404).json({ error: "Work Order not found." });
        }

        let thawingRemainingMs = 0;
        if (wo.solder_paste_stage2_status === 'In Progress' && wo.solder_paste_stage2_start_at) {
            const startAt = new Date(wo.solder_paste_stage2_start_at).getTime();
            const elapsed = Date.now() - startAt;
            thawingRemainingMs = Math.max(0, THAWING_DURATION_MS - elapsed);
        }

        res.status(200).json({
            work_order_id: wo.id,
            product_name: wo.product_name,
            product_description: wo.product_description,
            quantity: wo.quantity,
            panel_quantity: wo.panel_quantity,
            line_id: wo.line_id,
            solder_paste_barcode: wo.solder_paste_barcode,
            stage1: {
                operator: wo.solder_paste_stage1_operator,
                employee_code: wo.solder_paste_stage1_employee_code,
                completed_at: wo.solder_paste_stage1_at,
                status: wo.solder_paste_stage1_status || 'Pending'
            },
            stage2: {
                start_at: wo.solder_paste_stage2_start_at,
                completed_at: wo.solder_paste_stage2_completed_at,
                operator: wo.solder_paste_stage2_operator,
                employee_code: wo.solder_paste_stage2_employee_code,
                status: wo.solder_paste_stage2_status || 'Pending',
                thawing_remaining_ms: thawingRemainingMs
            },
            stage3: {
                start_at: wo.solder_paste_stage3_start_at,
                completed_at: wo.solder_paste_stage3_completed_at,
                operator: wo.solder_paste_stage3_operator,
                employee_code: wo.solder_paste_stage3_employee_code,
                status: wo.solder_paste_stage3_status || 'Pending'
            },
            solder_paste_status: wo.solder_paste_status || 'Pending'
        });
    } catch (err) {
        logger.error(`Error fetching solder paste status for ${woId}:`, err);
        res.status(500).json({ error: "Failed to fetch solder paste status." });
    }
};

/**
 * GET /solder-paste/eligible-wos
 * Fetches eligible Work Orders based on stage.
 */
export const getEligibleWorkOrders = async (req: Request, res: Response) => {
    const { stage } = req.query;
    try {
        let query = '';
        const params: any[] = [];

        if (stage === '1') {
            // Eligible if Stage 1 is not completed yet
            query = `
                SELECT wo.id, wo.product_name, wo.quantity, wo.panel_quantity
                FROM smt_work_orders wo
                WHERE wo.solder_paste_stage1_status IS NULL OR wo.solder_paste_stage1_status != 'Completed'
                ORDER BY wo.created_at DESC
            `;
        } else if (stage === '2') {
            // Eligible if Stage 1 is complete but Stage 2 not started
            query = `
                SELECT wo.id, wo.product_name, wo.quantity, wo.panel_quantity, wo.solder_paste_barcode
                FROM smt_work_orders wo
                WHERE wo.solder_paste_stage1_status = 'Completed'
                  AND (wo.solder_paste_stage2_status IS NULL OR wo.solder_paste_stage2_status = 'Pending')
                ORDER BY wo.created_at DESC
            `;
        } else if (stage === '3') {
            // Eligible if Stage 2 is Ready For Mixing but Stage 3 is not Completed
            // First we check/update active thawing orders
            const activeThawingWos = await pool.query(
                `SELECT id FROM smt_work_orders WHERE solder_paste_stage2_status = 'In Progress'`
            );
            for (const r of activeThawingWos.rows) {
                await verifyThawingTimer(r.id);
            }

            query = `
                SELECT wo.id, wo.product_name, wo.quantity, wo.panel_quantity, wo.solder_paste_barcode, wo.solder_paste_stage2_start_at
                FROM smt_work_orders wo
                WHERE wo.solder_paste_stage2_status = 'Ready For Mixing'
                  AND (wo.solder_paste_stage3_status IS NULL OR wo.solder_paste_stage3_status != 'Completed')
                ORDER BY wo.created_at DESC
            `;
        } else {
            return res.status(400).json({ error: "Invalid stage. Must be 1, 2, or 3." });
        }

        const result = await pool.query(query, params);
        res.status(200).json(result.rows);
    } catch (err) {
        logger.error("Error fetching eligible work orders:", err);
        res.status(500).json({ error: "Failed to fetch eligible work orders." });
    }
};

/**
 * GET /solder-paste/dashboard-counts
 * Returns dashboard summary counts.
 */
export const getDashboardCounts = async (req: Request, res: Response) => {
    try {
        // Automatically check/update active thawing timers first to ensure dashboard counts are live
        const activeThawingWos = await pool.query(
            `SELECT id FROM smt_work_orders WHERE solder_paste_stage2_status = 'In Progress'`
        );
        for (const r of activeThawingWos.rows) {
            await verifyThawingTimer(r.id);
        }

        const result = await pool.query(`
            SELECT 
                COUNT(CASE WHEN solder_paste_status IS NULL OR solder_paste_status = 'Pending' THEN 1 END) as pending,
                COUNT(CASE WHEN solder_paste_status = 'In Progress' THEN 1 END) as in_progress,
                COUNT(CASE WHEN solder_paste_status = 'Ready For Mixing' THEN 1 END) as ready_for_mixing,
                COUNT(CASE WHEN solder_paste_status = 'Completed' THEN 1 END) as completed
            FROM smt_work_orders
        `);

        res.status(200).json(result.rows[0]);
    } catch (err) {
        logger.error("Error fetching dashboard counts:", err);
        res.status(500).json({ error: "Failed to fetch dashboard counts." });
    }
};

/**
 * POST /solder-paste/stage1
 * Submits Removal from Fridge (Stage 1)
 */
export const completeStage1 = async (req: Request, res: Response) => {
    const { work_order_id, solder_paste_barcode, operator_name, employee_code, operator_role } = req.body;


    if (!work_order_id || !solder_paste_barcode || !operator_name || !employee_code) {
        return res.status(400).json({ error: "All fields are required." });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Lock Work Order
        const woRes = await client.query(
            `SELECT * FROM smt_work_orders WHERE id = $1 FOR UPDATE`,
            [work_order_id]
        );

        if (woRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Work Order not found." });
        }

        const wo = woRes.rows[0];
        if (wo.solder_paste_stage1_status === 'Completed') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Stage 1 (Removal from Fridge) is already completed for this Work Order." });
        }

        // Update current state
        await client.query(
            `UPDATE smt_work_orders
             SET solder_paste_barcode = $1,
                 solder_paste_stage1_operator = $2,
                 solder_paste_stage1_employee_code = $3,
                 solder_paste_stage1_at = CURRENT_TIMESTAMP,
                 solder_paste_stage1_status = 'Completed'
             WHERE id = $4`,
            [solder_paste_barcode, operator_name, employee_code, work_order_id]
        );

        // Record Audit log
        await client.query(
            `INSERT INTO smt_inspections (work_order_id, process_step, scanned_by, status, rework_reason)
             VALUES ($1, $2, $3, $4, $5)`,
            [
                work_order_id,
                'Solder Paste - Removal',
                `${operator_name} (${employee_code})`,
                'Completed',
                `Barcode: ${solder_paste_barcode}`
            ]
        );

        await client.query('COMMIT');
        res.status(200).json({ message: "Stage 1 completed successfully." });
    } catch (err) {
        await client.query('ROLLBACK');
        logger.error("Error in completeStage1:", err);
        res.status(500).json({ error: "Failed to complete Stage 1." });
    } finally {
        client.release();
    }
};

/**
 * POST /solder-paste/stage2/start
 * Starts Thawing (Stage 2)
 */
export const startStage2Thawing = async (req: Request, res: Response) => {
    const { work_order_id, operator_name, employee_code, operator_role } = req.body;



    if (!work_order_id || !operator_name || !employee_code) {
        return res.status(400).json({ error: "All fields are required." });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Lock Work Order
        const woRes = await client.query(
            `SELECT * FROM smt_work_orders WHERE id = $1 FOR UPDATE`,
            [work_order_id]
        );

        if (woRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Work Order not found." });
        }

        const wo = woRes.rows[0];
        if (wo.solder_paste_stage1_status !== 'Completed') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Stage 1 (Removal from Fridge) must be completed before starting Thawing." });
        }

        if (wo.solder_paste_stage2_status === 'In Progress' || wo.solder_paste_stage2_status === 'Ready For Mixing') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Thawing has already started or completed for this Work Order." });
        }

        // Update state
        await client.query(
            `UPDATE smt_work_orders
             SET solder_paste_stage2_start_at = CURRENT_TIMESTAMP,
                 solder_paste_stage2_operator = $1,
                 solder_paste_stage2_employee_code = $2,
                 solder_paste_stage2_status = 'In Progress',
                 solder_paste_status = 'In Progress'
             WHERE id = $3`,
            [operator_name, employee_code, work_order_id]
        );

        // Record Audit log
        await client.query(
            `INSERT INTO smt_inspections (work_order_id, process_step, scanned_by, status, rework_reason)
             VALUES ($1, $2, $3, $4, $5)`,
            [
                work_order_id,
                'Solder Paste - Thawing',
                `${operator_name} (${employee_code})`,
                'In Progress',
                'Thawing timer started'
            ]
        );

        await client.query('COMMIT');
        res.status(200).json({ message: "Thawing started successfully." });
    } catch (err) {
        await client.query('ROLLBACK');
        logger.error("Error in startStage2Thawing:", err);
        res.status(500).json({ error: "Failed to start Thawing." });
    } finally {
        client.release();
    }
};

/**
 * POST /solder-paste/stage3/start
 * Starts Mixing (Stage 3)
 */
export const startStage3Mixing = async (req: Request, res: Response) => {
    const { work_order_id, operator_name, employee_code, operator_role } = req.body;



    if (!work_order_id || !operator_name || !employee_code) {
        return res.status(400).json({ error: "All fields are required." });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Lock Work Order
        const woRes = await client.query(
            `SELECT * FROM smt_work_orders WHERE id = $1 FOR UPDATE`,
            [work_order_id]
        );

        if (woRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Work Order not found." });
        }

        const wo = woRes.rows[0];

        // Double check thawing timer if it is 'In Progress'
        let thawedWo = wo;
        if (wo.solder_paste_stage2_status === 'In Progress' && wo.solder_paste_stage2_start_at) {
            const startAt = new Date(wo.solder_paste_stage2_start_at).getTime();
            const elapsed = Date.now() - startAt;
            if (elapsed >= THAWING_DURATION_MS) {
                // Complete thawing now
                await client.query(
                    `UPDATE smt_work_orders 
                     SET solder_paste_stage2_status = 'Ready For Mixing',
                         solder_paste_status = 'Ready For Mixing',
                         solder_paste_stage2_completed_at = $1
                     WHERE id = $2`,
                    [new Date(startAt + THAWING_DURATION_MS), work_order_id]
                );
                await client.query(
                    `INSERT INTO smt_inspections (work_order_id, process_step, scanned_by, status, rework_reason)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [work_order_id, 'Solder Paste - Thawing', 'System (Timer)', 'Ready For Mixing', '4-hour thawing completed']
                );
                const updatedWo = await client.query(`SELECT * FROM smt_work_orders WHERE id = $1`, [work_order_id]);
                thawedWo = updatedWo.rows[0];
            }
        }

        if (thawedWo.solder_paste_stage2_status !== 'Ready For Mixing') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Thawing must be completed (minimum 4 hours) before starting Mixing." });
        }

        if (thawedWo.solder_paste_stage3_status === 'In Progress' || thawedWo.solder_paste_stage3_status === 'Completed') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Mixing has already started or completed for this Work Order." });
        }

        // Update state
        await client.query(
            `UPDATE smt_work_orders
             SET solder_paste_stage3_start_at = CURRENT_TIMESTAMP,
                 solder_paste_stage3_status = 'In Progress'
             WHERE id = $1`,
            [work_order_id]
        );

        // Record Audit log
        await client.query(
            `INSERT INTO smt_inspections (work_order_id, process_step, scanned_by, status, rework_reason)
             VALUES ($1, $2, $3, $4, $5)`,
            [
                work_order_id,
                'Solder Paste - Mixing',
                `${operator_name} (${employee_code})`,
                'In Progress',
                'Mixing started'
            ]
        );

        await client.query('COMMIT');
        res.status(200).json({ message: "Mixing started successfully." });
    } catch (err) {
        await client.query('ROLLBACK');
        logger.error("Error in startStage3Mixing:", err);
        res.status(500).json({ error: "Failed to start Mixing." });
    } finally {
        client.release();
    }
};

/**
 * POST /solder-paste/stage3/complete
 * Completes Mixing (Stage 3)
 */
export const completeStage3Mixing = async (req: Request, res: Response) => {
    const { work_order_id, operator_name, employee_code, operator_role } = req.body;



    if (!work_order_id || !operator_name || !employee_code) {
        return res.status(400).json({ error: "All fields are required." });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Lock Work Order
        const woRes = await client.query(
            `SELECT * FROM smt_work_orders WHERE id = $1 FOR UPDATE`,
            [work_order_id]
        );

        if (woRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Work Order not found." });
        }

        const wo = woRes.rows[0];
        if (wo.solder_paste_stage3_status !== 'In Progress') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Mixing must be in progress to complete it." });
        }

        // Update state
        await client.query(
            `UPDATE smt_work_orders
             SET solder_paste_stage3_completed_at = CURRENT_TIMESTAMP,
                 solder_paste_stage3_operator = $1,
                 solder_paste_stage3_employee_code = $2,
                 solder_paste_stage3_status = 'Completed',
                 solder_paste_status = 'Completed'
             WHERE id = $3`,
            [operator_name, employee_code, work_order_id]
        );

        // Record Audit log
        await client.query(
            `INSERT INTO smt_inspections (work_order_id, process_step, scanned_by, status, rework_reason)
             VALUES ($1, $2, $3, $4, $5)`,
            [
                work_order_id,
                'Solder Paste - Mixing',
                `${operator_name} (${employee_code})`,
                'Completed',
                'Mixing completed'
            ]
        );

        await client.query('COMMIT');
        res.status(200).json({ message: "Mixing completed successfully." });
    } catch (err) {
        await client.query('ROLLBACK');
        logger.error("Error in completeStage3Mixing:", err);
        res.status(500).json({ error: "Failed to complete Mixing." });
    } finally {
        client.release();
    }
};

/**
 * GET /solder-paste/completed-batches
 * Returns list of all completed Solder Paste steps.
 */
export const getCompletedBatches = async (req: Request, res: Response) => {
    try {
        // Automatically check/update active thawing timers first
        const activeThawingWos = await pool.query(
            `SELECT id FROM smt_work_orders WHERE solder_paste_stage2_status = 'In Progress'`
        );
        for (const r of activeThawingWos.rows) {
            await verifyThawingTimer(r.id);
        }

        const result = await pool.query(`
            SELECT 
                insp.id as inspection_id,
                insp.work_order_id,
                wo.product_name,
                wo.product_description,
                wo.quantity,
                wo.panel_quantity,
                wo.line_id,
                wo.solder_paste_barcode,
                insp.process_step,
                insp.scanned_by,
                insp.status as step_status,
                insp.rework_reason,
                insp.scanned_at as created_at,
                wo.solder_paste_stage1_operator,
                wo.solder_paste_stage1_employee_code,
                wo.solder_paste_stage1_at,
                wo.solder_paste_stage2_start_at,
                wo.solder_paste_stage2_operator,
                wo.solder_paste_stage2_employee_code,
                wo.solder_paste_stage2_completed_at,
                wo.solder_paste_stage3_start_at,
                wo.solder_paste_stage3_completed_at,
                wo.solder_paste_stage3_operator,
                wo.solder_paste_stage3_employee_code
            FROM smt_inspections insp
            JOIN smt_work_orders wo ON insp.work_order_id = wo.id
            WHERE insp.process_step IN ('Solder Paste - Removal', 'Solder Paste - Thawing', 'Solder Paste - Mixing')
              AND insp.status IN ('Completed', 'Ready For Mixing', 'In Progress')
            ORDER BY insp.scanned_at DESC
        `);

        res.status(200).json(result.rows);
    } catch (err) {
        logger.error("Error fetching completed batches:", err);
        res.status(500).json({ error: "Failed to fetch completed batches." });
    }
};
