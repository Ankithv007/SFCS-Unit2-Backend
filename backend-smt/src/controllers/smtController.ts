import { Request, Response } from 'express';
import pool from '../config/db';

// === Work Orders ===
export const createWorkOrder = async (req: Request, res: Response) => {
    const { work_order_id, area_id, line_id, priority, product_name, product_description, quantity, panel_quantity, created_by } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO smt_work_orders (id, area_id, line_id, priority, product_name, product_description, quantity, panel_quantity, created_by) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [work_order_id, area_id, line_id, priority, product_name, product_description, quantity, panel_quantity, created_by]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error("Error creating work order:", err);
        res.status(500).json({ error: "Failed to create work order" });
    }
};

export const getPendingWorkOrders = async (req: Request, res: Response) => {
    try {
        const query = `
            SELECT 
                wo.*, 
                COUNT(sn.id) as generated_count
            FROM smt_work_orders wo
            LEFT JOIN smt_serial_numbers sn ON wo.id = sn.work_order_id
            GROUP BY wo.id
            HAVING COUNT(sn.id) < wo.panel_quantity
            ORDER BY wo.created_at DESC
        `;
        const result = await pool.query(query);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error("Error fetching pending work orders:", err);
        res.status(500).json({ error: "Failed to fetch pending work orders" });
    }
};

export const getWorkOrders = async (req: Request, res: Response) => {
    try {
        const result = await pool.query('SELECT * FROM smt_work_orders ORDER BY created_at DESC');
        res.status(200).json(result.rows);
    } catch (err) {
        console.error("Error fetching work orders:", err);
        res.status(500).json({ error: "Failed to fetch work orders" });
    }
};

export const registerWorkOrder = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const result = await pool.query(
            'UPDATE smt_work_orders SET is_registered = true WHERE id = $1 RETURNING *',
            [id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: "Work order not found" });
        res.status(200).json(result.rows[0]);
    } catch (err) {
        console.error("Error registering work order:", err);
        res.status(500).json({ error: "Failed to register work order" });
    }
};

export const getRegisteredWorkOrders = async (req: Request, res: Response) => {
    try {
        const result = await pool.query(`
            SELECT DISTINCT wo.* 
            FROM smt_work_orders wo
            JOIN smt_serial_numbers sn ON wo.id = sn.work_order_id
            WHERE sn.status = 'SCANNED' OR wo.is_registered = true
            ORDER BY wo.created_at DESC
        `);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error("Error fetching registered work orders:", err);
        res.status(500).json({ error: "Failed to fetch registered work orders" });
    }
};

// === Serial Numbers ===
export const generateSerials = async (req: Request, res: Response) => {
    const { work_order_id, format, serials, created_by } = req.body;

    // Safety Layer: Aggressive cleaning
    const cleanFormat = (format || "").replace(/-/g, "").toUpperCase();
    const cleanSerials = (serials || []).map((s: string) => s.replace(/-/g, "").toUpperCase());

    try {
        await pool.query('BEGIN');

        for (const serial of cleanSerials) {
            const snResult = await pool.query(
                `INSERT INTO smt_serial_numbers (work_order_id, serial_format, serial_number, created_by) 
                 VALUES ($1, $2, $3, $4) RETURNING id`,
                [work_order_id, cleanFormat, serial, created_by]
            );

            const serialId = snResult.rows[0].id;

            // Insert initial activation record
            await pool.query(
                `INSERT INTO smt_inspections (serial_id, process_step, scanned_by, status) 
                 VALUES ($1, $2, $3, $4)`,
                [serialId, 'Serial Number', created_by, 'PASS']
            );
        }

        await pool.query('COMMIT');
        res.status(201).json({ message: "Serials generated successfully" });
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error("Error generating serials:", err);
        res.status(500).json({ error: "Failed to generate serials" });
    }
};

export const getSerials = async (req: Request, res: Response) => {
    const { work_order_id, filter_step, filter_status } = req.query;
    try {
        let query = `
            SELECT 
                sn.*, 
                wo.product_name, 
                wo.quantity as wo_qty, 
                wo.panel_quantity as panel_qty, 
                wo.created_by as wo_created_by,
                wo.is_registered,
                last_insp.status as last_status,
                last_insp.process_step as last_step,
                last_insp.rework_reason
            FROM smt_serial_numbers sn
            JOIN smt_work_orders wo ON sn.work_order_id = wo.id
            LEFT JOIN (
                SELECT DISTINCT ON (serial_id) serial_id, status, process_step, rework_reason, scanned_at
                FROM smt_inspections
                ORDER BY serial_id, scanned_at DESC
            ) last_insp ON sn.id = last_insp.serial_id
        `;
        const params: any[] = [];
        const conditions: string[] = [];

        if (work_order_id) {
            params.push(work_order_id);
            conditions.push(`sn.work_order_id = $${params.length}`);
        }

        if (filter_step && filter_status) {
            // Split by comma in case multiple steps are provided
            const steps = (filter_step as string).split(',');
            const stepPlaceholders = steps.map((_, i) => `$${params.length + i + 1}`).join(',');

            query += ` JOIN smt_inspections insp_filter ON sn.id = insp_filter.serial_id `;
            steps.forEach(step => params.push(step.trim()));
            conditions.push(`insp_filter.process_step IN (${stepPlaceholders})`);

            params.push(filter_status);
            conditions.push(`insp_filter.status = $${params.length}`);
        } else if (filter_status) {
            // If only status is provided, filter by any step with that status
            query += ` JOIN smt_inspections insp_filter ON sn.id = insp_filter.serial_id `;
            params.push(filter_status);
            conditions.push(`insp_filter.status = $${params.length}`);
        }

        if (conditions.length > 0) {
            query += ` WHERE ` + conditions.join(' AND ');
        }

        query += ` ORDER BY sn.id ASC`;

        const result = await pool.query(query, params);

        // Safety Layer: Clean API Response
        const cleanedRows = result.rows.map(row => ({
            ...row,
            serial_number: (row.serial_number || "").replace(/-/g, ""),
            serial_format: (row.serial_format || "").replace(/-/g, "")
        }));

        res.status(200).json(cleanedRows);
    } catch (err) {
        console.error("Error fetching serials:", err);
        res.status(500).json({ error: "Failed to fetch serials" });
    }
};

export const deleteSerials = async (req: Request, res: Response) => {
    const { work_order_id } = req.query;
    try {
        if (work_order_id) {
            await pool.query('DELETE FROM smt_serial_numbers WHERE work_order_id = $1', [work_order_id]);
        } else {
            await pool.query('DELETE FROM smt_serial_numbers');
        }
        res.status(200).json({ message: "Serials deleted successfully" });
    } catch (err) {
        console.error("Error deleting serials:", err);
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
        console.error("Error creating employee:", err);
        res.status(500).json({ error: "Failed to create employee" });
    }
};

export const getEmployees = async (req: Request, res: Response) => {
    try {
        const result = await pool.query('SELECT * FROM smt_printing_employees ORDER BY created_at DESC');
        res.status(200).json(result.rows);
    } catch (err) {
        console.error("Error fetching employees:", err);
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
        console.error("Error updating employee:", err);
        res.status(500).json({ error: "Failed to update employee" });
    }
};

export const deleteEmployee = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM smt_printing_employees WHERE id = $1', [id]);
        res.status(200).json({ message: "Employee deleted" });
    } catch (err) {
        console.error("Error deleting employee:", err);
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
        console.error("Error toggling status:", err);
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
        console.error("Error during login:", err);
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
        console.error("Error updating serial status:", err);
        res.status(500).json({ error: "Failed to update serial status" });
    }
};

// === Inspections ===
export const createInspection = async (req: Request, res: Response) => {
    const { serial_id, process_step, scanned_by, status, rework_reason } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO smt_inspections (serial_id, process_step, scanned_by, status, rework_reason) 
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [serial_id, process_step, scanned_by, status || 'PASS', rework_reason || null]
        );

        // Also update the main status in serial_numbers if it's a pass
        if (status !== 'FAIL') {
            await pool.query(
                'UPDATE smt_serial_numbers SET status = $1 WHERE id = $2',
                ['SCANNED', serial_id]
            );
        }

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error("Error creating inspection:", err);
        res.status(500).json({ error: "Failed to create inspection" });
    }
};

export const getInspections = async (req: Request, res: Response) => {
    const { serial_id, work_order_id } = req.query;
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
        query += ` ORDER BY i.scanned_at DESC`;

        const result = await pool.query(query, params);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error("Error fetching inspections:", err);
        res.status(500).json({ error: "Failed to fetch inspections" });
    }
};

// === Process Setups (SPI, AOI, etc.) ===
export const createProcessSetup = async (req: Request, res: Response) => {
    const { work_order_id, process_name, product_name, quantity, stencil_name, squeegee_number, solder_paste, side } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO smt_process_setups (work_order_id, process_name, product_name, quantity, stencil_name, squeegee_number, solder_paste, side) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [work_order_id, process_name, product_name, quantity, stencil_name, squeegee_number, solder_paste, side]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error("Error creating process setup:", err);
        res.status(500).json({ error: "Failed to create process setup" });
    }
};

export const getProcessSetups = async (req: Request, res: Response) => {
    const { process_name } = req.query;
    try {
        let query = 'SELECT * FROM smt_process_setups';
        const params = [];
        if (process_name) {
            query += ' WHERE process_name = $1';
            params.push(process_name);
        }
        query += ' ORDER BY timestamp DESC';
        const result = await pool.query(query, params);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error("Error fetching process setups:", err);
        res.status(500).json({ error: "Failed to fetch process setups" });
    }
};

export const deleteProcessSetup = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM smt_process_setups WHERE id = $1', [id]);
        res.status(200).json({ message: "Process setup deleted" });
    } catch (err) {
        console.error("Error deleting process setup:", err);
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
                COUNT(CASE WHEN sn.status = 'SCANNED' THEN 1 END) as completed_qty,
                (wo.quantity - COUNT(CASE WHEN sn.status = 'SCANNED' THEN 1 END)) as balance_qty,
                CASE 
                    WHEN COUNT(CASE WHEN sn.status = 'SCANNED' THEN 1 END) >= wo.quantity THEN 'COMPLETED'
                    WHEN COUNT(CASE WHEN sn.status = 'SCANNED' THEN 1 END) > 0 THEN 'ACTIVE'
                    ELSE 'INACTIVE'
                END as status,
                wo.created_by,
                wo.created_at as run_date_time
            FROM smt_work_orders wo
            LEFT JOIN smt_serial_numbers sn ON wo.id = sn.work_order_id
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

        query += ` GROUP BY wo.id ORDER BY wo.created_at DESC`;

        const result = await pool.query(query, params);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error("Error fetching work order history:", err);
        res.status(500).json({ error: "Failed to fetch work order history" });
    }
};
