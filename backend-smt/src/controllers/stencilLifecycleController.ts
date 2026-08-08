import { Request, Response } from 'express';
import pool from '../config/db';
import { createLogger } from '../utils/logger';

const logger = createLogger('StencilLifecycleController');

// Extensible permission definition
const MAINTENANCE_PERMISSION = { key: 'smt_stencil_lifecycle', action: 'can_edit' };

// Status constants/enums to avoid hardcoding
const LIFECYCLE_ASSIGNMENT_STATUS = {
    AVAILABLE: 'Available',
    RUNNING: 'Running',
    COMPLETED: 'Completed',
    EXPIRED: 'Expired'
};

const STENCIL_LIFECYCLE_STATUS = {
    ACTIVE: 'ACTIVE',
    MAINTENANCE: 'MAINTENANCE',
    SCRAPPED: 'SCRAPPED'
};

// Helper to get session operator details
const getSessionUser = (req: Request) => {
    const user = (req as any).user;
    return {
        id: user?.id || user?.userId || null,
        name: user?.name || user?.email || 'Unknown User',
        role: user?.role || 'OPERATOR',
        employee_code: user?.employee_code || 'OP-UNKNOWN',
        department: user?.department || 'SMT'
    };
};

/**
 * GET /api/smt/stencil-lifecycle/stencils
 * Fetch all active stencils with full cycle & capacity metrics for searchable dropdown
 */
export const getActiveStencils = async (req: Request, res: Response) => {
    try {
        const query = `
            SELECT
                s.id,
                s.stencil_rack_number AS stencil_id,
                s.stencil_rack_number,
                s.stencil_name,
                s.job_number,
                s.revision,
                s.thickness_mills,
                s.manufacturing_date,
                s.side,
                s.remarks,
                s.status AS physical_status,
                COALESCE(states.cycle_number, 1)::INTEGER AS cycle_number,
                COALESCE(states.current_cycle_capacity, states.target_life_cycle, 60000)::INTEGER AS current_cycle_capacity,
                COALESCE(states.target_life_cycle, 60000)::INTEGER AS target_life_cycle,
                COALESCE(states.total_lifetime_prints, 0)::BIGINT AS total_lifetime_prints,
                COALESCE(states.lifecycle_status, 'ACTIVE') AS lifecycle_status,
                COALESCE(states.maintenance_count, 0)::INTEGER AS maintenance_count,
                states.last_maintenance_date,
                states.last_maintenance_by_code,
                states.last_maintenance_by_name,
                COALESCE(
                    (SELECT SUM(l.qty_life_cycle)
                     FROM smt_stencil_lifecycle l
                     WHERE LOWER(TRIM(l.stencil_id)) = LOWER(TRIM(s.stencil_rack_number))
                       AND l.is_deleted = FALSE
                       AND l.created_at > COALESCE(states.last_maintenance_date, '1970-01-01'::timestamp)
                    ), 0
                )::INTEGER AS print_count
            FROM stencil_rack_locations s
            LEFT JOIN smt_stencil_lifecycle_states states
            ON s.id = states.stencil_record_id
            WHERE
                s.status IN ('STORED', 'CHECKED_OUT')
                AND COALESCE(states.lifecycle_status, 'ACTIVE') <> 'SCRAPPED'
            ORDER BY
                s.stencil_name ASC
        `;
        const result = await pool.query(query);
        const stencils = result.rows.map(row => {
            const printCount = parseInt(row.print_count, 10) || 0;
            const cycleCapacity = parseInt(row.current_cycle_capacity, 10) || 60000;
            const remainingLife = Math.max(0, cycleCapacity - printCount);
            const remainingPercentage = cycleCapacity > 0 ? (remainingLife / cycleCapacity) * 100 : 0;
            const consumedPercentage = cycleCapacity > 0 ? (printCount / cycleCapacity) * 100 : 0;

            let healthIndicator = 'Green';
            if (row.lifecycle_status === 'MAINTENANCE' || row.lifecycle_status === 'SCRAPPED' || consumedPercentage >= 100) {
                healthIndicator = 'Red';
            } else if (consumedPercentage >= 90) {
                healthIndicator = 'Orange';
            } else if (consumedPercentage >= 80) {
                healthIndicator = 'Yellow';
            }

            return {
                ...row,
                print_count: printCount,
                current_cycle_used: printCount,
                current_cycle_capacity: cycleCapacity,
                target_life_cycle: cycleCapacity,
                remaining_life: remainingLife,
                remaining_percentage: parseFloat(remainingPercentage.toFixed(2)),
                health_indicator: healthIndicator
            };
        });
        return res.status(200).json(stencils);
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
 * Create a new Stencil Life Cycle Record with Multi-WO & Capacity Validation support
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

        // 1. Fetch and Lock Stencil Location Record to prevent race conditions
        const stencilRes = await client.query(
            `SELECT * FROM stencil_rack_locations WHERE id = $1 AND status IN ('STORED', 'CHECKED_OUT') FOR UPDATE`,
            [stencil_record_id]
        );
        if (stencilRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Selected Stencil location record not found.' });
        }
        const stencil = stencilRes.rows[0];

        // 2. Validate physical status
        if (stencil.status === 'CHECKED_OUT') {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'The selected stencil is currently checked out and cannot be assigned until it has been returned to the rack.' });
        }
        if (stencil.status !== 'STORED') {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'The selected stencil is not stored in the rack.' });
        }

        // 3. Fetch or initialize stencil lifecycle state record
        let stateRes = await client.query(
            `SELECT * FROM smt_stencil_lifecycle_states WHERE LOWER(TRIM(stencil_rack_number)) = LOWER(TRIM($1)) FOR UPDATE`,
            [stencil.stencil_rack_number]
        );
        let lifecycleState = stateRes.rows[0];

        if (!lifecycleState) {
            // Get default target life cycle from system configuration
            const configRes = await client.query(
                `SELECT value FROM system_configuration WHERE key = 'stencil_target_lifecycle'`
            );
            const targetLifeCycle = configRes.rows.length > 0 ? parseInt(configRes.rows[0].value, 10) : 60000;

            const insertStateRes = await client.query(
                `INSERT INTO smt_stencil_lifecycle_states 
                 (stencil_record_id, stencil_rack_number, target_life_cycle, current_cycle_capacity, cycle_number, total_lifetime_prints, lifecycle_status, created_by, created_by_name)
                 VALUES ($1, $2, $3, $3, 1, 0, 'ACTIVE', $4, $5)
                 RETURNING *`,
                [stencil.id, stencil.stencil_rack_number, targetLifeCycle, sessionUser.employee_code, sessionUser.name]
            );
            lifecycleState = insertStateRes.rows[0];

            // Insert initial status history ACTIVE
            await client.query(
                `INSERT INTO smt_stencil_lifecycle_status_history
                 (stencil_rack_number, previous_status, new_status, changed_by_code, changed_by_name, reason, remarks)
                 VALUES ($1, NULL, 'ACTIVE', $2, $3, 'Initial Registration', 'Initialized stencil lifecycle state.')`,
                [stencil.stencil_rack_number, sessionUser.employee_code, sessionUser.name]
            );
        }

        // 4. Validate lifecycle status
        if (lifecycleState.lifecycle_status === STENCIL_LIFECYCLE_STATUS.MAINTENANCE) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                message: 'This stencil has reached its maximum lifecycle capacity and requires maintenance before it can be used again.',
                lifecycle_status: 'MAINTENANCE'
            });
        }
        if (lifecycleState.lifecycle_status === STENCIL_LIFECYCLE_STATUS.SCRAPPED) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                message: 'This stencil has been scrapped and cannot be assigned to any Work Order.',
                lifecycle_status: 'SCRAPPED'
            });
        }

        // NOTE: Multiple Work Order restriction is explicitly removed as requested by business rules.
        // The same stencil CAN be assigned to multiple Work Orders until cycle capacity is exhausted.

        // 5. Fetch Work Order Details
        const woRes = await client.query(
            `SELECT * FROM smt_work_orders WHERE id = $1`,
            [work_order_id]
        );
        if (woRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Selected Work Order not found.' });
        }
        const workOrder = woRes.rows[0];

        // 5b. MANDATORY VALIDATION: Work Order Side vs Stencil Rack Side Strict 1:1 Matching
        const normWOSide = (workOrder.sides || '').trim().toUpperCase().replace(/\s*\/\s*/g, '/');
        const normStencilSide = (stencil.side || '').trim().toUpperCase().replace(/\s*\/\s*/g, '/');

        if (normWOSide !== normStencilSide) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                message: `Stencil side ${stencil.side || 'N/A'} does not match Work Order side ${workOrder.sides}. A ${stencil.side || 'N/A'} stencil can only be used for a ${stencil.side || 'N/A'} Work Order.`
            });
        }

        // 6. Determine the Side being registered and perform uniqueness checks per Work Order
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
            const stencilSide = (stencil.side || '').trim().toLowerCase();
            if (stencilSide === 'top') {
                registrationSide = 'Top';
            } else if (stencilSide === 'bottom') {
                registrationSide = 'Bottom';
            } else {
                const hasTop = existingRecords.some(r => r.sides.trim().toLowerCase() === 'top');
                const hasBottom = existingRecords.some(r => r.sides.trim().toLowerCase() === 'bottom');
                if (!hasTop) {
                    registrationSide = 'Top';
                } else if (!hasBottom) {
                    registrationSide = 'Bottom';
                } else {
                    registrationSide = 'Top';
                }
            }

            const duplicateForSide = existingRecords.some(r => r.sides.trim().toLowerCase() === registrationSide.toLowerCase());
            if (duplicateForSide) {
                await client.query('ROLLBACK');
                return res.status(400).json({ 
                    message: `A Stencil Life Cycle record already exists for the ${registrationSide.toUpperCase()} side of this Work Order.` 
                });
            }
        } else {
            if (existingRecords.length > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ message: 'A Stencil Life Cycle record already exists for this Work Order.' });
            }
            registrationSide = 'Top';
        }

        // 7. Calculate Current Cycle Life Cycle Consumption dynamically
        const printsRes = await client.query(
            `SELECT COALESCE(SUM(qty_life_cycle), 0)::INTEGER AS print_count 
             FROM smt_stencil_lifecycle 
             WHERE LOWER(TRIM(stencil_id)) = LOWER(TRIM($1)) 
               AND is_deleted = false
               AND created_at > COALESCE($2, '1970-01-01'::timestamp)`,
            [stencil.stencil_rack_number, lifecycleState.last_maintenance_date]
        );
        const currentCycleUsed = printsRes.rows[0].print_count;
        const currentCycleCapacity = parseInt(lifecycleState.current_cycle_capacity || lifecycleState.target_life_cycle || 60000, 10);
        const workOrderQty = workOrder.quantity || 0;
        const projectedUsed = currentCycleUsed + workOrderQty;

        const remainingBefore = Math.max(0, currentCycleCapacity - currentCycleUsed);
        const remainingAfter = currentCycleCapacity - projectedUsed;

        // Capacity validation: Projected usage MUST NOT exceed current cycle capacity
        if (projectedUsed > currentCycleCapacity) {
            await client.query('ROLLBACK');
            const excessPrints = projectedUsed - currentCycleCapacity;
            return res.status(400).json({
                message: `The selected Work Order quantity exceeds the stencil's remaining lifecycle capacity. Insufficient capacity: Remaining ${remainingBefore} prints, Work Order requires ${workOrderQty} prints.`,
                details: {
                    current_used_prints: currentCycleUsed,
                    current_lifecycle_capacity: currentCycleCapacity,
                    remaining_prints: remainingBefore,
                    work_order_quantity: workOrderQty,
                    required_prints: workOrderQty,
                    excess_prints: excessPrints
                }
            });
        }

        let assignmentStatus = LIFECYCLE_ASSIGNMENT_STATUS.RUNNING;
        if (remainingAfter === 0) {
            assignmentStatus = LIFECYCLE_ASSIGNMENT_STATUS.COMPLETED;
        } else if (projectedUsed === 0) {
            assignmentStatus = LIFECYCLE_ASSIGNMENT_STATUS.AVAILABLE;
        }

        const currentCycleNumber = lifecycleState.cycle_number || 1;

        // 8. Insert Stencil Lifecycle Record with full cycle tracking details
        const insertQuery = `
            INSERT INTO smt_stencil_lifecycle (
                stencil_record_id, stencil_id, stencil_name,
                work_order_id, work_order_number, product_name, product_description,
                sides, quantity, target_life_cycle, qty_life_cycle, balance_life_cycle,
                current_used_life_cycle, status, remarks, created_by, created_by_name,
                cycle_number, previous_used_prints, quantity_added, new_used_prints,
                previous_remaining_prints, new_remaining_prints
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
            RETURNING *
        `;

        const lifecycleRes = await client.query(insertQuery, [
            stencil.id,
            stencil.stencil_rack_number,
            stencil.stencil_name,
            workOrder.id,
            workOrder.id,
            workOrder.product_name,
            workOrder.product_description,
            registrationSide,
            workOrder.quantity,
            currentCycleCapacity,
            workOrderQty,
            remainingAfter,
            projectedUsed,
            assignmentStatus,
            remarks ? remarks.trim() : null,
            sessionUser.id,
            sessionUser.name,
            currentCycleNumber,
            currentCycleUsed,
            workOrderQty,
            projectedUsed,
            remainingBefore,
            remainingAfter
        ]);

        const savedRecord = lifecycleRes.rows[0];

        // 9. Update total lifetime prints & automatically set status to MAINTENANCE if current cycle capacity is reached
        const newLifetimePrints = (parseInt(lifecycleState.total_lifetime_prints, 10) || 0) + workOrderQty;

        if (projectedUsed === currentCycleCapacity) {
            await client.query(
                `UPDATE smt_stencil_lifecycle_states
                 SET lifecycle_status = 'MAINTENANCE',
                     total_lifetime_prints = $1,
                     updated_by = $2,
                     updated_by_name = $3,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $4`,
                [newLifetimePrints, sessionUser.employee_code, sessionUser.name, lifecycleState.id]
            );

            // Record status transition
            await client.query(
                `INSERT INTO smt_stencil_lifecycle_status_history
                 (stencil_rack_number, previous_status, new_status, changed_by_code, changed_by_name, reason, remarks)
                 VALUES ($1, 'ACTIVE', 'MAINTENANCE', $2, $3, 'Target Life Cycle Reached', 'Print count reached exact cycle capacity limit.')`,
                [stencil.stencil_rack_number, sessionUser.employee_code, sessionUser.name]
            );
        } else {
            await client.query(
                `UPDATE smt_stencil_lifecycle_states
                 SET total_lifetime_prints = $1,
                     updated_by = $2,
                     updated_by_name = $3,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $4`,
                [newLifetimePrints, sessionUser.employee_code, sessionUser.name, lifecycleState.id]
            );
        }

        // 10. Write to Audit Log
        await client.query(
            `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description, new_value)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                'CREATE',
                'STENCIL_LIFECYCLE',
                savedRecord.id,
                sessionUser.name,
                `Work Order ${workOrder.id} (${workOrderQty} prints) assigned to Stencil '${stencil.stencil_name}' (Cycle ${currentCycleNumber}). Cycle usage: ${projectedUsed}/${currentCycleCapacity}.`,
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
            'status',
            'cycle_number'
        ];
        const actualSortBy = allowedSortCols.includes(sortBy) ? sortBy : 'created_at';

        let queryParams: any[] = [];
        let filterSql = `WHERE l.is_deleted = false`;

        if (search) {
            queryParams.push(`%${search}%`);
            filterSql += ` AND (
                l.stencil_name ILIKE $1 OR
                l.stencil_id ILIKE $1 OR
                l.work_order_number ILIKE $1 OR
                l.product_name ILIKE $1 OR
                l.status ILIKE $1 OR
                loc.job_number ILIKE $1
            )`;
        }

        // Count total matching records
        const countQuery = `
            SELECT COUNT(*) 
            FROM smt_stencil_lifecycle l
            LEFT JOIN stencil_rack_locations loc ON l.stencil_record_id = loc.id
            ${filterSql}
        `;
        const countRes = await pool.query(countQuery, queryParams);
        const total = parseInt(countRes.rows[0].count, 10);

        // Fetch records
        const selectQuery = `
            SELECT l.*, loc.job_number 
            FROM smt_stencil_lifecycle l
            LEFT JOIN stencil_rack_locations loc ON l.stencil_record_id = loc.id
            ${filterSql}
            ORDER BY l.${actualSortBy} ${sortOrder}
            LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
        `;
        
        const params = [...queryParams, limit, offset];
        const recordsRes = await pool.query(selectQuery, params);

        const sanitizedRecords = recordsRes.rows.map(row => {
            const currentUsed = parseInt(row.current_used_life_cycle || row.new_used_prints, 10) || 0;
            const targetLife = parseInt(row.target_life_cycle, 10) || 60000;
            const remainingLife = targetLife - currentUsed;
            const remainingPercentage = targetLife > 0 ? (remainingLife / targetLife) * 100 : 0;
            const consumedPercentage = targetLife > 0 ? (currentUsed / targetLife) * 100 : 0;

            let healthIndicator = 'Green';
            if (consumedPercentage >= 100) {
                healthIndicator = 'Red';
            } else if (consumedPercentage >= 90) {
                healthIndicator = 'Orange';
            } else if (consumedPercentage >= 80) {
                healthIndicator = 'Yellow';
            }

            const { stencil_id, ...rest } = row;
            return {
                ...rest,
                remaining_life: remainingLife,
                remaining_percentage: parseFloat(remainingPercentage.toFixed(2)),
                health_indicator: healthIndicator
            };
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
 * Get single lifecycle record with complete details
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

        // Fetch associated Stencil location details
        const stencilRes = await pool.query(
            `SELECT * FROM stencil_rack_locations WHERE id = $1`,
            [record.stencil_record_id]
        );
        const stencilDetails = stencilRes.rows[0] || null;

        // Fetch associated Work Order details
        const woRes = await pool.query(
            `SELECT * FROM smt_work_orders WHERE id = $1`,
            [record.work_order_id]
        );
        const workOrderDetails = woRes.rows[0] || null;

        // Calculate health metrics
        const currentUsed = parseInt(record.current_used_life_cycle || record.new_used_prints, 10) || 0;
        const targetLife = parseInt(record.target_life_cycle, 10) || 60000;
        const remainingLife = targetLife - currentUsed;
        const remainingPercentage = targetLife > 0 ? (remainingLife / targetLife) * 100 : 0;
        const consumedPercentage = targetLife > 0 ? (currentUsed / targetLife) * 100 : 0;

        let healthIndicator = 'Green';
        if (consumedPercentage >= 100) {
            healthIndicator = 'Red';
        } else if (consumedPercentage >= 90) {
            healthIndicator = 'Orange';
        } else if (consumedPercentage >= 80) {
            healthIndicator = 'Yellow';
        }

        const { stencil_id: r_sid, ...cleanedRecord } = record || {};
        let cleanedStencil = null;
        if (stencilDetails) {
            const { stencil_rack_number: s_sid, ...rest } = stencilDetails;
            cleanedStencil = rest;
        }

        return res.status(200).json({
            record: {
                ...cleanedRecord,
                remaining_life: remainingLife,
                remaining_percentage: parseFloat(remainingPercentage.toFixed(2)),
                health_indicator: healthIndicator
            },
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

        // 2. Fetch and lock lifecycle state record
        const stateRes = await client.query(
            `SELECT * FROM smt_stencil_lifecycle_states WHERE LOWER(TRIM(stencil_rack_number)) = LOWER(TRIM($1)) FOR UPDATE`,
            [record.stencil_id]
        );
        const lifecycleState = stateRes.rows[0];

        // 3. Calculate print count after deletion
        const printsRes = await client.query(
            `SELECT COALESCE(SUM(qty_life_cycle), 0)::INTEGER AS print_count 
             FROM smt_stencil_lifecycle 
             WHERE LOWER(TRIM(stencil_id)) = LOWER(TRIM($1)) 
               AND is_deleted = false
               AND id <> $2
               AND created_at > COALESCE($3, '1970-01-01'::timestamp)`,
            [record.stencil_id, id, lifecycleState ? lifecycleState.last_maintenance_date : null]
        );
        const newPrintCount = printsRes.rows[0].print_count;

        // If current status is MAINTENANCE and new print count < cycle capacity, reset status back to ACTIVE
        if (lifecycleState && lifecycleState.lifecycle_status === STENCIL_LIFECYCLE_STATUS.MAINTENANCE) {
            const targetLimit = parseInt(lifecycleState.current_cycle_capacity || lifecycleState.target_life_cycle || 60000, 10);
            if (newPrintCount < targetLimit) {
                await client.query(
                    `UPDATE smt_stencil_lifecycle_states
                     SET lifecycle_status = 'ACTIVE',
                         updated_by = $1,
                         updated_by_name = $2,
                         updated_at = CURRENT_TIMESTAMP
                     WHERE id = $3`,
                    [sessionUser.employee_code, sessionUser.name, lifecycleState.id]
                );

                // Record status transition
                await client.query(
                    `INSERT INTO smt_stencil_lifecycle_status_history
                     (stencil_rack_number, previous_status, new_status, changed_by_code, changed_by_name, reason, remarks)
                     VALUES ($1, 'MAINTENANCE', 'ACTIVE', $2, $3, 'Assignment Deleted', 'Print count dropped below cycle capacity after record deletion.')`,
                    [record.stencil_id, sessionUser.employee_code, sessionUser.name]
                );
            }
        }

        // Subtract from total lifetime prints
        if (lifecycleState) {
            const currentLifetime = parseInt(lifecycleState.total_lifetime_prints, 10) || 0;
            const updatedLifetime = Math.max(0, currentLifetime - (record.qty_life_cycle || 0));
            await client.query(
                `UPDATE smt_stencil_lifecycle_states SET total_lifetime_prints = $1 WHERE id = $2`,
                [updatedLifetime, lifecycleState.id]
            );
        }

        // 4. Soft Delete lifecycle record
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

        // 5. Write to Audit Log
        await client.query(
            `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description, old_value, new_value)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                'DELETE',
                'STENCIL_LIFECYCLE',
                id,
                sessionUser.name,
                `Stencil Lifecycle Record ${id} soft deleted by Super Admin. Subtracted ${record.qty_life_cycle} prints from Stencil '${record.stencil_name}'.`,
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

/**
 * ====================================================================
 * IMMUTABLE APPEND-ONLY MAINTENANCE & SCRAP WORKFLOWS
 * ====================================================================
 */

/**
 * POST /api/smt/stencil-lifecycle/maintenance/complete
 * Complete maintenance, add new cycle capacity, reset cycle print count, increment maintenance count & cycle number
 */
export const completeMaintenance = async (req: Request, res: Response) => {
    const { stencil_rack_number, maintenance_reason, additional_life_cycle, remarks } = req.body;
    const sessionUser = getSessionUser(req);

    if (!stencil_rack_number || !maintenance_reason) {
        return res.status(400).json({ message: 'Stencil Rack Number and Maintenance Reason are required.' });
    }

    const validReasons = ['Cleaning', 'Repair', 'Inspection', 'Mesh/Aperture Cleaning', 'Other'];
    if (!validReasons.includes(maintenance_reason)) {
        return res.status(400).json({ message: 'Invalid Maintenance Reason. Allowed reasons: Cleaning, Repair, Inspection, Mesh/Aperture Cleaning, Other.' });
    }

    const additionalCapacity = parseInt(additional_life_cycle, 10);
    if (isNaN(additionalCapacity) || additionalCapacity <= 0) {
        return res.status(400).json({ message: 'Additional Life Cycle capacity is required and must be a positive integer.' });
    }

    if (!remarks || remarks.trim() === '') {
        return res.status(400).json({ message: 'Remarks are mandatory for completing maintenance.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Fetch and Lock lifecycle state
        const stateRes = await client.query(
            `SELECT * FROM smt_stencil_lifecycle_states WHERE LOWER(TRIM(stencil_rack_number)) = LOWER(TRIM($1)) FOR UPDATE`,
            [stencil_rack_number]
        );

        if (stateRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Lifecycle state record not found for the selected stencil.' });
        }

        const lifecycleState = stateRes.rows[0];

        if (lifecycleState.lifecycle_status === STENCIL_LIFECYCLE_STATUS.SCRAPPED) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Cannot perform Maintenance on a SCRAPPED stencil.' });
        }

        // 2. Compute dynamic print count before maintenance reset
        const printsRes = await client.query(
            `SELECT COALESCE(SUM(qty_life_cycle), 0)::INTEGER AS print_count 
             FROM smt_stencil_lifecycle 
             WHERE LOWER(TRIM(stencil_id)) = LOWER(TRIM($1)) 
               AND is_deleted = false
               AND created_at > COALESCE($2, '1970-01-01'::timestamp)`,
            [stencil_rack_number, lifecycleState.last_maintenance_date]
        );
        const currentPrintCount = printsRes.rows[0].print_count;
        const oldMaintenanceCount = lifecycleState.maintenance_count || 0;
        const newMaintenanceCount = oldMaintenanceCount + 1;

        const oldCycleNumber = lifecycleState.cycle_number || 1;
        const newCycleNumber = oldCycleNumber + 1;
        const previousCapacity = parseInt(lifecycleState.current_cycle_capacity || lifecycleState.target_life_cycle || 60000, 10);

        // Fetch stencil job_number for maintenance record
        const locationRes = await client.query(
            `SELECT job_number FROM stencil_rack_locations WHERE id = $1`,
            [lifecycleState.stencil_record_id]
        );
        const jobNumber = locationRes.rows[0]?.job_number || null;

        // 3. Update states table with new Cycle Number and Additional Capacity
        await client.query(
            `UPDATE smt_stencil_lifecycle_states
             SET lifecycle_status = 'ACTIVE',
                 cycle_number = $1,
                 current_cycle_capacity = $2,
                 target_life_cycle = $2,
                 maintenance_count = $3,
                 last_maintenance_date = CURRENT_TIMESTAMP,
                 last_maintenance_by_code = $4,
                 last_maintenance_by_name = $5,
                 updated_by = $4,
                 updated_by_name = $5,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $6`,
            [
                newCycleNumber,
                additionalCapacity,
                newMaintenanceCount,
                sessionUser.employee_code,
                sessionUser.name,
                lifecycleState.id
            ]
        );

        // 4. Insert Status History (Append-Only)
        await client.query(
            `INSERT INTO smt_stencil_lifecycle_status_history
             (stencil_rack_number, previous_status, new_status, changed_by_code, changed_by_name, reason, remarks)
             VALUES ($1, $2, 'ACTIVE', $3, $4, $5, $6)`,
            [
                stencil_rack_number,
                lifecycleState.lifecycle_status,
                sessionUser.employee_code,
                sessionUser.name,
                `Maintenance Completed: ${maintenance_reason}`,
                `Added +${additionalCapacity} capacity for Cycle ${newCycleNumber}. Remarks: ${remarks.trim()}`
            ]
        );

        // 5. Insert Detailed Maintenance History (Append-Only)
        await client.query(
            `INSERT INTO smt_stencil_maintenance_history
             (stencil_rack_number, job_number, maintenance_count, maintenance_cycle_number,
              previous_lifecycle_capacity, previous_print_count, previous_used_prints,
              additional_lifecycle_capacity, reset_print_count, maintenance_reason,
              lifecycle_status_before, lifecycle_status_after, performed_by_code, performed_by_name,
              performed_department, remarks, action)
             VALUES ($1, $2, $3, $4, $5, $6, $6, $7, 0, $8, $9, 'ACTIVE', $10, $11, $12, $13, 'Maintenance Completed')`,
            [
                stencil_rack_number,
                jobNumber,
                newMaintenanceCount,
                oldCycleNumber,
                previousCapacity,
                currentPrintCount,
                additionalCapacity,
                maintenance_reason,
                lifecycleState.lifecycle_status,
                sessionUser.employee_code,
                sessionUser.name,
                sessionUser.department,
                remarks.trim()
            ]
        );

        // 6. Write to central Audit Log
        await client.query(
            `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description, new_value)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                'UPDATE',
                'STENCIL_LIFECYCLE',
                lifecycleState.id,
                sessionUser.name,
                `Maintenance completed for Stencil '${stencil_rack_number}' (Reason: ${maintenance_reason}). Cycle ${newCycleNumber} started with capacity ${additionalCapacity}.`,
                JSON.stringify({
                    stencil_rack_number,
                    maintenance_reason,
                    previous_capacity: previousCapacity,
                    additional_lifecycle_capacity: additionalCapacity,
                    new_cycle_number: newCycleNumber,
                    remarks
                })
            ]
        );

        await client.query('COMMIT');
        return res.status(200).json({
            success: true,
            message: `Maintenance completed successfully for Stencil '${stencil_rack_number}'. Started Cycle ${newCycleNumber} with capacity ${additionalCapacity} prints.`
        });
    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error('Error completing maintenance:', err);
        return res.status(500).json({ message: 'Internal server error while completing maintenance.' });
    } finally {
        client.release();
    }
};

/**
 * POST /api/smt/stencil-lifecycle/maintenance/scrap
 * Permanent retirement / scrapping of a stencil
 */
export const scrapStencil = async (req: Request, res: Response) => {
    const { stencil_rack_number, scrap_reason, remarks } = req.body;
    const sessionUser = getSessionUser(req);

    if (!stencil_rack_number || !scrap_reason) {
        return res.status(400).json({ message: 'Stencil Rack Number and Scrap Reason are required.' });
    }

    const validReasons = ['Damaged', 'Warped', 'Aperture Damage', 'Excessive Wear', 'Failed Inspection', 'Other'];
    if (!validReasons.includes(scrap_reason)) {
        return res.status(400).json({ message: 'Invalid Scrap Reason. Allowed reasons: Damaged, Warped, Aperture Damage, Excessive Wear, Failed Inspection, Other.' });
    }

    if (!remarks || remarks.trim() === '') {
        return res.status(400).json({ message: 'Remarks are mandatory for scrapping.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Fetch and Lock lifecycle state
        const stateRes = await client.query(
            `SELECT * FROM smt_stencil_lifecycle_states WHERE LOWER(TRIM(stencil_rack_number)) = LOWER(TRIM($1)) FOR UPDATE`,
            [stencil_rack_number]
        );

        if (stateRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Lifecycle state record not found for the selected stencil.' });
        }

        const lifecycleState = stateRes.rows[0];

        if (lifecycleState.lifecycle_status === STENCIL_LIFECYCLE_STATUS.SCRAPPED) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'This stencil has already been scrapped.' });
        }

        // 2. Compute dynamic print count
        const printsRes = await client.query(
            `SELECT COALESCE(SUM(qty_life_cycle), 0)::INTEGER AS print_count 
             FROM smt_stencil_lifecycle 
             WHERE LOWER(TRIM(stencil_id)) = LOWER(TRIM($1)) 
               AND is_deleted = false
               AND created_at > COALESCE($2, '1970-01-01'::timestamp)`,
            [stencil_rack_number, lifecycleState.last_maintenance_date]
        );
        const currentPrintCount = printsRes.rows[0].print_count;

        // Fetch job_number
        const locationRes = await client.query(
            `SELECT job_number FROM stencil_rack_locations WHERE id = $1`,
            [lifecycleState.stencil_record_id]
        );
        const jobNumber = locationRes.rows[0]?.job_number || null;

        // 3. Update states table status to SCRAPPED
        await client.query(
            `UPDATE smt_stencil_lifecycle_states
             SET lifecycle_status = 'SCRAPPED',
                 updated_by = $1,
                 updated_by_name = $2,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $3`,
            [sessionUser.employee_code, sessionUser.name, lifecycleState.id]
        );

        // 4. Insert Status History (Append-Only)
        await client.query(
            `INSERT INTO smt_stencil_lifecycle_status_history
             (stencil_rack_number, previous_status, new_status, changed_by_code, changed_by_name, reason, remarks)
             VALUES ($1, $2, 'SCRAPPED', $3, $4, $5, $6)`,
            [
                stencil_rack_number,
                lifecycleState.lifecycle_status,
                sessionUser.employee_code,
                sessionUser.name,
                `Scrapped: ${scrap_reason}`,
                remarks.trim()
            ]
        );

        // 5. Insert Maintenance History (Append-Only)
        await client.query(
            `INSERT INTO smt_stencil_maintenance_history
             (stencil_rack_number, job_number, maintenance_count, maintenance_cycle_number,
              previous_lifecycle_capacity, previous_print_count, previous_used_prints,
              additional_lifecycle_capacity, reset_print_count, maintenance_reason,
              lifecycle_status_before, lifecycle_status_after, performed_by_code, performed_by_name,
              performed_department, remarks, action)
             VALUES ($1, $2, $3, $4, $5, $6, $6, 0, $6, $7, $8, 'SCRAPPED', $9, $10, $11, $12, 'Scrapped')`,
            [
                stencil_rack_number,
                jobNumber,
                lifecycleState.maintenance_count || 0,
                lifecycleState.cycle_number || 1,
                lifecycleState.current_cycle_capacity || 60000,
                currentPrintCount,
                `Scrapped: ${scrap_reason}`,
                lifecycleState.lifecycle_status,
                sessionUser.employee_code,
                sessionUser.name,
                sessionUser.department,
                remarks.trim()
            ]
        );

        // 6. Write to central Audit Log
        await client.query(
            `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description, new_value)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                'UPDATE',
                'STENCIL_LIFECYCLE',
                lifecycleState.id,
                sessionUser.name,
                `Stencil '${stencil_rack_number}' permanently SCRAPPED (Reason: ${scrap_reason}). Remarks: ${remarks}.`,
                JSON.stringify({
                    stencil_rack_number,
                    scrap_reason,
                    remarks
                })
            ]
        );

        await client.query('COMMIT');
        return res.status(200).json({ success: true, message: `Stencil '${stencil_rack_number}' successfully scrapped.` });
    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error('Error scrapping stencil:', err);
        return res.status(500).json({ message: 'Internal server error while scrapping stencil.' });
    } finally {
        client.release();
    }
};

/**
 * GET /api/smt/stencil-lifecycle/maintenance/history/:rackNumber
 * Get all maintenance logs for a specific stencil
 */
export const getMaintenanceHistory = async (req: Request, res: Response) => {
    const { rackNumber } = req.params;

    try {
        const query = `
            SELECT * FROM smt_stencil_maintenance_history
            WHERE LOWER(TRIM(stencil_rack_number)) = LOWER(TRIM($1))
            ORDER BY maintenance_date DESC
        `;
        const result = await pool.query(query, [rackNumber]);
        return res.status(200).json(result.rows);
    } catch (err: any) {
        logger.error('Error fetching maintenance history:', err);
        return res.status(500).json({ message: 'Internal server error while fetching maintenance history.' });
    }
};

/**
 * GET /api/smt/stencil-lifecycle/status-history/:rackNumber
 * Get all status transition history logs for a specific stencil
 */
export const getStatusHistory = async (req: Request, res: Response) => {
    const { rackNumber } = req.params;

    try {
        const query = `
            SELECT * FROM smt_stencil_lifecycle_status_history
            WHERE LOWER(TRIM(stencil_rack_number)) = LOWER(TRIM($1))
            ORDER BY changed_date DESC
        `;
        const result = await pool.query(query, [rackNumber]);
        return res.status(200).json(result.rows);
    } catch (err: any) {
        logger.error('Error fetching status history:', err);
        return res.status(500).json({ message: 'Internal server error while fetching status history.' });
    }
};
