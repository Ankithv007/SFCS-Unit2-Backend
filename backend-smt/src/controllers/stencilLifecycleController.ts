import { Request, Response } from 'express';
import pool from '../config/db';
import { createLogger } from '../utils/logger';

const logger = createLogger('StencilLifecycleController');

// Helper to get session operator details
const getSessionUser = (req: Request) => {
    const user = (req as any).user;
    return {
        id: user?.id || user?.userId || null,
        name: user?.name || user?.email || 'Unknown User',
        role: user?.role || 'OPERATOR'
    };
};

/**
 * GET /api/smt/stencil-lifecycle/stencils
 * Fetch all active stencils for searchable dropdown
 */
export const getActiveStencils = async (req: Request, res: Response) => {
    try {
        const query = `
            SELECT
                s.id,
                s.stencil_name,
                s.job_number,
                s.revision,
                s.thickness_mills,
                s.manufacturing_date,
                s.side,
                s.remarks,
                s.target_life_cycle,
                COALESCE(SUM(l.qty_life_cycle), 0)::INTEGER AS print_count
            FROM stencil_master s
            LEFT JOIN smt_stencil_lifecycle l
            ON l.stencil_record_id = s.id
            AND l.is_deleted = FALSE
            WHERE
                s.is_deleted = FALSE
                AND s.status = 'ACTIVE'
            GROUP BY
                s.id,
                s.stencil_name,
                s.job_number,
                s.revision,
                s.thickness_mills,
                s.manufacturing_date,
                s.side,
                s.remarks,
                s.target_life_cycle
            ORDER BY
                s.stencil_name ASC
        `;
        const result = await pool.query(query);
        return res.status(200).json(result.rows);
    } catch (err: any) {
        logger.error('Error fetching active stencils:', err);
        return res.status(500).json({ message: 'Internal server error while fetching active stencils.' });
    }
};

/**
 * GET /api/smt/stencil-lifecycle/work-orders
 * Fetch all work orders for searchable dropdown
 */
export const getLifecycleWorkOrders = async (req: Request, res: Response) => {
    try {
        const query = `
            SELECT wo.id, wo.area_id, wo.line_id, wo.priority, wo.product_name, wo.product_description, 
                   wo.quantity, wo.panel_quantity, wo.sides, wo.status, wo.created_by, wo.created_at, wo.remark
            FROM smt_work_orders wo
            LEFT JOIN (
                SELECT work_order_id, COUNT(*) as lifecycle_count
                FROM smt_stencil_lifecycle
                WHERE is_deleted = false
                GROUP BY work_order_id
            ) l ON wo.id = l.work_order_id
            WHERE 
                l.lifecycle_count IS NULL
                OR (
                    (LOWER(wo.sides) = 'top' OR LOWER(wo.sides) = 'bottom') AND l.lifecycle_count < 1
                )
                OR (
                    (LOWER(wo.sides) = 'top / bottom' OR wo.sides LIKE '%/%') AND l.lifecycle_count < 2
                )
            ORDER BY wo.created_at DESC
        `;
        const result = await pool.query(query);
        return res.status(200).json(result.rows);
    } catch (err: any) {
        logger.error('Error fetching work orders:', err);
        return res.status(500).json({ message: 'Internal server error while fetching work orders.' });
    }
};

/**
 * POST /api/smt/stencil-lifecycle/create
 * Create a new Stencil Life Cycle Record
 */
export const createLifecycleRecord = async (req: Request, res: Response) => {
    const { stencil_record_id, work_order_id, remarks } = req.body;
    const sessionUser = getSessionUser(req);

    if (!stencil_record_id || !work_order_id) {
        return res.status(400).json({ message: 'Stencil and Work Order are mandatory.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Fetch and Lock Stencil Record to prevent race conditions
        const stencilRes = await client.query(
            `SELECT * FROM stencil_master WHERE id = $1 AND is_deleted = false FOR UPDATE`,
            [stencil_record_id]
        );
        if (stencilRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Selected Stencil Master Record not found.' });
        }
        const stencil = stencilRes.rows[0];

        if (stencil.status !== 'ACTIVE') {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Selected stencil is not currently active.' });
        }

        // 2. Fetch Work Order Details
        const woRes = await client.query(
            `SELECT * FROM smt_work_orders WHERE id = $1`,
            [work_order_id]
        );
        if (woRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Selected Work Order not found.' });
        }
        const workOrder = woRes.rows[0];

        // 3. Determine the Side being registered and perform uniqueness checks
        const existingRes = await client.query(
            `SELECT id, sides FROM smt_stencil_lifecycle 
             WHERE work_order_id = $1 AND is_deleted = false`,
            [work_order_id]
        );
        const existingRecords = existingRes.rows;

        const woSides = (workOrder.sides || '').trim().toLowerCase();
        let registrationSide = '';

        if (woSides === 'top') {
            if (existingRecords.length > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ message: 'A Stencil Life Cycle record already exists for the TOP side of this Work Order.' });
            }
            registrationSide = 'Top';
        } else if (woSides === 'bottom') {
            if (existingRecords.length > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ message: 'A Stencil Life Cycle record already exists for the BOTTOM side of this Work Order.' });
            }
            registrationSide = 'Bottom';
        } else if (woSides === 'top / bottom' || woSides.includes('/')) {
            // Double-sided PCB: determine registration side from selected stencil's side
            const stencilSide = (stencil.side || '').trim().toLowerCase();
            if (stencilSide === 'top') {
                registrationSide = 'Top';
            } else if (stencilSide === 'bottom') {
                registrationSide = 'Bottom';
            } else {
                // If stencil side is 'TOP / BOTTOM' or unspecified, look at what side is not registered yet
                const hasTop = existingRecords.some(r => r.sides.trim().toLowerCase() === 'top');
                const hasBottom = existingRecords.some(r => r.sides.trim().toLowerCase() === 'bottom');
                if (!hasTop) {
                    registrationSide = 'Top';
                } else if (!hasBottom) {
                    registrationSide = 'Bottom';
                } else {
                    registrationSide = 'Top'; // will trigger duplicate check below
                }
            }

            // Check if there is already a record for this specific side
            const duplicateForSide = existingRecords.some(r => r.sides.trim().toLowerCase() === registrationSide.toLowerCase());
            if (duplicateForSide) {
                await client.query('ROLLBACK');
                return res.status(400).json({ 
                    message: `A Stencil Life Cycle record already exists for the ${registrationSide.toUpperCase()} side of this Work Order.` 
                });
            }
        } else {
            // Fallback for single-sided or unrecognized work order sides
            if (existingRecords.length > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ message: 'A Stencil Life Cycle record already exists for this Work Order.' });
            }
            registrationSide = 'Top';
        }

        // 4. Calculate Life Cycle Consumption dynamically from lifecycle database records
        const printsRes = await client.query(
            `SELECT COALESCE(SUM(qty_life_cycle), 0)::INTEGER AS print_count 
             FROM smt_stencil_lifecycle 
             WHERE stencil_record_id = $1 AND is_deleted = false`,
            [stencil.id]
        );
        const currentPrintCount = printsRes.rows[0].print_count;
        const targetLifeCycle = stencil.target_life_cycle || 60000;
        const workOrderQty = workOrder.quantity || 0;
        const newUsedLifeCycle = currentPrintCount + workOrderQty;

        // Validation against maximum target limit
        if (newUsedLifeCycle > targetLifeCycle) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                message: 'Cannot assign this Work Order. The selected stencil has reached its maximum life cycle. Please select another stencil.'
            });
        }

        const balanceLifeCycle = targetLifeCycle - newUsedLifeCycle;
        
        // Status calculations based on current assignment balance
        let status = 'Running';
        if (balanceLifeCycle === 0) {
            status = 'Completed';
        } else if (newUsedLifeCycle === 0) {
            status = 'Available';
        }

        // 5. Insert Stencil Lifecycle Record
        const insertQuery = `
            INSERT INTO smt_stencil_lifecycle (
                stencil_record_id, stencil_id, stencil_name,
                work_order_id, work_order_number, product_name, product_description,
                sides, quantity, target_life_cycle, qty_life_cycle, balance_life_cycle,
                current_used_life_cycle, status, remarks, created_by, created_by_name
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
            RETURNING *
        `;

        const lifecycleRes = await client.query(insertQuery, [
            stencil.id,
            stencil.stencil_id,
            stencil.stencil_name,
            workOrder.id,
            workOrder.id, // work_order_number is the same as ID
            workOrder.product_name,
            workOrder.product_description,
            registrationSide, // Saved specific registered side instead of workOrder.sides
            workOrder.quantity,
            targetLifeCycle,
            workOrderQty,
            balanceLifeCycle,
            newUsedLifeCycle,
            status,
            remarks ? remarks.trim() : null,
            sessionUser.id,
            sessionUser.name
        ]);

        const savedRecord = lifecycleRes.rows[0];

        // 6. Update Stencil print count and status in stencil_master
        const newStencilStatus = newUsedLifeCycle >= targetLifeCycle ? 'INACTIVE' : 'ACTIVE';
        await client.query(
            `UPDATE stencil_master 
             SET print_count = $1, status = $2, updated_at = CURRENT_TIMESTAMP 
             WHERE id = $3`,
            [newUsedLifeCycle, newStencilStatus, stencil.id]
        );

        // 7. Write to Audit Log
        await client.query(
            `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description, new_value)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                'CREATE',
                'STENCIL_LIFECYCLE',
                savedRecord.id,
                sessionUser.name,
                `Work Order ${workOrder.id} (${workOrderQty} prints) assigned to Stencil '${stencil.stencil_name}'. Used life cycle updated to ${newUsedLifeCycle}/${targetLifeCycle}.`,
                JSON.stringify(savedRecord)
            ]
        );

        await client.query('COMMIT');

        const { stencil_id, ...cleanedRecord } = savedRecord;

        return res.status(201).json({
            message: 'Stencil Lifecycle Record Created Successfully.',
            record: cleanedRecord
        });
    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error('Error creating lifecycle record:', err);
        return res.status(500).json({ message: 'Internal server error while saving lifecycle record.' });
    } finally {
        client.release();
    }
};

/**
 * GET /api/smt/stencil-lifecycle/records
 * Fetch paginated, searchable, sorted list of lifecycle records
 */
export const getLifecycleRecords = async (req: Request, res: Response) => {
    try {
        const page = parseInt(req.query.page as string || '1', 10);
        const limit = parseInt(req.query.limit as string || '10', 10);
        const search = (req.query.search as string || '').trim();
        const sortBy = (req.query.sortBy as string || 'created_at').trim();
        const sortOrder = (req.query.sortOrder as string || 'DESC').trim().toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        const offset = (page - 1) * limit;

        const allowedSortCols = [
            'stencil_name',
            'work_order_number',
            'sides',
            'product_name',
            'target_life_cycle',
            'qty_life_cycle',
            'balance_life_cycle',
            'created_at',
            'status'
        ];
        const actualSortBy = allowedSortCols.includes(sortBy) ? sortBy : 'created_at';

        let queryParams: any[] = [];
        let filterSql = `WHERE is_deleted = false`;

        if (search) {
            queryParams.push(`%${search}%`);
            filterSql += ` AND (
                stencil_name ILIKE $1 OR
                work_order_number ILIKE $1 OR
                product_name ILIKE $1 OR
                status ILIKE $1
            )`;
        }

        // Count total matching records
        const countQuery = `SELECT COUNT(*) FROM smt_stencil_lifecycle ${filterSql}`;
        const countRes = await pool.query(countQuery, queryParams);
        const total = parseInt(countRes.rows[0].count, 10);

        // Fetch records
        const selectQuery = `
            SELECT * FROM smt_stencil_lifecycle
            ${filterSql}
            ORDER BY ${actualSortBy} ${sortOrder}
            LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
        `;
        
        queryParams.push(limit, offset);
        const recordsRes = await pool.query(selectQuery, queryParams);

        // Sanitize records to omit stencil_id
        const sanitizedRecords = recordsRes.rows.map(row => {
            const { stencil_id, ...rest } = row;
            return rest;
        });

        return res.status(200).json({
            data: sanitizedRecords,
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (err: any) {
        logger.error('Error fetching lifecycle records:', err);
        return res.status(500).json({ message: 'Internal server error while fetching lifecycle records.' });
    }
};

/**
 * GET /api/smt/stencil-lifecycle/records/:id
 * Get single lifecycle record with complete details from both modules
 */
export const getLifecycleRecordById = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        const query = `SELECT * FROM smt_stencil_lifecycle WHERE id = $1 AND is_deleted = false`;
        const result = await pool.query(query, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Stencil Lifecycle Record not found.' });
        }

        const record = result.rows[0];

        // Fetch associated Stencil Master details
        const stencilRes = await pool.query(
            `SELECT * FROM stencil_master WHERE id = $1`,
            [record.stencil_record_id]
        );
        const stencilDetails = stencilRes.rows[0] || null;

        // Fetch associated Work Order details
        const woRes = await pool.query(
            `SELECT * FROM smt_work_orders WHERE id = $1`,
            [record.work_order_id]
        );
        const workOrderDetails = woRes.rows[0] || null;

        const { stencil_id: r_sid, ...cleanedRecord } = record || {};
        let cleanedStencil = null;
        if (stencilDetails) {
            const { stencil_id: s_sid, ...rest } = stencilDetails;
            cleanedStencil = rest;
        }

        return res.status(200).json({
            record: cleanedRecord,
            stencil: cleanedStencil,
            workOrder: workOrderDetails
        });
    } catch (err: any) {
        logger.error('Error fetching lifecycle details:', err);
        return res.status(500).json({ message: 'Internal server error while fetching details.' });
    }
};

/**
 * DELETE /api/smt/stencil-lifecycle/records/:id
 * Soft delete a lifecycle record (Super Admin only)
 */
export const deleteLifecycleRecord = async (req: Request, res: Response) => {
    const { id } = req.params;
    const sessionUser = getSessionUser(req);

    // Verify Super Admin permission
    if (sessionUser.role !== 'Super Admin') {
        return res.status(403).json({
            success: false,
            message: 'Only Super Admin is authorized to delete records.',
            error: 'Only Super Admin is authorized to delete records.'
        });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Fetch lifecycle record
        const lifecycleRes = await client.query(
            `SELECT * FROM smt_stencil_lifecycle WHERE id = $1 AND is_deleted = false FOR UPDATE`,
            [id]
        );
        if (lifecycleRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Lifecycle record not found.' });
        }
        const record = lifecycleRes.rows[0];

        // 2. Fetch and lock stencil record
        const stencilRes = await client.query(
            `SELECT * FROM stencil_master WHERE id = $1 FOR UPDATE`,
            [record.stencil_record_id]
        );
        if (stencilRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Associated stencil not found.' });
        }
        const stencil = stencilRes.rows[0];

        // 3. Deduct prints from used prints balance
        const currentPrintCount = stencil.print_count || 0;
        const newPrintCount = Math.max(0, currentPrintCount - record.qty_life_cycle);

        // If prints are below target, set stencil back to ACTIVE
        const targetLimit = stencil.target_life_cycle || 60000;
        const newStatus = newPrintCount < targetLimit ? 'ACTIVE' : stencil.status;

        // 4. Update Stencil Master
        await client.query(
            `UPDATE stencil_master 
             SET print_count = $1, status = $2, updated_at = CURRENT_TIMESTAMP 
             WHERE id = $3`,
            [newPrintCount, newStatus, stencil.id]
        );

        // 5. Soft Delete lifecycle record
        await client.query(
            `UPDATE smt_stencil_lifecycle
             SET is_deleted = true,
                 deleted_by = $1,
                 deleted_by_name = $2,
                 deleted_at = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $3`,
            [sessionUser.id, sessionUser.name, id]
        );

        // 6. Write Audit Log
        await client.query(
            `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description, old_value, new_value)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                'DELETE',
                'STENCIL_LIFECYCLE',
                id,
                sessionUser.name,
                `Stencil Lifecycle Record ${id} soft deleted by Super Admin. Subtracted ${record.qty_life_cycle} prints from Stencil '${stencil.stencil_name}'.`,
                JSON.stringify(record),
                JSON.stringify({
                    userId: sessionUser.id,
                    userName: sessionUser.name,
                    userRole: sessionUser.role,
                    moduleName: 'Stencil Lifecycle Management',
                    recordId: id,
                    timestamp: new Date().toISOString(),
                    action: 'DELETE'
                })
            ]
        );

        await client.query('COMMIT');
        return res.status(200).json({ message: 'Lifecycle record deleted successfully.' });
    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error('Error deleting lifecycle record:', err);
        return res.status(500).json({ message: 'Internal server error while deleting lifecycle record.' });
    } finally {
        client.release();
    }
};
