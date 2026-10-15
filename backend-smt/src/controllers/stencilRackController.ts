import { Request, Response } from 'express';
import * as ExcelJS from 'exceljs';
import pool from '../config/db';
import { createLogger } from '../utils/logger';
import { isStencilSideCompatible } from '../utils/smtHelper';

const logger = createLogger('StencilRackController');

// Helper to extract authenticated user properties from request token
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
 * Helper to record central audit logs
 */
const recordAuditLog = async (
    client: any,
    eventType: 'CREATE' | 'UPDATE' | 'DELETE',
    entityType: 'STENCIL_RACK' | 'RACK_LOCATION' | 'STENCIL_SCAN',
    entityId: string,
    actor: string,
    description: string,
    oldValue: any = null,
    newValue: any = null
) => {
    await client.query(`
        INSERT INTO audit_log (event_type, entity_type, entity_id, actor, old_value, new_value, description)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
        eventType,
        entityType,
        entityId,
        actor,
        oldValue ? JSON.stringify(oldValue) : null,
        newValue ? JSON.stringify(newValue) : null,
        description
    ]);
};

/**
 * Helper to record unauthorized security events to audit logs
 */
const recordUnauthorizedAttempt = async (
    req: Request,
    permissionKey: string,
    action: string,
    reason: string
) => {
    const sessionUser = getSessionUser(req);
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown') as string;
    const client = await pool.connect();
    try {
        const details = `${reason} - User: ${sessionUser.name} (${sessionUser.employee_code}, Role: ${sessionUser.role}), Permission Key: ${permissionKey}, Action: ${action}, Module: Stencil Rack Management, Endpoint: ${req.originalUrl}, Method: ${req.method}, IP: ${ip}, Reason: ${reason}`;
        
        await recordAuditLog(
            client,
            req.method === 'POST' ? 'CREATE' : req.method === 'PUT' ? 'UPDATE' : 'DELETE',
            'STENCIL_RACK',
            req.params.id || 'N/A',
            sessionUser.name,
            details
        );
    } catch (auditErr: any) {
        logger.error('Error logging unauthorized attempt:', auditErr);
    } finally {
        client.release();
    }
};


/**
 * GET /api/stencil-rack/dashboard
 * Retrieves dummy stats (simplified/deprecated)
 */
export const getDashboardStats = async (req: Request, res: Response) => {
    return res.json({
        success: true,
        stats: {}
    });
};

/**
 * GET /api/stencil-rack
 * Get all racks
 */
export const getRacks = async (req: Request, res: Response) => {
    try {
        const result = await pool.query(`
            SELECT 
                r.*,
                COALESCE(SUM(CASE WHEN l.status <> 'EMPTY' THEN 1 ELSE 0 END), 0)::integer as occupied,
                COALESCE(SUM(CASE WHEN l.status = 'EMPTY' THEN 1 ELSE 0 END), 0)::integer as empty,
                COALESCE(SUM(CASE WHEN l.status = 'CHECKED_OUT' THEN 1 ELSE 0 END), 0)::integer as checked_out,
                COALESCE(SUM(CASE WHEN l.status = 'STORED' THEN 1 ELSE 0 END), 0)::integer as stored
            FROM stencil_racks r
            LEFT JOIN stencil_rack_locations l ON r.id = l.rack_id
            WHERE r.is_deleted = false
            GROUP BY r.id
            ORDER BY r.name ASC
        `);

        const racks = result.rows.map(row => {
            const capacity = row.rows * row.columns;
            const utilization = capacity > 0 ? parseFloat(((row.occupied / capacity) * 100).toFixed(2)) : 0;
            return {
                ...row,
                capacity,
                utilization
            };
        });

        return res.json({ success: true, racks });
    } catch (err: any) {
        logger.error('Error fetching racks:', err);
        return res.status(500).json({ message: 'Internal server error while fetching racks.' });
    }
};

/**
 * POST /api/stencil-rack
 * Create a new rack with automatic location matrix generation
 */
export const createRack = async (req: Request, res: Response) => {
    const { name, rows, columns, description, status } = req.body;
    const sessionUser = getSessionUser(req);

    const allowedRoles = ['Super Admin', 'Admin', 'Manager'];
    const userRole = (sessionUser.role || '').trim();
    const isAllowedRole = allowedRoles.some(r => r.toLowerCase() === userRole.toLowerCase());

    if (!isAllowedRole) {
        await recordUnauthorizedAttempt(req, 'smt_stencil_rack', 'can_create', 'Unauthorized Create Rack Attempt');
        return res.status(403).json({ message: 'Access Denied. You are not authorized to perform this operation.' });
    }

    if (!name || !rows || !columns) {
        return res.status(400).json({ message: 'Rack name, rows, and columns are required.' });
    }

    const rowCount = parseInt(rows);
    const colCount = parseInt(columns);

    if (rowCount < 1 || colCount < 1) {
        return res.status(400).json({ message: 'Rows and columns must be at least 1.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Check uniqueness
        const uniqueCheck = await client.query('SELECT id FROM stencil_racks WHERE name = $1 AND is_deleted = false', [name.trim()]);
        if (uniqueCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: `A rack named '${name.trim()}' already exists.` });
        }

        const insertRackQuery = `
            INSERT INTO stencil_racks (name, rows, columns, description, status, created_by, created_by_name)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
        `;
        const rackResult = await client.query(insertRackQuery, [
            name.trim(),
            rowCount,
            colCount,
            description ? description.trim() : null,
            status || 'ACTIVE',
            sessionUser.id,
            sessionUser.name
        ]);

        const rack = rackResult.rows[0];

        // Generate location matrix slots
        for (let r = 1; r <= rowCount; r++) {
            for (let c = 1; c <= colCount; c++) {
                const rowStr = r.toString().padStart(2, '0');
                const colStr = c.toString().padStart(2, '0');
                const locationCode = `RACK-${rack.name}-R${rowStr}-C${colStr}`;

                await client.query(`
                    INSERT INTO stencil_rack_locations (rack_id, row_number, column_number, location_code, status, created_by, created_by_name)
                    VALUES ($1, $2, $3, $4, 'EMPTY', $5, $6)
                `, [
                    rack.id,
                    r,
                    c,
                    locationCode,
                    sessionUser.id,
                    sessionUser.name
                ]);
            }
        }

        // Audit Log
        await recordAuditLog(
            client,
            'CREATE',
            'STENCIL_RACK',
            rack.id,
            sessionUser.name,
            `Created rack '${rack.name}' with layout ${rowCount}x${colCount}.`,
            null,
            rack
        );

        await client.query('COMMIT');
        return res.status(201).json({ success: true, message: 'Rack and layout slots created successfully.', rack });
    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error('Error creating rack:', err);
        return res.status(500).json({ message: 'Internal server error while creating rack.' });
    } finally {
        client.release();
    }
};

/**
 * PUT /api/stencil-rack/:id
 * Update rack configurations
 */
export const updateRack = async (req: Request, res: Response) => {
    const rackId = req.params.id;
    const { name, rows, columns, description, status } = req.body;
    const sessionUser = getSessionUser(req);

    if (sessionUser.role !== 'Super Admin') {
        await recordUnauthorizedAttempt(req, 'smt_stencil_rack', 'can_edit', 'Unauthorized Edit Rack Attempt');
        return res.status(403).json({ message: 'Access Denied. You are not authorized to perform this operation.' });
    }

    if (!name || !rows || !columns) {
        return res.status(400).json({ message: 'Rack name, rows, and columns are required.' });
    }

    const newRows = parseInt(rows);
    const newCols = parseInt(columns);

    if (newRows < 1 || newCols < 1) {
        return res.status(400).json({ message: 'Rows and columns must be at least 1.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Check if rack exists
        const rackResult = await client.query('SELECT * FROM stencil_racks WHERE id = $1 AND is_deleted = false', [rackId]);
        if (rackResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Rack not found.' });
        }
        const oldRack = rackResult.rows[0];

        // Check name uniqueness if updated
        if (name.trim() !== oldRack.name) {
            const nameCheck = await client.query('SELECT id FROM stencil_racks WHERE name = $1 AND id <> $2 AND is_deleted = false', [name.trim(), rackId]);
            if (nameCheck.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ message: `A rack named '${name.trim()}' already exists.` });
            }
        }

        // Validate capacity reduction logic
        if (newRows < oldRack.rows || newCols < oldRack.columns) {
            const totalOccupiedCheck = await client.query(`
                SELECT COUNT(id) FROM stencil_rack_locations WHERE rack_id = $1 AND status <> 'EMPTY'
            `, [rackId]);

            if (parseInt(totalOccupiedCheck.rows[0].count) > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ 
                    message: 'Cannot reduce rows or columns because the rack contains stencils.' 
                });
            }
        }

        // Update rack
        const updateRackQuery = `
            UPDATE stencil_racks
            SET name = $1, rows = $2, columns = $3, description = $4, status = $5, updated_by = $6, updated_by_name = $7, updated_at = CURRENT_TIMESTAMP
            WHERE id = $8
            RETURNING *
        `;
        const updatedRackResult = await client.query(updateRackQuery, [
            name.trim(),
            newRows,
            newCols,
            description ? description.trim() : null,
            status,
            sessionUser.id,
            sessionUser.name,
            rackId
        ]);
        const updatedRack = updatedRackResult.rows[0];

        // Manage location adjustments
        // 1. Delete slots outside new bounds
        await client.query(`
            DELETE FROM stencil_rack_locations
            WHERE rack_id = $1 AND (row_number > $2 OR column_number > $3)
        `, [rackId, newRows, newCols]);

        // 2. Insert new slots or update existing codes if name changed
        for (let r = 1; r <= newRows; r++) {
            for (let c = 1; c <= newCols; c++) {
                const rowStr = r.toString().padStart(2, '0');
                const colStr = c.toString().padStart(2, '0');
                const locationCode = `RACK-${updatedRack.name}-R${rowStr}-C${colStr}`;

                const existsQuery = await client.query(`
                    SELECT id, location_code FROM stencil_rack_locations 
                    WHERE rack_id = $1 AND row_number = $2 AND column_number = $3
                `, [rackId, r, c]);

                if (existsQuery.rows.length > 0) {
                    if (existsQuery.rows[0].location_code !== locationCode) {
                        await client.query(`
                            UPDATE stencil_rack_locations
                            SET location_code = $1, updated_by = $2, updated_by_name = $3, updated_at = CURRENT_TIMESTAMP
                            WHERE id = $4
                        `, [locationCode, sessionUser.id, sessionUser.name, existsQuery.rows[0].id]);
                    }
                } else {
                    await client.query(`
                        INSERT INTO stencil_rack_locations (rack_id, row_number, column_number, location_code, status, created_by, created_by_name)
                        VALUES ($1, $2, $3, $4, 'EMPTY', $5, $6)
                    `, [rackId, r, c, locationCode, sessionUser.id, sessionUser.name]);
                }
            }
        }

        // Audit Log
        await recordAuditLog(
            client,
            'UPDATE',
            'STENCIL_RACK',
            rackId,
            sessionUser.name,
            `Updated rack '${oldRack.name}' configurations to '${updatedRack.name}' (${newRows}x${newCols}).`,
            oldRack,
            updatedRack
        );

        await client.query('COMMIT');
        return res.json({ success: true, message: 'Rack updated successfully.', rack: updatedRack });
    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error('Error updating rack:', err);
        return res.status(500).json({ message: 'Internal server error while updating rack.' });
    } finally {
        client.release();
    }
};

/**
 * DELETE /api/stencil-rack/:id
 * Delete a rack (Soft delete)
 */
export const deleteRack = async (req: Request, res: Response) => {
    const rackId = req.params.id;
    const sessionUser = getSessionUser(req);

    if (sessionUser.role !== 'Super Admin') {
        await recordUnauthorizedAttempt(req, 'smt_stencil_rack', 'can_delete', 'Unauthorized Delete Rack Attempt');
        return res.status(403).json({ message: 'Access Denied. You are not authorized to perform this operation.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Check if rack exists
        const rackResult = await client.query('SELECT * FROM stencil_racks WHERE id = $1 AND is_deleted = false', [rackId]);
        if (rackResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Rack not found.' });
        }
        const rack = rackResult.rows[0];

        // Check if occupied
        const occupiedCheck = await client.query(`
            SELECT COUNT(id) FROM stencil_rack_locations WHERE rack_id = $1 AND status <> 'EMPTY'
        `, [rackId]);

        if (parseInt(occupiedCheck.rows[0].count) > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Cannot delete rack because it contains stencils. Relocate or clear stencils first.' });
        }

        // Soft delete rack
        await client.query(`
            UPDATE stencil_racks
            SET is_deleted = true, status = 'INACTIVE', updated_by = $1, updated_by_name = $2, updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
        `, [sessionUser.id, sessionUser.name, rackId]);

        // Clean locations
        await client.query(`
            DELETE FROM stencil_rack_locations WHERE rack_id = $1
        `, [rackId]);

        // Audit Log
        await recordAuditLog(
            client,
            'DELETE',
            'STENCIL_RACK',
            rackId,
            sessionUser.name,
            `Soft deleted rack '${rack.name}'.`,
            rack,
            { is_deleted: true, status: 'INACTIVE' }
        );

        await client.query('COMMIT');
        return res.json({ success: true, message: 'Rack deleted successfully.' });
    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error('Error deleting rack:', err);
        return res.status(500).json({ message: 'Internal server error while deleting rack.' });
    } finally {
        client.release();
    }
};

/**
 * GET /api/stencil-rack/:id/locations
 * Get all locations/matrix slots of a rack
 */
export const getRackLocations = async (req: Request, res: Response) => {
    const rackId = req.params.id;

    try {
        const result = await pool.query(`
            SELECT *
            FROM stencil_rack_locations
            WHERE rack_id = $1
            ORDER BY row_number ASC, column_number ASC
        `, [rackId]);

        return res.json({ success: true, locations: result.rows });
    } catch (err: any) {
        logger.error('Error fetching rack locations:', err);
        return res.status(500).json({ message: 'Internal server error while fetching rack locations.' });
    }
};

/**
 * POST /api/stencil-rack/locations/:locationId/assign
 * NPI assignment: Maps or updates a stencil directly in a physical rack location
 */
export const assignStencil = async (req: Request, res: Response) => {
    const locationId = req.params.locationId;
    const { stencil_rack_number, job_number, stencil_name, revision, thickness_mills, manufacturing_date, side, remarks } = req.body;
    const sessionUser = getSessionUser(req);

    if (sessionUser.role === 'Operator' || sessionUser.role === 'OPERATOR') {
        await recordUnauthorizedAttempt(req, 'smt_stencil_rack', 'can_edit', 'Unauthorized Configure Location Attempt');
        return res.status(403).json({ message: 'Access Denied. You are not authorized to perform this operation.' });
    }

    const normalizedRackNumber = (stencil_rack_number || '')
        .trim()
        .replace(/\s+/g, ' ');

    if (normalizedRackNumber === '') {
        return res.status(400).json({ message: 'Stencil Rack Number is required.' });
    }

    if (!job_number || job_number.trim() === '') {
        return res.status(400).json({ message: 'Job Number is required.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Lock the target location row
        const locationQuery = await client.query(`
            SELECT l.*, r.status as rack_status, r.name as rack_name 
            FROM stencil_rack_locations l
            JOIN stencil_racks r ON l.rack_id = r.id
            WHERE l.id = $1 FOR UPDATE
        `, [locationId]);

        if (locationQuery.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Rack location not found.' });
        }
        const location = locationQuery.rows[0];

        // 2. Validate target rack status is ACTIVE
        if (location.rack_status !== 'ACTIVE') {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: `Cannot complete operation. Rack '${location.rack_name}' is INACTIVE.` });
        }

        // 3. Block edit if stencil is currently checked out
        if (location.status === 'CHECKED_OUT') {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'This stencil is currently CHECKED_OUT. Deletion or modification of its rack location is blocked until it has been successfully returned.' });
        }

        // 4. Validate Stencil Rack Number is unique across other active slots (case-insensitive check)
        const activeRackNumCheck = await client.query(`
            SELECT location_code FROM stencil_rack_locations
            WHERE LOWER(TRIM(stencil_rack_number)) = LOWER(TRIM($1)) AND status <> 'EMPTY' AND id <> $2
        `, [normalizedRackNumber, locationId]);

        if (activeRackNumCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                message: `Stencil Rack Number '${normalizedRackNumber}' is already assigned to slot '${activeRackNumCheck.rows[0].location_code}'.` 
            });
        }

        // Validate Job Number is unique across other active slots
        const activeCheck = await client.query(`
            SELECT location_code FROM stencil_rack_locations
            WHERE LOWER(TRIM(job_number)) = LOWER(TRIM($1)) AND status <> 'EMPTY' AND id <> $2
        `, [job_number.trim(), locationId]);

        if (activeCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                message: `Job Number '${job_number.trim()}' is already assigned to slot '${activeCheck.rows[0].location_code}'.` 
            });
        }

        // Parse numerical thickness and manufacturing date
        const parsedThickness = thickness_mills ? parseFloat(thickness_mills) : null;
        if (thickness_mills && isNaN(parsedThickness as number)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Thickness must be a valid decimal number.' });
        }

        const parsedMfgDate = manufacturing_date && manufacturing_date.trim() !== '' ? manufacturing_date.trim() : null;

        const isNewAssignment = location.status === 'EMPTY';
        const actionName = isNewAssignment ? 'ASSIGNED' : 'UPDATED';

        // 5. Complete assignment/update
        await client.query(`
            UPDATE stencil_rack_locations
            SET status = 'STORED',
                stencil_rack_number = $1,
                job_number = $2,
                stencil_name = $3,
                revision = $4,
                thickness_mills = $5,
                manufacturing_date = $6,
                side = $7,
                remarks = $8,
                updated_by = $9,
                updated_by_name = $10,
                created_by = CASE WHEN status = 'EMPTY' THEN $9 ELSE created_by END,
                created_by_name = CASE WHEN status = 'EMPTY' THEN $10 ELSE created_by_name END,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $11
        `, [
            normalizedRackNumber,
            job_number.trim(),
            stencil_name ? stencil_name.trim() : null,
            revision ? revision.trim() : null,
            parsedThickness,
            parsedMfgDate,
            side || null,
            remarks ? remarks.trim() : null,
            sessionUser.id,
            sessionUser.name,
            locationId
        ]);

        // Sync stencil_record_id in smt_stencil_lifecycle_states inside the same transaction
        await client.query(`
            UPDATE smt_stencil_lifecycle_states
            SET stencil_record_id = $1,
                updated_by = $2,
                updated_by_name = $3,
                updated_at = CURRENT_TIMESTAMP
            WHERE LOWER(TRIM(stencil_rack_number)) = LOWER(TRIM($4))
        `, [locationId, sessionUser.employee_code, sessionUser.name, normalizedRackNumber]);

        // 6. Record movement history
        await client.query(`
            INSERT INTO stencil_rack_movement_history (
                stencil_rack_number, job_number, stencil_name, revision, thickness_mills, manufacturing_date, side,
                action, previous_status, current_status, employee_code, employee_name, department, role,
                rack_id, row_number, column_number, location_code, remarks
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'STORED', $10, $11, $12, $13, $14, $15, $16, $17, $18)
        `, [
            normalizedRackNumber,
            job_number.trim(),
            stencil_name ? stencil_name.trim() : null,
            revision ? revision.trim() : null,
            parsedThickness,
            parsedMfgDate,
            side || null,
            actionName,
            location.status,
            sessionUser.employee_code,
            sessionUser.name,
            sessionUser.department,
            sessionUser.role,
            location.rack_id,
            location.row_number,
            location.column_number,
            location.location_code,
            remarks ? remarks.trim() : 'Updated location record.'
        ]);

        // Audit Log
        const nowTime = new Date();
        const auditPayload = {
            stencil_rack_number: normalizedRackNumber,
            job_number: job_number.trim(),
            employee_code: sessionUser.employee_code,
            employee_name: sessionUser.name,
            action: actionName,
            date: nowTime.toISOString().split('T')[0],
            time: nowTime.toTimeString().split(' ')[0]
        };

        await recordAuditLog(
            client,
            'UPDATE',
            'RACK_LOCATION',
            locationId,
            sessionUser.name,
            `Stencil ${actionName} - Rack Number: ${normalizedRackNumber}, Job Number: ${job_number.trim()} by ${sessionUser.name} (${sessionUser.employee_code}) at ${auditPayload.date} ${auditPayload.time}`,
            location,
            auditPayload
        );

        await client.query('COMMIT');
        return res.json({ success: true, message: `Stencil detail saved successfully to ${location.location_code}.` });
    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error('Error assigning stencil:', err);
        return res.status(500).json({ message: 'Internal server error while assigning/updating stencil.' });
    } finally {
        client.release();
    }
};

/**
 * POST /api/stencil-rack/locations/:locationId/clear
 * Clears assignment of slot (NPI deletion/change guard protected)
 */
export const clearLocation = async (req: Request, res: Response) => {
    const locationId = req.params.locationId;
    const sessionUser = getSessionUser(req);

    if (sessionUser.role === 'Operator' || sessionUser.role === 'OPERATOR') {
        await recordUnauthorizedAttempt(req, 'smt_stencil_rack', 'can_edit', 'Unauthorized Configure Location Attempt');
        return res.status(403).json({ message: 'Access Denied. You are not authorized to perform this operation.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Lock location
        const locationQuery = await client.query(`
            SELECT l.*, r.status as rack_status, r.name as rack_name
            FROM stencil_rack_locations l
            JOIN stencil_racks r ON l.rack_id = r.id
            WHERE l.id = $1 FOR UPDATE
        `, [locationId]);

        if (locationQuery.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Rack location not found.' });
        }
        const location = locationQuery.rows[0];

        if (location.status === 'EMPTY') {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'This slot is already empty.' });
        }

        // Checked Out Protection
        if (location.status === 'CHECKED_OUT') {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                message: 'This stencil is currently CHECKED_OUT. Deletion or modification of its rack location is blocked until it has been successfully returned.' 
            });
        }

        // Clear assignment
        await client.query(`
            UPDATE stencil_rack_locations
            SET status = 'EMPTY',
                stencil_rack_number = null,
                job_number = null,
                stencil_name = null,
                revision = null,
                thickness_mills = null,
                manufacturing_date = null,
                side = null,
                remarks = null,
                checked_out_by_code = null,
                checked_out_by_name = null,
                checked_out_by_dept = null,
                checked_out_by_role = null,
                checked_out_at = null,
                is_blocked = false,
                blocked_reason = null,
                blocked_by_code = null,
                blocked_by_name = null,
                blocked_at = null,
                updated_by = $1,
                updated_by_name = $2,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
        `, [sessionUser.id, sessionUser.name, locationId]);

        // Record history
        await client.query(`
            INSERT INTO stencil_rack_movement_history (
                stencil_rack_number, job_number, stencil_name, revision, thickness_mills, manufacturing_date, side,
                action, previous_status, current_status, employee_code, employee_name, department, role,
                rack_id, row_number, column_number, location_code, remarks
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'UPDATED', $8, 'EMPTY', $9, $10, $11, $12, $13, $14, $15, $16, 'Location assignment cleared by NPI.')
        `, [
            location.stencil_rack_number,
            location.job_number,
            location.stencil_name,
            location.revision,
            location.thickness_mills,
            location.manufacturing_date,
            location.side,
            location.status,
            sessionUser.employee_code,
            sessionUser.name,
            sessionUser.department,
            sessionUser.role,
            location.rack_id,
            location.row_number,
            location.column_number,
            location.location_code
        ]);

        // Audit Log
        const nowTime = new Date();
        const auditPayload = {
            stencil_rack_number: location.stencil_rack_number,
            job_number: location.job_number,
            employee_code: sessionUser.employee_code,
            employee_name: sessionUser.name,
            action: 'CLEARED',
            date: nowTime.toISOString().split('T')[0],
            time: nowTime.toTimeString().split(' ')[0]
        };

        await recordAuditLog(
            client,
            'UPDATE',
            'RACK_LOCATION',
            locationId,
            sessionUser.name,
            `Stencil CLEARED - Rack Number: ${location.stencil_rack_number}, Job Number: ${location.job_number} by ${sessionUser.name} (${sessionUser.employee_code}) at ${auditPayload.date} ${auditPayload.time}`,
            location,
            auditPayload
        );

        await client.query('COMMIT');
        return res.json({ success: true, message: 'Location cleared successfully.' });
    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error('Error clearing location:', err);
        return res.status(500).json({ message: 'Internal server error while clearing location.' });
    } finally {
        client.release();
    }
};

/**
 * PATCH /api/smt/stencil-rack/locations/:locationId/block
 * Toggle or explicitly set Stencil Blocked status
 * Business rules:
 * - Blocking is permitted ONLY when physical status is 'STORED'.
 * - Blocking is NOT APPLICABLE when physical status is 'CHECKED_OUT' (Rejected with HTTP 400).
 * - Empty slots cannot be blocked.
 * - Requires 'smt_stencil_rack' 'can_edit' permission (Operators rejected with 403).
 */
export const toggleStencilBlock = async (req: Request, res: Response) => {
    const locationId = req.params.locationId;
    const { block, reason } = req.body;
    const sessionUser = getSessionUser(req);

    if (sessionUser.role === 'Operator' || sessionUser.role === 'OPERATOR') {
        await recordUnauthorizedAttempt(req, 'smt_stencil_rack', 'can_edit', 'Unauthorized Stencil Block Attempt');
        return res.status(403).json({ message: 'Access Denied. You are not authorized to perform this operation.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Lock and re-read the location row
        const locationQuery = await client.query(`
            SELECT l.*, r.status as rack_status, r.name as rack_name
            FROM stencil_rack_locations l
            JOIN stencil_racks r ON l.rack_id = r.id
            WHERE l.id = $1 FOR UPDATE
        `, [locationId]);

        if (locationQuery.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Rack location not found.' });
        }
        const location = locationQuery.rows[0];

        // 2. Reject EMPTY slots
        if (location.status === 'EMPTY') {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Cannot block or unblock an empty location slot.' });
        }

        // Determine target blocked state
        const targetBlockState = (block !== undefined) ? Boolean(block) : !location.is_blocked;

        if (targetBlockState) {
            // Target is to BLOCK the stencil
            // 3. MANDATORY BUSINESS RULE: Blocking is NOT APPLICABLE to CHECKED_OUT stencils
            if (location.status === 'CHECKED_OUT') {
                await client.query('ROLLBACK');
                return res.status(400).json({ 
                    message: 'Blocking is not applicable: this stencil is already checked out. Return it to the rack before blocking.' 
                });
            }

            // 4. Must be STORED
            if (location.status !== 'STORED') {
                await client.query('ROLLBACK');
                return res.status(400).json({ 
                    message: 'A stencil can be blocked only while it is physically stored in the rack (STORED).' 
                });
            }

            if (location.is_blocked) {
                await client.query('ROLLBACK');
                return res.status(400).json({ message: 'This stencil is already blocked.' });
            }

            const blockedReason = (reason && reason.trim()) ? reason.trim() : 'Operational block applied by supervisor.';

            const updateRes = await client.query(`
                UPDATE stencil_rack_locations
                SET is_blocked = true,
                    blocked_reason = $1,
                    blocked_by_code = $2,
                    blocked_by_name = $3,
                    blocked_at = CURRENT_TIMESTAMP,
                    updated_by = $4,
                    updated_by_name = $5,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $6
                RETURNING *
            `, [
                blockedReason,
                sessionUser.employee_code,
                sessionUser.name,
                sessionUser.id,
                sessionUser.name,
                locationId
            ]);
            const updatedLoc = updateRes.rows[0];

            // Record movement history
            await client.query(`
                INSERT INTO stencil_rack_movement_history (
                    stencil_rack_number, job_number, stencil_name, revision, thickness_mills, manufacturing_date, side,
                    action, previous_status, current_status, employee_code, employee_name, department, role,
                    rack_id, row_number, column_number, location_code, remarks,
                    work_order_id, work_order_number, work_order_side
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'BLOCKED', $8, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
            `, [
                location.stencil_rack_number,
                location.job_number,
                location.stencil_name,
                location.revision,
                location.thickness_mills,
                location.manufacturing_date,
                location.side,
                location.status,
                sessionUser.employee_code,
                sessionUser.name,
                sessionUser.department,
                sessionUser.role,
                location.rack_id,
                location.row_number,
                location.column_number,
                location.location_code,
                blockedReason,
                location.checked_out_work_order_id || null,
                location.checked_out_work_order_number || null,
                location.checked_out_work_order_side || null
            ]);

            // Central Audit Log
            await recordAuditLog(
                client,
                'UPDATE',
                'RACK_LOCATION',
                locationId,
                sessionUser.name,
                `Stencil BLOCKED - Rack Number: ${location.stencil_rack_number}, Job Number: ${location.job_number} by ${sessionUser.name} (${sessionUser.employee_code}). Reason: ${blockedReason}`,
                { is_blocked: false, status: location.status },
                { is_blocked: true, blocked_reason: blockedReason, status: location.status }
            );

            await client.query('COMMIT');
            return res.json({ 
                success: true, 
                message: `Stencil '${location.stencil_rack_number || location.job_number}' has been successfully blocked.`, 
                location: updatedLoc 
            });
        } else {
            // Target is to UNBLOCK the stencil
            if (!location.is_blocked) {
                await client.query('ROLLBACK');
                return res.status(400).json({ message: 'This stencil is already unblocked.' });
            }

            const updateRes = await client.query(`
                UPDATE stencil_rack_locations
                SET is_blocked = false,
                    blocked_reason = null,
                    blocked_by_code = null,
                    blocked_by_name = null,
                    blocked_at = null,
                    updated_by = $1,
                    updated_by_name = $2,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $3
                RETURNING *
            `, [
                sessionUser.id,
                sessionUser.name,
                locationId
            ]);
            const updatedLoc = updateRes.rows[0];

            // Record movement history
            await client.query(`
                INSERT INTO stencil_rack_movement_history (
                    stencil_rack_number, job_number, stencil_name, revision, thickness_mills, manufacturing_date, side,
                    action, previous_status, current_status, employee_code, employee_name, department, role,
                    rack_id, row_number, column_number, location_code, remarks,
                    work_order_id, work_order_number, work_order_side
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'UNBLOCKED', $8, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
            `, [
                location.stencil_rack_number,
                location.job_number,
                location.stencil_name,
                location.revision,
                location.thickness_mills,
                location.manufacturing_date,
                location.side,
                location.status,
                sessionUser.employee_code,
                sessionUser.name,
                sessionUser.department,
                sessionUser.role,
                location.rack_id,
                location.row_number,
                location.column_number,
                location.location_code,
                (reason && reason.trim()) ? reason.trim() : 'Stencil unblocked by supervisor.',
                location.checked_out_work_order_id || null,
                location.checked_out_work_order_number || null,
                location.checked_out_work_order_side || null
            ]);

            // Central Audit Log
            await recordAuditLog(
                client,
                'UPDATE',
                'RACK_LOCATION',
                locationId,
                sessionUser.name,
                `Stencil UNBLOCKED - Rack Number: ${location.stencil_rack_number}, Job Number: ${location.job_number} by ${sessionUser.name} (${sessionUser.employee_code})`,
                { is_blocked: true, blocked_reason: location.blocked_reason, status: location.status },
                { is_blocked: false, status: location.status }
            );

            await client.query('COMMIT');
            return res.json({ 
                success: true, 
                message: `Stencil '${location.stencil_rack_number || location.job_number}' has been unblocked.`, 
                location: updatedLoc 
            });
        }
    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error('Error in toggleStencilBlock:', err);
        return res.status(500).json({ message: 'Internal server error while updating stencil block status.' });
    } finally {
        client.release();
    }
};

/**
 * GET /api/stencil-rack/stencil-info/:jobNumber
 * Operator scanner query: gets details, location, active holder, timeline by Rack Number, Job Number, or Stencil / Model Name
 */
export const getStencilInfoByJob = async (req: Request, res: Response) => {
    const rawParam = req.params.jobNumber || (req.query.q as string) || '';
    const queryTerm = (rawParam || '').trim();

    if (!queryTerm) {
        return res.status(400).json({ success: false, message: 'Search term is required.' });
    }

    try {
        const result = await pool.query(`
            SELECT l.*, r.name as rack_name, r.status as rack_status
            FROM stencil_rack_locations l
            JOIN stencil_racks r ON l.rack_id = r.id
            WHERE (
                UPPER(TRIM(COALESCE(l.stencil_rack_number, ''))) = UPPER(TRIM($1))
                OR UPPER(TRIM(COALESCE(l.job_number, ''))) = UPPER(TRIM($1))
                OR UPPER(TRIM(COALESCE(l.stencil_name, ''))) = UPPER(TRIM($1))
                OR l.stencil_name ILIKE '%' || $1 || '%'
            ) AND l.status <> 'EMPTY'
            ORDER BY 
                CASE 
                    WHEN UPPER(TRIM(COALESCE(l.stencil_rack_number, ''))) = UPPER(TRIM($1)) THEN 1
                    WHEN UPPER(TRIM(COALESCE(l.job_number, ''))) = UPPER(TRIM($1)) THEN 2
                    WHEN UPPER(TRIM(COALESCE(l.stencil_name, ''))) = UPPER(TRIM($1)) THEN 3
                    ELSE 4
                END,
                l.id ASC
            LIMIT 1
        `, [queryTerm]);

        if (result.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: `No matching stencil record found for '${queryTerm}'.` 
            });
        }
        const stencil = result.rows[0];

        // Get timeline movement history: search by original job number/stencil rack number or current job number/stencil rack number
        const historyQuery = await pool.query(`
            SELECT 
                h.*,
                r_from.name as from_rack_name,
                r_to.name as to_rack_name
            FROM stencil_rack_movement_history h
            LEFT JOIN stencil_racks r_from ON h.from_rack_id = r_from.id
            LEFT JOIN stencil_racks r_to ON h.to_rack_id = r_to.id
            WHERE h.job_number = $1 OR h.stencil_rack_number = $1 OR h.job_number = $2 OR h.stencil_rack_number = $2
            ORDER BY h.created_at DESC
        `, [queryTerm, stencil.job_number]);

        // Calculate elapsed checkout duration if checked out
        let elapsedTime = null;
        if (stencil.status === 'CHECKED_OUT' && stencil.checked_out_at) {
            const diffMs = Date.now() - new Date(stencil.checked_out_at).getTime();
            const diffHours = Math.floor(diffMs / 3600000);
            const diffMins = Math.floor((diffMs % 3600000) / 60000);
            elapsedTime = `${diffHours}h ${diffMins}m`;
        }

        return res.json({
            success: true,
            stencil: {
                stencil_rack_number: stencil.stencil_rack_number,
                job_number: stencil.job_number,
                stencil_name: stencil.stencil_name,
                revision: stencil.revision,
                thickness_mills: stencil.thickness_mills,
                manufacturing_date: stencil.manufacturing_date,
                side: stencil.side,
                location_id: stencil.id,
                location_code: stencil.location_code,
                rack_id: stencil.rack_id,
                rack_name: stencil.rack_name,
                rack_status: stencil.rack_status,
                row_number: stencil.row_number,
                column_number: stencil.column_number,
                location_status: stencil.status,
                is_blocked: stencil.is_blocked || false,
                blocked_reason: stencil.blocked_reason || null,
                blocked_by_code: stencil.blocked_by_code || null,
                blocked_by_name: stencil.blocked_by_name || null,
                blocked_at: stencil.blocked_at || null,
                remarks: stencil.remarks,
                holder: stencil.status === 'CHECKED_OUT' ? {
                    employee_code: stencil.checked_out_by_code,
                    employee_name: stencil.checked_out_by_name,
                    department: stencil.checked_out_by_dept,
                    role: stencil.checked_out_by_role,
                    received_at: stencil.checked_out_at,
                    elapsed_time: elapsedTime,
                    work_order_id: stencil.checked_out_work_order_id,
                    work_order_number: stencil.checked_out_work_order_number || stencil.checked_out_work_order_id,
                    work_order_side: stencil.checked_out_work_order_side,
                    machine: stencil.checked_out_machine,
                    production_line: stencil.checked_out_line,
                    remarks: stencil.checked_out_remarks
                } : null
            },
            history: historyQuery.rows
        });
    } catch (err: any) {
        logger.error('Error fetching stencil info by search query:', err);
        return res.status(500).json({ success: false, message: 'Internal server error while retrieving stencil details.' });
    }
};

/**
 * POST /api/stencil-rack/scan/receive
 * Operator Receive transaction (Check out to user)
 */
export const scanReceive = async (req: Request, res: Response) => {
    const { job_number, work_order_id, work_order_number, machine, production_line, remarks } = req.body;
    const sessionUser = getSessionUser(req);

    if (!job_number) {
        return res.status(400).json({ message: 'Job Number or Stencil Rack Number is required.' });
    }

    const targetWoRef = (work_order_id || work_order_number || '').trim();
    if (!targetWoRef) {
        return res.status(400).json({ message: 'Please select a valid Work Order before checking out the stencil.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Fetch and Lock active location slot
        const locationQuery = await client.query(`
            SELECT l.*, r.status as rack_status, r.name as rack_name
            FROM stencil_rack_locations l
            JOIN stencil_racks r ON l.rack_id = r.id
            WHERE (l.job_number = $1 OR l.stencil_rack_number = $1) AND l.status <> 'EMPTY' FOR UPDATE
        `, [job_number.trim()]);

        if (locationQuery.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'This stencil is not assigned to any physical rack location.' });
        }
        const location = locationQuery.rows[0];

        // 2. Verify target rack is active
        if (location.rack_status !== 'ACTIVE') {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: `Action blocked. Rack '${location.rack_name}' is currently INACTIVE.` });
        }

        // 2b. Verify stencil is not BLOCKED
        if (location.is_blocked) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                message: 'Checkout not allowed: this stencil is BLOCKED. Unblock it before checkout.' 
            });
        }

        // 3. Verify stencil is stored and available to receive
        if (location.status !== 'STORED') {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Receive is allowed only when status is STORED.' });
        }

        // 4. Verify Work Order exists in smt_work_orders
        const woCheck = await client.query(`
            SELECT id, id as work_order_number, product_name, sides, quantity 
            FROM smt_work_orders 
            WHERE id = $1
        `, [targetWoRef]);

        if (woCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: `Work Order '${targetWoRef}' was not found. Please select a valid Work Order.` });
        }
        const validWO = woCheck.rows[0];
        const validWoId = validWO.id;
        const validWoNumber = validWO.work_order_number || validWO.id;

        // 4b. MANDATORY VALIDATION: Work Order Side vs Stencil Side Compatibility Matrix Validation
        const rawWoSide = validWO.sides || '';
        const rawStencilSide = location.side || '';

        if (!isStencilSideCompatible(rawWoSide, rawStencilSide)) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                message: `Work Order side is not compatible with the stencil side. Work Order: ${rawWoSide || 'N/A'}, Stencil: ${rawStencilSide || 'N/A'}.`
            });
        }

        // 4c. MANDATORY VALIDATION: Strategy & Sequence Validation for TOP/BOTTOM Work Orders
        const woSidesNorm = rawWoSide.trim().toLowerCase();
        const stencilSideNorm = rawStencilSide.trim().toLowerCase();

        if (woSidesNorm.includes('/') || woSidesNorm === 'top / bottom' || woSidesNorm === 'top/bottom') {
            const existingLcRes = await client.query(
                `SELECT sides FROM smt_stencil_lifecycle WHERE work_order_id = $1 AND is_deleted = false`,
                [validWoId]
            );
            const existingRecords = existingLcRes.rows;

            const hasCombinedExisting = existingRecords.some(r => {
                const s = (r.sides || '').trim().toLowerCase();
                return (s.includes('top') && s.includes('bottom')) || s.includes('/');
            });

            if (hasCombinedExisting) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    message: 'This Work Order has already been assigned a combined TOP/BOTTOM stencil. Additional stencil checkouts are not permitted.'
                });
            }

            const hasTopExisting = existingRecords.some(r => (r.sides || '').trim().toLowerCase() === 'top');
            const hasBottomExisting = existingRecords.some(r => (r.sides || '').trim().toLowerCase() === 'bottom');

            if (hasTopExisting && hasBottomExisting) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    message: 'This Work Order has already completed stencil assignments for both TOP and BOTTOM sides.'
                });
            }

            if (stencilSideNorm.includes('top') && stencilSideNorm.includes('bottom')) {
                if (hasTopExisting || hasBottomExisting) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        message: 'Separate stencil(s) have already been assigned to this Work Order. You cannot check out a combined TOP/BOTTOM stencil.'
                    });
                }
            } else if (stencilSideNorm.includes('bottom')) {
                if (hasBottomExisting) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        message: 'A separate BOTTOM stencil has already been checked out/registered for this Work Order.'
                    });
                }
            } else if (stencilSideNorm.includes('top')) {
                if (!hasBottomExisting) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        message: 'Please register the BOTTOM stencil first for this TOP/BOTTOM Work Order.'
                    });
                }
                if (hasTopExisting) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        message: 'A separate TOP stencil has already been checked out/registered for this Work Order.'
                    });
                }
            }
        }

        const now = new Date();
        // 5. Perform Receive & Save Work Order details
        await client.query(`
            UPDATE stencil_rack_locations
            SET status = 'CHECKED_OUT',
                checked_out_by_code = $1,
                checked_out_by_name = $2,
                checked_out_by_dept = $3,
                checked_out_by_role = $4,
                checked_out_at = $5,
                checked_out_work_order_id = $6,
                checked_out_work_order_number = $7,
                checked_out_work_order_side = $8,
                checked_out_machine = $9,
                checked_out_line = $10,
                checked_out_remarks = $11,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $12
        `, [
            sessionUser.employee_code,
            sessionUser.name,
            sessionUser.department,
            sessionUser.role,
            now,
            validWoId,
            validWoNumber,
            rawWoSide,
            machine ? machine.trim() : null,
            production_line ? production_line.trim() : null,
            remarks ? remarks.trim() : null,
            location.id
        ]);

        // 6. Log movement history
        await client.query(`
            INSERT INTO stencil_rack_movement_history (
                stencil_rack_number, job_number, stencil_name, revision, thickness_mills, manufacturing_date, side,
                action, previous_status, current_status, employee_code, employee_name, department, role,
                machine, production_line, rack_id, row_number, column_number, location_code, remarks,
                work_order_id, work_order_number, work_order_side
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'STORED', 'CHECKED_OUT', $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
        `, [
            location.stencil_rack_number,
            location.job_number,
            location.stencil_name,
            location.revision,
            location.thickness_mills,
            location.manufacturing_date,
            location.side,
            'RECEIVED',
            sessionUser.employee_code,
            sessionUser.name,
            sessionUser.department,
            sessionUser.role,
            machine ? machine.trim() : null,
            production_line ? production_line.trim() : null,
            location.rack_id,
            location.row_number,
            location.column_number,
            location.location_code,
            remarks ? remarks.trim() : 'Checked out to production.',
            validWoId,
            validWoNumber,
            rawWoSide
        ]);

        // Audit Log
        const nowTime = new Date();
        const auditPayload = {
            stencil_rack_number: location.stencil_rack_number,
            job_number: location.job_number,
            stencil_side: rawStencilSide,
            work_order_id: validWoId,
            work_order_number: validWoNumber,
            work_order_side: rawWoSide,
            employee_code: sessionUser.employee_code,
            employee_name: sessionUser.name,
            target_smt_machine: machine ? machine.trim() : null,
            target_production_line: production_line ? production_line.trim() : null,
            action: 'RECEIVED',
            date: nowTime.toISOString().split('T')[0],
            time: nowTime.toTimeString().split(' ')[0],
            remarks: remarks ? remarks.trim() : null
        };

        await recordAuditLog(
            client,
            'UPDATE',
            'STENCIL_SCAN',
            location.id,
            sessionUser.name,
            `Stencil RECEIVED - Rack Number: ${location.stencil_rack_number} (Side: ${rawStencilSide || 'N/A'}), Work Order: ${validWoNumber} (Side: ${rawWoSide || 'N/A'}) by ${sessionUser.name} (${sessionUser.employee_code}) at ${auditPayload.date} ${auditPayload.time}`,
            null,
            auditPayload
        );

        await client.query('COMMIT');
        return res.json({ success: true, message: 'Stencil received/checked out successfully.' });
    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error('Error during scan receive:', err);
        return res.status(500).json({ message: 'Internal server error during receive transaction.' });
    } finally {
        client.release();
    }
};

/**
 * POST /api/stencil-rack/scan/return
 * Operator Return transaction (Returns stencil back to rack)
 */
export const scanReturn = async (req: Request, res: Response) => {
    const { job_number, target_location_id, condition, remarks, reason } = req.body;
    const sessionUser = getSessionUser(req);

    if (!job_number) {
        return res.status(400).json({ message: 'Job Number or Stencil Rack Number is required.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Lock current location slot
        const currentLocQuery = await client.query(`
            SELECT l.*, r.status as rack_status, r.name as rack_name
            FROM stencil_rack_locations l
            JOIN stencil_racks r ON l.rack_id = r.id
            WHERE (l.job_number = $1 OR l.stencil_rack_number = $1) AND l.status = 'CHECKED_OUT' FOR UPDATE
        `, [job_number.trim()]);

        if (currentLocQuery.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'This stencil is not currently checked out or location is invalid.' });
        }
        const currentLoc = currentLocQuery.rows[0];

        // 2. Verify current rack is active
        if (currentLoc.rack_status !== 'ACTIVE') {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: `Action blocked. Original rack '${currentLoc.rack_name}' is currently INACTIVE.` });
        }

        // Determine destination location
        let destLoc = currentLoc;
        const isChangingLocation = target_location_id && target_location_id !== currentLoc.id;

        if (isChangingLocation) {
            // Lock new target slot
            const newLocQuery = await client.query(`
                SELECT l.*, r.status as rack_status, r.name as rack_name
                FROM stencil_rack_locations l
                JOIN stencil_racks r ON l.rack_id = r.id
                WHERE l.id = $1 FOR UPDATE
            `, [target_location_id]);

            if (newLocQuery.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ message: 'Selected return location slot not found.' });
            }
            destLoc = newLocQuery.rows[0];

            // Verify new rack is active
            if (destLoc.rack_status !== 'ACTIVE') {
                await client.query('ROLLBACK');
                return res.status(400).json({ message: `Action blocked. Destination rack '${destLoc.rack_name}' is currently INACTIVE.` });
            }

            // Verify new slot is empty
            if (destLoc.status !== 'EMPTY') {
                await client.query('ROLLBACK');
                return res.status(400).json({ message: 'The selected destination return slot is already occupied.' });
            }

            // Clear original slot
            await client.query(`
                UPDATE stencil_rack_locations
                SET status = 'EMPTY',
                    stencil_rack_number = null,
                    job_number = null,
                    stencil_name = null,
                    revision = null,
                    thickness_mills = null,
                    manufacturing_date = null,
                    side = null,
                    remarks = null,
                    checked_out_by_code = null,
                    checked_out_by_name = null,
                    checked_out_by_dept = null,
                    checked_out_by_role = null,
                    checked_out_at = null,
                    checked_out_work_order_id = null,
                    checked_out_work_order_number = null,
                    checked_out_work_order_side = null,
                    checked_out_machine = null,
                    checked_out_line = null,
                    checked_out_remarks = null,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $1
            `, [currentLoc.id]);
        }

        // 3. Update destination location slot
        await client.query(`
            UPDATE stencil_rack_locations
            SET status = 'STORED',
                stencil_rack_number = $1,
                job_number = $2,
                stencil_name = $3,
                revision = $4,
                thickness_mills = $5,
                manufacturing_date = $6,
                side = $7,
                remarks = $8,
                checked_out_by_code = null,
                checked_out_by_name = null,
                checked_out_by_dept = null,
                checked_out_by_role = null,
                checked_out_at = null,
                checked_out_work_order_id = null,
                checked_out_work_order_number = null,
                checked_out_work_order_side = null,
                checked_out_machine = null,
                checked_out_line = null,
                checked_out_remarks = null,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $9
        `, [
            currentLoc.stencil_rack_number,
            currentLoc.job_number,
            currentLoc.stencil_name,
            currentLoc.revision,
            currentLoc.thickness_mills,
            currentLoc.manufacturing_date,
            currentLoc.side,
            remarks ? remarks.trim() : null,
            destLoc.id
        ]);

        // 4. Record movement history
        await client.query(`
            INSERT INTO stencil_rack_movement_history (
                stencil_rack_number, job_number, stencil_name, revision, thickness_mills, manufacturing_date, side,
                action, previous_status, current_status, employee_code, employee_name, department, role,
                rack_id, row_number, column_number, location_code,
                from_rack_id, from_row, from_col, to_rack_id, to_row, to_col,
                remarks, reason, condition
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'RETURNED', 'CHECKED_OUT', 'STORED', $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
        `, [
            currentLoc.stencil_rack_number,
            currentLoc.job_number,
            currentLoc.stencil_name,
            currentLoc.revision,
            currentLoc.thickness_mills,
            currentLoc.manufacturing_date,
            currentLoc.side,
            sessionUser.employee_code,
            sessionUser.name,
            sessionUser.department,
            sessionUser.role,
            destLoc.rack_id,
            destLoc.row_number,
            destLoc.column_number,
            destLoc.location_code,
            currentLoc.rack_id,
            currentLoc.row_number,
            currentLoc.column_number,
            destLoc.rack_id,
            destLoc.row_number,
            destLoc.column_number,
            remarks ? remarks.trim() : 'Returned to rack.',
            reason ? reason.trim() : null,
            condition || 'Normal'
        ]);

        // Audit Log
        const nowTime = new Date();
        const auditPayload = {
            stencil_rack_number: currentLoc.stencil_rack_number,
            job_number: currentLoc.job_number,
            employee_code: sessionUser.employee_code,
            employee_name: sessionUser.name,
            action: 'RETURNED',
            date: nowTime.toISOString().split('T')[0],
            time: nowTime.toTimeString().split(' ')[0]
        };

        await recordAuditLog(
            client,
            'UPDATE',
            'STENCIL_SCAN',
            destLoc.id,
            sessionUser.name,
            `Stencil RETURNED - Rack Number: ${currentLoc.stencil_rack_number}, Job Number: ${currentLoc.job_number} by ${sessionUser.name} (${sessionUser.employee_code}) at ${auditPayload.date} ${auditPayload.time}`,
            null,
            auditPayload
        );

        await client.query('COMMIT');
        return res.json({ success: true, message: `Stencil returned successfully to slot '${destLoc.location_code}'.` });
    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error('Error during scan return:', err);
        return res.status(500).json({ message: 'Internal server error during return transaction.' });
    } finally {
        client.release();
    }
};

/**
 * POST /api/stencil-rack/locations/:locationId/relocate
 * Direct Relocation: Move a stencil from one slot to another empty slot
 */
export const relocateStencil = async (req: Request, res: Response) => {
    const fromLocationId = req.params.locationId;
    const { target_location_id, remarks, reason } = req.body;
    const sessionUser = getSessionUser(req);

    if (sessionUser.role === 'Operator' || sessionUser.role === 'OPERATOR') {
        await recordUnauthorizedAttempt(req, 'smt_stencil_rack', 'can_edit', 'Unauthorized Configure Location Attempt');
        return res.status(403).json({ message: 'Access Denied. You are not authorized to perform this operation.' });
    }

    if (!target_location_id) {
        return res.status(400).json({ message: 'Target location slot ID is required.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Lock original location
        const fromLocQuery = await client.query(`
            SELECT l.*, r.status as rack_status, r.name as rack_name
            FROM stencil_rack_locations l
            JOIN stencil_racks r ON l.rack_id = r.id
            WHERE l.id = $1 FOR UPDATE
        `, [fromLocationId]);

        if (fromLocQuery.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Source location slot not found.' });
        }
        const fromLoc = fromLocQuery.rows[0];

        if (fromLoc.status === 'EMPTY' || !fromLoc.job_number) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Source slot is empty. Cannot relocate.' });
        }

        // checked out check
        if (fromLoc.status === 'CHECKED_OUT') {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Cannot relocate stencil. It is currently checked out.' });
        }

        // Check active assignment using client inside the transaction
        const activeAssignment = await client.query(`
            SELECT id FROM smt_stencil_lifecycle
            WHERE LOWER(TRIM(stencil_id)) = LOWER(TRIM($1))
              AND status IN ('Running', 'Available')
              AND is_deleted = false
        `, [fromLoc.stencil_rack_number]);

        if (activeAssignment.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'This stencil is currently assigned to an active Lifecycle and cannot be relocated.' });
        }

        // Verify source rack is active
        if (fromLoc.rack_status !== 'ACTIVE') {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: `Action blocked. Source rack '${fromLoc.rack_name}' is currently INACTIVE.` });
        }

        // 2. Lock destination location
        const toLocQuery = await client.query(`
            SELECT l.*, r.status as rack_status, r.name as rack_name
            FROM stencil_rack_locations l
            JOIN stencil_racks r ON l.rack_id = r.id
            WHERE l.id = $1 FOR UPDATE
        `, [target_location_id]);

        if (toLocQuery.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Target location slot not found.' });
        }
        const toLoc = toLocQuery.rows[0];

        // Verify target rack is active
        if (toLoc.rack_status !== 'ACTIVE') {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: `Action blocked. Destination rack '${toLoc.rack_name}' is currently INACTIVE.` });
        }

        // Verify destination is empty
        if (toLoc.status !== 'EMPTY') {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Target location slot is already occupied.' });
        }

        // 3. Clear original slot
        await client.query(`
            UPDATE stencil_rack_locations
            SET status = 'EMPTY',
                stencil_rack_number = null,
                job_number = null,
                stencil_name = null,
                revision = null,
                thickness_mills = null,
                manufacturing_date = null,
                side = null,
                remarks = null,
                is_blocked = false,
                blocked_reason = null,
                blocked_by_code = null,
                blocked_by_name = null,
                blocked_at = null,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
        `, [fromLoc.id]);

        // 4. Fill destination slot
        await client.query(`
            UPDATE stencil_rack_locations
            SET status = 'STORED',
                stencil_rack_number = $1,
                job_number = $2,
                stencil_name = $3,
                revision = $4,
                thickness_mills = $5,
                manufacturing_date = $6,
                side = $7,
                remarks = $8,
                is_blocked = $9,
                blocked_reason = $10,
                blocked_by_code = $11,
                blocked_by_name = $12,
                blocked_at = $13,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $14
        `, [
            fromLoc.stencil_rack_number,
            fromLoc.job_number,
            fromLoc.stencil_name,
            fromLoc.revision,
            fromLoc.thickness_mills,
            fromLoc.manufacturing_date,
            fromLoc.side,
            fromLoc.remarks,
            fromLoc.is_blocked || false,
            fromLoc.blocked_reason || null,
            fromLoc.blocked_by_code || null,
            fromLoc.blocked_by_name || null,
            fromLoc.blocked_at || null,
            toLoc.id
        ]);

        // Sync stencil_record_id in smt_stencil_lifecycle_states inside the same transaction
        await client.query(`
            UPDATE smt_stencil_lifecycle_states
            SET stencil_record_id = $1,
                updated_by = $2,
                updated_by_name = $3,
                updated_at = CURRENT_TIMESTAMP
            WHERE LOWER(TRIM(stencil_rack_number)) = LOWER(TRIM($4))
        `, [toLoc.id, sessionUser.employee_code, sessionUser.name, fromLoc.stencil_rack_number]);

        // 5. Record movement history
        await client.query(`
            INSERT INTO stencil_rack_movement_history (
                stencil_rack_number, job_number, stencil_name, revision, thickness_mills, manufacturing_date, side,
                action, previous_status, current_status, employee_code, employee_name, department, role,
                rack_id, row_number, column_number, location_code,
                from_rack_id, from_row, from_col, to_rack_id, to_row, to_col,
                remarks, reason
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'RELOCATED', 'STORED', 'STORED', $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
        `, [
            fromLoc.stencil_rack_number,
            fromLoc.job_number,
            fromLoc.stencil_name,
            fromLoc.revision,
            fromLoc.thickness_mills,
            fromLoc.manufacturing_date,
            fromLoc.side,
            sessionUser.employee_code,
            sessionUser.name,
            sessionUser.department,
            sessionUser.role,
            toLoc.rack_id,
            toLoc.row_number,
            toLoc.column_number,
            toLoc.location_code,
            fromLoc.rack_id,
            fromLoc.row_number,
            fromLoc.column_number,
            toLoc.rack_id,
            toLoc.row_number,
            toLoc.column_number,
            remarks ? remarks.trim() : 'Relocated within rack system.',
            reason ? reason.trim() : null
        ]);

        // Audit Log
        const nowTime = new Date();
        const auditPayload = {
            stencil_rack_number: fromLoc.stencil_rack_number,
            job_number: fromLoc.job_number,
            employee_code: sessionUser.employee_code,
            employee_name: sessionUser.name,
            action: 'RELOCATED',
            date: nowTime.toISOString().split('T')[0],
            time: nowTime.toTimeString().split(' ')[0]
        };

        await recordAuditLog(
            client,
            'UPDATE',
            'RACK_LOCATION',
            toLoc.id,
            sessionUser.name,
            `Stencil RELOCATED - Rack Number: ${fromLoc.stencil_rack_number}, Job Number: ${fromLoc.job_number} by ${sessionUser.name} (${sessionUser.employee_code}) at ${auditPayload.date} ${auditPayload.time}`,
            null,
            auditPayload
        );

        await client.query('COMMIT');
        return res.json({ success: true, message: `Stencil relocated successfully to '${toLoc.location_code}'.` });
    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error('Error during relocation:', err);
        return res.status(500).json({ message: 'Internal server error during relocation transaction.' });
    } finally {
        client.release();
    }
};

/**
 * GET /api/stencil-rack/history/:jobNumber
 * Get read-only movement history for a stencil
 */
export const getMovementHistory = async (req: Request, res: Response) => {
    const jobNumber = req.params.jobNumber;

    try {
        const result = await pool.query(`
            SELECT 
                h.*,
                r_from.name as from_rack_name,
                r_to.name as to_rack_name
            FROM stencil_rack_movement_history h
            LEFT JOIN stencil_racks r_from ON h.from_rack_id = r_from.id
            LEFT JOIN stencil_racks r_to ON h.to_rack_id = r_to.id
            WHERE h.job_number = $1 OR h.stencil_rack_number = $1
            ORDER BY h.created_at DESC
        `, [jobNumber.trim()]);

        return res.json({ success: true, history: result.rows });
    } catch (err: any) {
        logger.error('Error fetching movement history:', err);
        return res.status(500).json({ message: 'Internal server error while fetching history.' });
    }
};

/**
 * GET /api/stencil-rack/reports/export
 * Tabular report export
 */
export const exportRackReport = async (req: Request, res: Response) => {
    try {
        const queryResult = await pool.query(`
            SELECT 
                l.location_code,
                r.name as rack_name,
                l.row_number,
                l.column_number,
                l.status as slot_status,
                l.stencil_rack_number,
                l.job_number,
                l.stencil_name,
                l.revision,
                l.thickness_mills,
                l.side,
                l.checked_out_by_code,
                l.checked_out_by_name,
                l.checked_out_at,
                l.is_blocked,
                l.blocked_reason,
                l.blocked_by_name,
                l.blocked_at,
                l.remarks
            FROM stencil_rack_locations l
            JOIN stencil_racks r ON l.rack_id = r.id
            WHERE r.is_deleted = false
            ORDER BY r.name ASC, l.row_number ASC, l.column_number ASC
        `);

        return res.json({ success: true, data: queryResult.rows });
    } catch (err: any) {
        logger.error('Error exporting report data:', err);
        return res.status(500).json({ message: 'Internal server error during report generation.' });
    }
};

/**
 * GET /api/stencil-rack/:id/export/excel
 * Export Excel report for an individual rack
 */
export const exportSingleRackExcel = async (req: Request, res: Response) => {
    const rackId = req.params.id;

    try {
        const rackResult = await pool.query(
            'SELECT * FROM stencil_racks WHERE id = $1 AND is_deleted = false',
            [rackId]
        );

        if (rackResult.rows.length === 0) {
            return res.status(404).json({ message: 'Rack not found.' });
        }

        const rack = rackResult.rows[0];

        const locResult = await pool.query(
            `SELECT * FROM stencil_rack_locations 
             WHERE rack_id = $1 
             ORDER BY row_number ASC, column_number ASC`,
            [rackId]
        );

        const locations = locResult.rows;
        const totalCapacity = Number(rack.rows) * Number(rack.columns);
        const occupiedCount = locations.filter((l: any) => l.status && l.status !== 'EMPTY').length;
        const emptyCount = totalCapacity - occupiedCount;
        const utilizationRate = totalCapacity > 0 ? ((occupiedCount / totalCapacity) * 100).toFixed(1) : '0.0';

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'SFCS Stencil Management';
        workbook.created = new Date();

        const sheet = workbook.addWorksheet(`${rack.name}`.substring(0, 31));

        // Styling definitions
        const headerNavyFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
        const subHeaderBlueFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
        const lightGrayFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
        const thinBorder: Partial<ExcelJS.Borders> = {
            top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        };

        // 1. Title Banner
        sheet.mergeCells('A1:L1');
        const titleCell = sheet.getCell('A1');
        titleCell.value = `STENCIL RACK CONFIGURATION & INVENTORY REPORT — ${rack.name.toUpperCase()}`;
        titleCell.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
        titleCell.fill = headerNavyFill;
        titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
        sheet.getRow(1).height = 32;

        // 2. RACK CONFIGURATION & SUMMARY
        sheet.mergeCells('A3:D3');
        const summaryHeader = sheet.getCell('A3');
        summaryHeader.value = 'RACK CONFIGURATION & SUMMARY';
        summaryHeader.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
        summaryHeader.fill = subHeaderBlueFill;
        summaryHeader.alignment = { vertical: 'middle', horizontal: 'left' };
        sheet.getRow(3).height = 24;

        const summaryData = [
            ['Rack Name', rack.name, 'Status', rack.status],
            ['Rows × Columns', `${rack.rows} × ${rack.columns}`, 'Total Capacity', totalCapacity],
            ['Occupied Slots', occupiedCount, 'Empty Slots', emptyCount],
            ['Utilization Rate', `${utilizationRate}%`, 'Description', rack.description || 'No description provided.'],
            ['Created By', rack.created_by_name || rack.created_by || 'N/A', 'Created Date & Time', rack.created_at ? new Date(rack.created_at).toLocaleString() : 'N/A'],
            ['Last Updated Date & Time', rack.updated_at ? new Date(rack.updated_at).toLocaleString() : 'N/A', '', '']
        ];

        summaryData.forEach((rowVals, idx) => {
            const rowIndex = 4 + idx;
            const r = sheet.getRow(rowIndex);
            r.values = [rowVals[0], rowVals[1], rowVals[2], rowVals[3]];
            r.height = 20;

            ['A', 'C'].forEach(col => {
                const c = sheet.getCell(`${col}${rowIndex}`);
                c.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF475569' } };
                c.fill = lightGrayFill;
                c.border = thinBorder;
                c.alignment = { vertical: 'middle' };
            });

            ['B', 'D'].forEach(col => {
                const c = sheet.getCell(`${col}${rowIndex}`);
                c.font = { name: 'Arial', size: 9, bold: false, color: { argb: 'FF0F172A' } };
                c.border = thinBorder;
                c.alignment = { vertical: 'middle' };
            });
        });

        // 3. STORAGE MATRIX & STENCIL INVENTORY
        const invStartRow = 12;
        sheet.mergeCells(`A${invStartRow}:L${invStartRow}`);
        const invHeader = sheet.getCell(`A${invStartRow}`);
        invHeader.value = 'STORAGE MATRIX & STENCIL INVENTORY';
        invHeader.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
        invHeader.fill = subHeaderBlueFill;
        invHeader.alignment = { vertical: 'middle', horizontal: 'left' };
        sheet.getRow(invStartRow).height = 24;

        // Table Columns Header
        const headerRowIndex = 13;
        const columns = [
            'Location Code',
            'Grid Position',
            'Slot Status',
            'Stencil Barcode / ID',
            'Job Number',
            'Stencil / Model Name',
            'Revision',
            'Thickness (mils)',
            'Side',
            'MFG Date',
            'Remarks',
            'Created By'
        ];

        const hRow = sheet.getRow(headerRowIndex);
        hRow.values = columns;
        hRow.height = 24;

        columns.forEach((_, cIdx) => {
            const cell = hRow.getCell(cIdx + 1);
            cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = headerNavyFill;
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            cell.border = thinBorder;
        });

        // Populate all physical locations (Rows x Columns)
        let currentRowIndex = 14;
        const rowCount = Number(rack.rows);
        const colCount = Number(rack.columns);

        for (let r = 1; r <= rowCount; r++) {
            for (let c = 1; c <= colCount; c++) {
                const loc = locations.find((l: any) => Number(l.row_number) === r && Number(l.column_number) === c);
                const rStr = r.toString().padStart(2, '0');
                const cStr = c.toString().padStart(2, '0');
                const locCode = loc?.location_code || `RACK-${rack.name}-R${rStr}-C${cStr}`;
                const gridPos = `R${r}C${c}`;
                const isOccupied = loc && loc.status && loc.status !== 'EMPTY';
                const status = loc?.status || 'EMPTY';

                const slotCreator = isOccupied
                    ? ((loc.updated_by_name && loc.updated_by_name.trim())
                       || (loc.created_by_name && loc.created_by_name.trim())
                       || (loc.updated_by && String(loc.updated_by).trim())
                       || (loc.created_by && String(loc.created_by).trim())
                       || '')
                    : '';

                const rowData = [
                    locCode,
                    gridPos,
                    status,
                    isOccupied ? (loc.stencil_rack_number || '') : '',
                    isOccupied ? (loc.job_number || '') : '',
                    isOccupied ? (loc.stencil_name || '') : '',
                    isOccupied ? (loc.revision || '') : '',
                    isOccupied ? (loc.thickness_mills !== null && loc.thickness_mills !== undefined ? loc.thickness_mills : '') : '',
                    isOccupied ? (loc.side || '') : '',
                    isOccupied && loc.manufacturing_date ? new Date(loc.manufacturing_date).toISOString().split('T')[0] : '',
                    isOccupied ? (loc.remarks || '') : '',
                    slotCreator
                ];

                const row = sheet.getRow(currentRowIndex);
                row.values = rowData;
                row.height = 20;

                const isEven = (currentRowIndex % 2 === 0);
                const bgFill: ExcelJS.Fill = isOccupied
                    ? (status === 'STORED' ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } } : { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7ED' } })
                    : (isEven ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } } : { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } });

                columns.forEach((_, colIdx) => {
                    const cell = row.getCell(colIdx + 1);
                    cell.font = { name: 'Arial', size: 9, color: { argb: 'FF0F172A' } };
                    cell.border = thinBorder;
                    cell.fill = bgFill;
                    cell.alignment = (colIdx === 0 || colIdx === 3 || colIdx === 4 || colIdx === 5 || colIdx === 10 || colIdx === 11)
                        ? { vertical: 'middle', horizontal: 'left' }
                        : { vertical: 'middle', horizontal: 'center' };
                });

                currentRowIndex++;
            }
        }

        // Set column widths
        const colWidths = [24, 14, 16, 22, 18, 28, 12, 16, 14, 14, 24, 20];
        colWidths.forEach((w, i) => {
            sheet.getColumn(i + 1).width = w;
        });

        const safeRackName = rack.name.replace(/[^a-zA-Z0-9_-]/g, '_');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="Stencil_Rack_${safeRackName}_Report.xlsx"`);

        await workbook.xlsx.write(res);
        res.end();
    } catch (err: any) {
        logger.error('Error generating individual rack Excel report:', err);
        return res.status(500).json({ message: 'Internal server error while exporting rack Excel report.' });
    }
};

