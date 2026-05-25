import { Request, Response } from 'express';
import pool from '../config/db';
import { createLogger } from '../utils/logger';

const logger = createLogger('SMT_CONTROLLER');

// === Work Orders ===
export const createWorkOrder = async (req: Request, res: Response) => {
    const { work_order_id, area_id, line_id, priority, product_name, product_description, quantity, panel_quantity, created_by, barcode_source } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO smt_work_orders (id, area_id, line_id, priority, product_name, product_description, quantity, panel_quantity, created_by, barcode_source) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
            [work_order_id, area_id, line_id, priority, product_name, product_description, quantity, panel_quantity, created_by, barcode_source || 'GENERATED']
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        logger.error("Error creating work order:", err);
        res.status(500).json({ error: "Failed to create work order" });
    }
};

export const getPendingWorkOrders = async (req: Request, res: Response) => {
    try {
        const query = `
            SELECT 
                wo.*, 
                (SELECT COUNT(*) FROM smt_serial_numbers sn WHERE sn.work_order_id = wo.id) as generated_count
            FROM smt_work_orders wo
            WHERE wo.is_registered = false
            AND NOT EXISTS (SELECT 1 FROM smt_serial_numbers sn2 WHERE sn2.work_order_id = wo.id)
            ORDER BY wo.created_at DESC
        `;
        const result = await pool.query(query);
        res.status(200).json(result.rows);
    } catch (err) {
        logger.error("Error fetching pending work orders:", err);
        res.status(500).json({ error: "Failed to fetch pending work orders" });
    }
};

export const getWorkOrders = async (req: Request, res: Response) => {
    try {
        const result = await pool.query('SELECT * FROM smt_work_orders ORDER BY created_at DESC');
        res.status(200).json(result.rows);
    } catch (err) {
        logger.error("Error fetching work orders:", err);
        res.status(500).json({ error: "Failed to fetch work orders" });
    }
};

export const registerWorkOrder = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { barcode_source } = req.body;
    try {
        const result = await pool.query(
            'UPDATE smt_work_orders SET is_registered = true, barcode_source = COALESCE($2, barcode_source) WHERE id = $1 RETURNING *',
            [id, barcode_source]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: "Work order not found" });
        res.status(200).json(result.rows[0]);
    } catch (err) {
        logger.error("Error registering work order:", err);
        res.status(500).json({ error: "Failed to register work order" });
    }
};

export const deleteWorkOrder = async (req: Request, res: Response) => {
    const { id } = req.params;
    const userRole = (req as any).user?.role;

    if (userRole !== 'Super Admin') {
        return res.status(403).json({ error: "Only Super Admin can delete work orders" });
    }

    try {
        const result = await pool.query('DELETE FROM smt_work_orders WHERE id = $1 RETURNING *', [id]);
        if (result.rowCount === 0) return res.status(404).json({ error: "Work order not found" });
        res.status(200).json({ message: "Work order deleted successfully" });
    } catch (err) {
        logger.error("Error deleting work order:", err);
        res.status(500).json({ error: "Failed to delete work order" });
    }
};

export const getRegisteredWorkOrders = async (req: Request, res: Response) => {
    const { last_status } = req.query;
    try {
        let query = `
            SELECT 
                wo.*,
                (
                    SELECT COUNT(DISTINCT i.serial_id) 
                    FROM smt_inspections i 
                    JOIN smt_serial_numbers sn ON i.serial_id = sn.id 
                    WHERE sn.work_order_id = wo.id AND i.process_step = 'PCB Generation' AND i.status = 'PASS'
                ) as scanned_count,
                (
                    SELECT COUNT(*)
                    FROM smt_serial_numbers sn4
                    WHERE sn4.work_order_id = wo.id
                ) as generated_qty,
                (
                    SELECT COUNT(*)
                    FROM smt_serial_numbers sn
                    JOIN (
                        SELECT DISTINCT ON (serial_id) serial_id, process_step, status
                        FROM smt_inspections
                        ORDER BY serial_id, scanned_at DESC
                    ) latest ON sn.id = latest.serial_id
                    WHERE sn.work_order_id = wo.id
                      AND latest.process_step = 'Post AOI'
                      AND latest.status = 'PASS'
                ) as passed_count,
                (
                    SELECT COUNT(*)
                    FROM smt_serial_numbers sn
                    JOIN (
                        SELECT DISTINCT ON (serial_id) serial_id, process_step, status
                        FROM smt_inspections
                        ORDER BY serial_id, scanned_at DESC
                    ) latest ON sn.id = latest.serial_id
                    WHERE sn.work_order_id = wo.id
                      AND latest.process_step = 'Post AOI'
                      AND latest.status = 'FAIL'
                ) as active_failed_count
            FROM smt_work_orders wo
            WHERE 1=1
        `;
        const params: any[] = [];

        if (last_status) {
            params.push(last_status);
            query += ` AND EXISTS (
                SELECT 1
                FROM smt_serial_numbers sn2
                JOIN (
                    SELECT DISTINCT ON (serial_id) serial_id, status
                    FROM smt_inspections
                    ORDER BY serial_id, scanned_at DESC
                ) latest ON sn2.id = latest.serial_id
                WHERE sn2.work_order_id = wo.id
                AND latest.status = $${params.length}
            )`;
        } else {
            query += ` AND (wo.is_registered = true OR EXISTS (SELECT 1 FROM smt_serial_numbers sn3 WHERE sn3.work_order_id = wo.id))`;
        }

        query += ` ORDER BY wo.created_at DESC`;

        const result = await pool.query(query, params);
        res.status(200).json(result.rows);
    } catch (err) {
        logger.error("Error fetching registered work orders:", err);
        res.status(500).json({ error: "Failed to fetch registered work orders" });
    }
};

// === Serial Numbers ===
export const generateSerials = async (req: Request, res: Response) => {
    const { work_order_id, format, serials, created_by, barcode_source } = req.body;

    // Safety Layer: Aggressive cleaning - preserved dashes for traceability
    const cleanFormat = (format || "").toUpperCase();
    const cleanSerials = (serials || []).map((s: string) => s.toUpperCase());

    if (!cleanSerials || cleanSerials.length === 0) {
        // If it's "Barcode Already Available", we might just want to register it without serials
        if (barcode_source === 'PRE_EXISTING') {
            try {
                await pool.query('UPDATE smt_work_orders SET is_registered = true, barcode_source = $1 WHERE id = $2', [barcode_source, work_order_id]);
                return res.status(200).json({ message: "Work order registered with existing barcodes", inserted: 0, total: 0 });
            } catch (err) {
                logger.error("Error registering WO without serials:", err);
                return res.status(500).json({ error: "Failed to register work order" });
            }
        }
        return res.status(400).json({ error: "No serial numbers provided" });
    }

    try {
        await pool.query('BEGIN');

        // Update WO barcode source
        await pool.query('UPDATE smt_work_orders SET barcode_source = $1 WHERE id = $2', [barcode_source || 'GENERATED', work_order_id]);

        // 1. Bulk insert serial numbers, skipping duplicates
        const snValues: any[] = [];
        const snPlaceholders: string[] = [];
        let snParamIdx = 1;

        cleanSerials.forEach((serial: string) => {
            snPlaceholders.push(`($${snParamIdx++}, $${snParamIdx++}, $${snParamIdx++}, $${snParamIdx++})`);
            snValues.push(work_order_id, cleanFormat, serial, created_by);
        });

        const snQuery = `
            INSERT INTO smt_serial_numbers (work_order_id, serial_format, serial_number, created_by)
            VALUES ${snPlaceholders.join(', ')}
            ON CONFLICT (serial_number) DO NOTHING
            RETURNING id
        `;

        const snResult = await pool.query(snQuery, snValues);

        // 2. Bulk insert initial inspections for NEW serials only
        if (snResult.rows.length > 0) {
            const inspValues: any[] = [];
            const inspPlaceholders: string[] = [];
            let inspParamIdx = 1;

            snResult.rows.forEach((row: any) => {
                inspPlaceholders.push(`($${inspParamIdx++}, $${inspParamIdx++}, $${inspParamIdx++}, $${inspParamIdx++})`);
                inspValues.push(row.id, 'Serial Number', created_by, 'PASS');
            });

            const inspQuery = `
                INSERT INTO smt_inspections (serial_id, process_step, scanned_by, status)
                VALUES ${inspPlaceholders.join(', ')}
            `;
            await pool.query(inspQuery, inspValues);
        }

        await pool.query('COMMIT');
        res.status(201).json({
            message: "Serials generated successfully",
            inserted: snResult.rows.length,
            total: cleanSerials.length
        });
    } catch (err) {
        await pool.query('ROLLBACK');
        logger.error("Error generating serials:", err);
        res.status(500).json({ error: "Failed to generate serials" });
    }
};

export const getSerials = async (req: Request, res: Response) => {
    const { work_order_id, filter_step, filter_status, current_step, last_status } = req.query;
    try {
        const params: any[] = [];
        const currentStep = typeof current_step === 'string' ? current_step : null;
        let completedHereSelect = `
            false as is_completed_here,
            null::text as step_status,
            null::text as step_scanned_by,
            null::timestamp as step_scanned_at,
            null::text as step_remark
        `;

        if (currentStep) {
            params.push(currentStep);
            completedHereSelect = `
                EXISTS (
                    SELECT 1
                    FROM smt_inspections step_done
                    WHERE step_done.serial_id = sn.id
                    AND step_done.process_step = $${params.length}
                    AND step_done.status = 'PASS'
                ) as is_completed_here,
                (
                    SELECT step_done.status
                    FROM smt_inspections step_done
                    WHERE step_done.serial_id = sn.id
                    AND step_done.process_step = $${params.length}
                    ORDER BY step_done.scanned_at DESC
                    LIMIT 1
                ) as step_status,
                (
                    SELECT step_done.scanned_by
                    FROM smt_inspections step_done
                    WHERE step_done.serial_id = sn.id
                    AND step_done.process_step = $${params.length}
                    ORDER BY step_done.scanned_at DESC
                    LIMIT 1
                ) as step_scanned_by,
                (
                    SELECT step_done.scanned_at
                    FROM smt_inspections step_done
                    WHERE step_done.serial_id = sn.id
                    AND step_done.process_step = $${params.length}
                    ORDER BY step_done.scanned_at DESC
                    LIMIT 1
                ) as step_scanned_at,
                (
                    SELECT step_done.rework_reason
                    FROM smt_inspections step_done
                    WHERE step_done.serial_id = sn.id
                    AND step_done.process_step = $${params.length}
                    ORDER BY step_done.scanned_at DESC
                    LIMIT 1
                ) as step_remark
            `;
        }

        let query = `
            SELECT 
                sn.id,
                wo.id as work_order_id,
                sn.serial_number,
                sn.serial_format,
                sn.created_by,
                sn.created_at,
                wo.product_name, 
                wo.quantity as wo_qty, 
                wo.panel_quantity as panel_qty, 
                wo.created_by as wo_created_by,
                wo.is_registered,
                wo.barcode_source,
                last_insp.status as last_status,
                last_insp.process_step as last_step,
                last_insp.rework_reason,
                ${completedHereSelect}
            FROM smt_work_orders wo
            LEFT JOIN smt_serial_numbers sn ON wo.id = sn.work_order_id
            LEFT JOIN (
                SELECT DISTINCT ON (serial_id) serial_id, status, process_step, rework_reason, scanned_at
                FROM smt_inspections
                ORDER BY serial_id, scanned_at DESC
            ) last_insp ON sn.id = last_insp.serial_id
        `;
        const conditions: string[] = ["(wo.is_registered = true OR sn.id IS NOT NULL)"];

        if (work_order_id) {
            params.push(work_order_id);
            conditions.push(`wo.id = $${params.length}`);
        }

        if (filter_step && filter_status) {
            const steps = (filter_step as string).split(',');
            const stepPlaceholders = steps.map((_, i) => `$${params.length + i + 1}`).join(',');

            conditions.push(`EXISTS (
                SELECT 1 FROM smt_inspections insp_filter 
                WHERE insp_filter.serial_id = sn.id 
                AND insp_filter.process_step IN (${stepPlaceholders}) 
                AND insp_filter.status = $${params.length + steps.length + 1}
            )`);

            steps.forEach(step => params.push(step.trim()));
            params.push(filter_status);
        } else if (filter_status) {
            params.push(filter_status);
            conditions.push(`EXISTS (
                SELECT 1 FROM smt_inspections insp_filter 
                WHERE insp_filter.serial_id = sn.id 
                AND insp_filter.status = $${params.length}
            )`);
        }

        // Filter by the most-recent inspection status (latest record per serial)
        if (last_status) {
            params.push(last_status);
            conditions.push(`last_insp.status = $${params.length}`);
        }

        if (conditions.length > 0) {
            query += ` WHERE ` + conditions.join(' AND ');
        }

        query += ` ORDER BY sn.id ASC`;

        logger.info(`Executing getSerials query: ${query} with params: ${JSON.stringify(params)}`);
        const result = await pool.query(query, params);

        // Safety Layer: Clean API Response
        const cleanedRows = result.rows.map(row => ({
            ...row,
            serial_number: row.serial_number || "",
            serial_format: row.serial_format || ""
        }));

        res.status(200).json(cleanedRows);
    } catch (err) {
        logger.error("Error fetching serials:", err);
        res.status(500).json({ error: "Failed to fetch serials" });
    }
};

export const deleteSerials = async (req: Request, res: Response) => {
    const { work_order_id } = req.query;
    const userRole = (req as any).user?.role;

    if (userRole !== 'Super Admin') {
        return res.status(403).json({ error: "Only Super Admin can delete serials" });
    }

    try {
        if (work_order_id) {
            await pool.query('DELETE FROM smt_serial_numbers WHERE work_order_id = $1', [work_order_id]);
        } else {
            await pool.query('DELETE FROM smt_serial_numbers');
        }
        res.status(200).json({ message: "Serials deleted successfully" });
    } catch (err) {
        logger.error("Error deleting serials:", err);
        res.status(500).json({ error: "Failed to delete serials" });
    }
};

// === Printing Employees ===
export const createEmployee = async (req: Request, res: Response) => {
    const { name, user_id, password } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO smt_printing_employees (name, user_id, password) VALUES ($1, $2, $3) RETURNING *`,
            [name, user_id, password]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        logger.error("Error creating employee:", err);
        res.status(500).json({ error: "Failed to create employee" });
    }
};

export const getEmployees = async (req: Request, res: Response) => {
    try {
        const result = await pool.query('SELECT * FROM smt_printing_employees ORDER BY created_at DESC');
        res.status(200).json(result.rows);
    } catch (err) {
        logger.error("Error fetching employees:", err);
        res.status(500).json({ error: "Failed to fetch employees" });
    }
};

export const updateEmployee = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { name, user_id, password } = req.body;
    try {
        const result = await pool.query(
            `UPDATE smt_printing_employees SET name = $1, user_id = $2, password = $3 WHERE id = $4 RETURNING *`,
            [name, user_id, password, id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: "Employee not found" });
        res.status(200).json(result.rows[0]);
    } catch (err) {
        logger.error("Error updating employee:", err);
        res.status(500).json({ error: "Failed to update employee" });
    }
};

export const deleteEmployee = async (req: Request, res: Response) => {
    const { id } = req.params;
    const userRole = (req as any).user?.role;

    if (userRole !== 'Super Admin') {
        return res.status(403).json({ error: "Only Super Admin can delete employees" });
    }

    try {
        await pool.query('DELETE FROM smt_printing_employees WHERE id = $1', [id]);
        res.status(200).json({ message: "Employee deleted" });
    } catch (err) {
        logger.error("Error deleting employee:", err);
        res.status(500).json({ error: "Failed to delete employee" });
    }
};

export const toggleEmployeeStatus = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const result = await pool.query(
            `UPDATE smt_printing_employees SET is_active = NOT is_active WHERE id = $1 RETURNING *`,
            [id]
        );
        res.status(200).json(result.rows[0]);
    } catch (err) {
        logger.error("Error toggling status:", err);
        res.status(500).json({ error: "Failed to toggle status" });
    }
};

export const loginEmployee = async (req: Request, res: Response) => {
    const { userId, password } = req.body;
    try {
        const result = await pool.query(
            `SELECT * FROM smt_printing_employees WHERE user_id = $1 AND password = $2`,
            [userId, password]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        const employee = result.rows[0];
        if (!employee.is_active) {
            return res.status(403).json({ error: "Account deactivated. Please contact admin." });
        }

        res.status(200).json({ message: "Login successful", employee });
    } catch (err) {
        logger.error("Error during login:", err);
        res.status(500).json({ error: "Login failed" });
    }
};

export const updateSerialNumberStatus = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status } = req.body;
    try {
        const result = await pool.query(
            'UPDATE smt_serial_numbers SET status = $1 WHERE id = $2 RETURNING *',
            [status, id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: "Serial number not found" });
        res.status(200).json(result.rows[0]);
    } catch (err) {
        logger.error("Error updating serial status:", err);
        res.status(500).json({ error: "Failed to update serial status" });
    }
};

// === Inspections ===
export const deleteInspectionsForBatch = async (req: Request, res: Response) => {
    const { work_order_id, process_step } = req.query;
    const userRole = (req as any).user?.role;

    if (userRole !== 'Super Admin' && userRole !== 'Admin') {
        return res.status(403).json({ error: "Only Super Admin or Admin can delete scan sessions" });
    }

    if (!work_order_id || !process_step) {
        return res.status(400).json({ error: "Missing work_order_id or process_step" });
    }

    try {
        const query = `
            DELETE FROM smt_inspections 
            WHERE process_step = $1 
            AND serial_id IN (
                SELECT id FROM smt_serial_numbers WHERE work_order_id = $2
            )
            RETURNING *
        `;
        const result = await pool.query(query, [process_step, work_order_id]);
        res.status(200).json({ message: "Scan session reset successfully", deleted_count: result.rowCount });
    } catch (err) {
        logger.error("Error deleting scan session:", err);
        res.status(500).json({ error: "Failed to delete scan session" });
    }
};

export const createInspection = async (req: Request, res: Response) => {
    const { serial_id, process_step, scanned_by, status, rework_reason } = req.body;
    try {
        // Duplicate validation check: BLOCK duplicate PASS scans
        if (status !== 'FAIL') {
            const dupCheck = await pool.query(
                `SELECT * FROM smt_inspections 
                 WHERE serial_id = $1 AND process_step = $2 
                 ORDER BY scanned_at DESC LIMIT 1`,
                [serial_id, process_step]
            );

            if ((dupCheck.rowCount ?? 0) > 0 && dupCheck.rows[0].status === 'PASS') {
                return res.status(400).json({ error: "Barcode already processed successfully" });
            }
        }

        if (process_step === 'Post AOI') {
            // Find the absolute latest inspection for this serial_id
            const latestRes = await pool.query(
                `SELECT * FROM smt_inspections WHERE serial_id = $1 ORDER BY scanned_at DESC LIMIT 1`,
                [serial_id]
            );

            if ((latestRes.rowCount ?? 0) > 0 && latestRes.rows[0].process_step === 'Post AOI') {
                const latestId = latestRes.rows[0].id;
                // Update the existing row instead of inserting a new one
                const result = await pool.query(
                    `UPDATE smt_inspections 
                     SET status = $1, rework_reason = $2, scanned_by = $3, scanned_at = CURRENT_TIMESTAMP
                     WHERE id = $4 RETURNING *`,
                    [status || 'PASS', rework_reason || null, scanned_by, latestId]
                );

                // Also update the main status in serial_numbers
                const serialStatus = status === 'FAIL' ? 'REWORK' : 'SCANNED';
                await pool.query(
                    'UPDATE smt_serial_numbers SET status = $1 WHERE id = $2',
                    [serialStatus, serial_id]
                );

                return res.status(200).json(result.rows[0]);
            }
        }

        let finalReworkReason = rework_reason || null;
        if (process_step === 'SPI' && !finalReworkReason) {
            const lastFail = await pool.query(
                `SELECT rework_reason FROM smt_inspections 
                 WHERE serial_id = $1 AND process_step = $2 AND status = 'FAIL' AND rework_reason IS NOT NULL AND rework_reason != ''
                 ORDER BY scanned_at DESC LIMIT 1`,
                [serial_id, process_step]
            );
            if ((lastFail.rowCount ?? 0) > 0) {
                finalReworkReason = lastFail.rows[0].rework_reason;
            }
        }

        // Standard Insert Logic for other steps or new Post AOI / revalidation scans
        const result = await pool.query(
            `INSERT INTO smt_inspections (serial_id, process_step, scanned_by, status, rework_reason) 
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [serial_id, process_step, scanned_by, status || 'PASS', finalReworkReason]
        );

        // Also update the main status in serial_numbers
        let serialStatus = status === 'FAIL' ? 'REWORK' : 'SCANNED';
        if (process_step === 'SMT FG' && (!status || status === 'PASS')) {
            serialStatus = 'COMPLETED';
        }

        await pool.query(
            'UPDATE smt_serial_numbers SET status = $1 WHERE id = $2',
            [serialStatus, serial_id]
        );

        res.status(201).json(result.rows[0]);
    } catch (err) {
        logger.error("Error creating inspection:", err);
        res.status(500).json({ error: "Failed to create inspection" });
    }
};

export const getInspections = async (req: Request, res: Response) => {
    const { serial_id, work_order_id, process_step } = req.query;
    try {
        let query = `
            SELECT i.*, sn.serial_number, sn.work_order_id 
            FROM smt_inspections i
            JOIN smt_serial_numbers sn ON i.serial_id = sn.id
            WHERE 1=1
        `;
        const params: any[] = [];
        if (serial_id) {
            params.push(serial_id);
            query += ` AND i.serial_id = $${params.length}`;
        }
        if (work_order_id) {
            params.push(work_order_id);
            query += ` AND sn.work_order_id = $${params.length}`;
        }
        if (process_step) {
            params.push(process_step);
            query += ` AND i.process_step = $${params.length}`;
        }
        query += ` ORDER BY i.scanned_at DESC`;

        const result = await pool.query(query, params);
        res.status(200).json(result.rows);
    } catch (err) {
        logger.error("Error fetching inspections:", err);
        res.status(500).json({ error: "Failed to fetch inspections" });
    }
};

export const deleteInspection = async (req: Request, res: Response) => {
    const { serial_id, process_step } = req.query;
    try {
        if (!serial_id || !process_step) {
            return res.status(400).json({ error: "serial_id and process_step are required" });
        }
        await pool.query(
            `DELETE FROM smt_inspections WHERE serial_id = $1 AND process_step = $2`,
            [serial_id, process_step]
        );
        res.status(200).json({ message: "Inspection reset successfully" });
    } catch (err) {
        logger.error("Error deleting inspection:", err);
        res.status(500).json({ error: "Failed to reset inspection" });
    }
};

// === Process Setups (SPI, AOI, etc.) ===
export const createProcessSetup = async (req: Request, res: Response) => {
    const { work_order_id, process_name, product_name, quantity, stencil_name, squeegee_number, solder_paste, side } = req.body;
    try {
        const insertResult = await pool.query(
            `INSERT INTO smt_process_setups (work_order_id, process_name, product_name, quantity, stencil_name, squeegee_number, solder_paste, side) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [work_order_id, process_name, product_name, quantity, stencil_name, squeegee_number, solder_paste, side]
        );

        const newId = insertResult.rows[0].id;
        const joinedResult = await pool.query(
            `SELECT ps.*, wo.panel_quantity as panel_qty 
             FROM smt_process_setups ps
             LEFT JOIN smt_work_orders wo ON ps.work_order_id = wo.id
             WHERE ps.id = $1`,
            [newId]
        );

        res.status(201).json(joinedResult.rows[0]);
    } catch (err) {
        logger.error("Error creating process setup:", err);
        res.status(500).json({ error: "Failed to create process setup" });
    }
};

export const getProcessSetups = async (req: Request, res: Response) => {
    const { process_name } = req.query;
    try {
        let query = `
            SELECT ps.*, wo.panel_quantity as panel_qty 
            FROM smt_process_setups ps
            LEFT JOIN smt_work_orders wo ON ps.work_order_id = wo.id
        `;
        const params = [];
        if (process_name) {
            query += ' WHERE ps.process_name = $1';
            params.push(process_name);
        }
        query += ' ORDER BY ps.timestamp DESC';
        const result = await pool.query(query, params);
        res.status(200).json(result.rows);
    } catch (err) {
        logger.error("Error fetching process setups:", err);
        res.status(500).json({ error: "Failed to fetch process setups" });
    }
};

export const deleteProcessSetup = async (req: Request, res: Response) => {
    const { id } = req.params;
    const userRole = (req as any).user?.role;

    if (userRole !== 'Super Admin') {
        return res.status(403).json({ error: "Only Super Admin can delete process setups" });
    }

    try {
        await pool.query('DELETE FROM smt_process_setups WHERE id = $1', [id]);
        res.status(200).json({ message: "Process setup deleted" });
    } catch (err) {
        logger.error("Error deleting process setup:", err);
        res.status(500).json({ error: "Failed to delete process setup" });
    }
};

export const getWorkOrderHistory = async (req: Request, res: Response) => {
    const { areaId, lineId, fromDate, toDate } = req.query;
    try {
        let query = `
            SELECT 
                wo.id as work_order_id,
                wo.area_id,
                wo.line_id,
                wo.product_name,
                wo.quantity as total_qty,
                COALESCE(passed.passed_count, 0)::int as completed_qty,
                (wo.quantity - COALESCE(passed.passed_count, 0))::int as balance_qty,
                CASE 
                    WHEN COALESCE(passed.passed_count, 0) >= wo.quantity THEN 'COMPLETED'
                    WHEN COALESCE(passed.passed_count, 0) > 0 THEN 'ACTIVE'
                    ELSE 'INACTIVE'
                END as status,
                wo.created_by,
                wo.created_at as run_date_time
            FROM smt_work_orders wo
            LEFT JOIN (
                SELECT sn.work_order_id, COUNT(*) as passed_count
                FROM smt_serial_numbers sn
                JOIN (
                    SELECT DISTINCT ON (serial_id) serial_id, process_step, status
                    FROM smt_inspections
                    ORDER BY serial_id, scanned_at DESC
                ) latest ON sn.id = latest.serial_id
                WHERE latest.process_step = 'SMT FG' AND latest.status = 'PASS'
                GROUP BY sn.work_order_id
            ) passed ON wo.id = passed.work_order_id
            WHERE wo.area_id = $1
        `;
        const params: any[] = [areaId || 'SMT'];

        if (lineId && lineId !== 'ALL') {
            params.push(lineId);
            query += ` AND wo.line_id = $${params.length}`;
        }

        if (fromDate) {
            params.push(fromDate);
            query += ` AND wo.created_at >= $${params.length}`;
        }

        if (toDate) {
            params.push(`${toDate} 23:59:59`);
            query += ` AND wo.created_at <= $${params.length}`;
        }

        query += ` GROUP BY wo.id, passed.passed_count ORDER BY wo.created_at DESC`;

        const result = await pool.query(query, params);
        res.status(200).json(result.rows);
    } catch (err) {
        logger.error("Error fetching work order history:", err);
        res.status(500).json({ error: "Failed to fetch work order history" });
    }
};
