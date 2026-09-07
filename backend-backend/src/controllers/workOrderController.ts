import { Request, Response } from 'express';
import pool, { smtPool } from '../config/db';
import { syncSmtWorkOrders, syncSingleWorkOrder, invalidateSyncCache } from '../services/workOrderSyncService';
import { WorkflowEngineService } from '../services/workflow/WorkflowEngineService';

export const createWorkOrder = async (req: Request, res: Response) => {
    const { wo_number, quantity, customer_name, model, selected_stages, selectedStages } = req.body;
    const stagesInput = selected_stages !== undefined ? selected_stages : selectedStages;
    const created_by = (req as any).user?.username || req.body.created_by || 'admin';

    // Validate selected_stages if provided
    let sanitizedStages: any = null;
    if (stagesInput !== undefined && stagesInput !== null) {
        if (!Array.isArray(stagesInput) || stagesInput.length === 0) {
            return res.status(400).json({ error: "At least one production stage must be selected." });
        }
        sanitizedStages = JSON.stringify(stagesInput);
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const woQuery = `
            INSERT INTO work_orders (wo_number, quantity, customer_name, model, created_by, selected_stages)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb)
            RETURNING *
        `;
        const woResult = await client.query(woQuery, [wo_number, quantity, customer_name, model, created_by, sanitizedStages]);
        const newWo = woResult.rows[0];

        // Dynamic route resolution for initial batch
        let firstStageId = 1;
        try {
            const activeRoute = await WorkflowEngineService.resolveActiveRoute({
                workOrderId: newWo.id,
                stagesList: stagesInput,
                dbClient: client
            });
            if (activeRoute && activeRoute.length > 0) {
                firstStageId = activeRoute[0].id;
            }
        } catch (routeErr: any) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: `Routing configuration error: ${routeErr.message}` });
        }

        // 2. Create the associated batch in batches table
        const batchQuery = `
            INSERT INTO batches (batch_number, work_order_id, current_stage_id, created_by)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `;
        const batchResult = await client.query(batchQuery, [wo_number, newWo.id, firstStageId, created_by]);
        const newBatch = batchResult.rows[0];

        // 3. Create batch_stage_progress for the active selected stages
        const stagesRes = await client.query('SELECT id FROM production_stages ORDER BY stage_order ASC');
        for (const stageRow of stagesRes.rows) {
            await client.query(
                `INSERT INTO batch_stage_progress (batch_id, stage_id) 
                 VALUES ($1, $2) 
                 ON CONFLICT (batch_id, stage_id) DO NOTHING`,
                [newBatch.id, stageRow.id]
            );
        }

        await client.query('COMMIT');
        invalidateSyncCache();

        res.status(201).json({
            ...newWo,
            work_order_number: newWo.wo_number,
            batch: newBatch
        });
    } catch (err: any) {
        await client.query('ROLLBACK');
        console.error("Error creating work order:", err);
        res.status(500).json({ error: "Failed to create work order: " + err.message });
    } finally {
        client.release();
    }
};

export const getAllWorkOrders = async (req: Request, res: Response) => {
    try {
        await syncSmtWorkOrders();

        const searchTrimmed = typeof req.query.search === 'string' ? req.query.search.trim() : '';

        // If explicitly requesting all without pagination (e.g. internal exports)
        if (req.query.all === 'true') {
            let allQuery = 'SELECT * FROM work_orders';
            const allParams: any[] = [];
            if (searchTrimmed) {
                allQuery += ' WHERE wo_number ILIKE $1';
                allParams.push(`%${searchTrimmed}%`);
            }
            allQuery += ' ORDER BY created_at DESC, id DESC';
            const result = await pool.query(allQuery, allParams);
            const mapped = result.rows.map(row => ({
                ...row,
                work_order_number: row.wo_number
            }));
            return res.status(200).json(mapped);
        }

        // Server-side pagination defaults: page = 1, limit = 20
        const pageNum = Math.max(1, parseInt(req.query.page as string, 10) || 1);
        const limitNum = Math.max(1, Math.min(100, parseInt(req.query.limit as string, 10) || 20));
        const offset = (pageNum - 1) * limitNum;

        let countQuery = 'SELECT COUNT(*)::int as total FROM work_orders';
        let dataQuery = 'SELECT * FROM work_orders';
        const params: any[] = [];

        if (searchTrimmed) {
            countQuery += ' WHERE wo_number ILIKE $1';
            dataQuery += ' WHERE wo_number ILIKE $1';
            params.push(`%${searchTrimmed}%`);
        }

        dataQuery += ` ORDER BY created_at DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;

        let [countResult, dataResult] = await Promise.all([
            pool.query(countQuery, params),
            pool.query(dataQuery, [...params, limitNum, offset])
        ]);

        let total = countResult.rows[0]?.total || 0;

        // If a specific work order search returned 0 results, attempt targeted sync in case it was just created
        if (searchTrimmed && total === 0) {
            await syncSingleWorkOrder(searchTrimmed);
            [countResult, dataResult] = await Promise.all([
                pool.query(countQuery, params),
                pool.query(dataQuery, [...params, limitNum, offset])
            ]);
            total = countResult.rows[0]?.total || 0;
        }

        const mapped = dataResult.rows.map(row => ({
            ...row,
            work_order_number: row.wo_number
        }));

        const totalPages = Math.ceil(total / limitNum) || 1;

        return res.status(200).json({
            success: true,
            data: mapped,
            page: pageNum,
            limit: limitNum,
            total,
            totalPages
        });
    } catch (err: any) {
        console.error("Error fetching work orders:", err);
        return res.status(500).json({ error: "Failed to fetch work orders: " + err.message });
    }
};

export const getWorkOrderById = async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id || id.trim() === '') {
        return res.status(400).json({ error: 'Work Order ID is required' });
    }

    const trimmed = id.trim();

    try {
        // 1. Try finding in work_orders by ID (if numeric) or wo_number
        const query = `
            SELECT * FROM work_orders 
            WHERE (CASE WHEN $1 ~ '^[0-9]+$' THEN id = $1::int ELSE false END)
               OR UPPER(TRIM(wo_number)) = UPPER($1)
            LIMIT 1
        `;
        let result = await pool.query(query, [trimmed]);

        // 2. If not found, trigger targeted single work order sync and check again
        if (result.rowCount === 0) {
            await syncSingleWorkOrder(trimmed);
            result = await pool.query(query, [trimmed]);
        }

        // 3. Fallback: check smt_work_orders directly
        if (result.rowCount === 0) {
            try {
                const smtRes = await smtPool.query(
                    'SELECT * FROM smt_work_orders WHERE UPPER(TRIM(id)) = UPPER($1) OR UPPER(TRIM(po_id)) = UPPER($1) LIMIT 1',
                    [trimmed]
                );
                if (smtRes.rowCount && smtRes.rowCount > 0) {
                    const smtWo = smtRes.rows[0];
                    await syncSingleWorkOrder(trimmed);
                    result = await pool.query(query, [trimmed]);
                    if (result.rowCount === 0) {
                        const rawStages = smtWo.selected_stages || null;
                        const activeRoute = await WorkflowEngineService.resolveActiveRoute({ stagesList: rawStages });
                        return res.status(200).json({
                            id: null,
                            wo_number: smtWo.id,
                            work_order_number: smtWo.id,
                            customer_name: smtWo.customer_name || '-',
                            model: smtWo.model_name || '-',
                            quantity: parseInt(smtWo.quantity) || 0,
                            selected_stages: rawStages,
                            active_route: activeRoute,
                            created_at: smtWo.created_at
                        });
                    }
                }
            } catch (smtErr) {
                console.warn('Fallback query to smt_work_orders failed:', smtErr);
            }
        }

        if (result.rowCount === 0) {
            return res.status(404).json({
                error: `Work Order "${trimmed}" was not found in the system.`,
                code: 'WORK_ORDER_NOT_FOUND'
            });
        }

        const wo = result.rows[0];
        let selectedStages = wo.selected_stages;
        if (typeof selectedStages === 'string') {
            try { selectedStages = JSON.parse(selectedStages); } catch (e) {}
        }

        let activeRoute: any[] = [];
        try {
            activeRoute = await WorkflowEngineService.resolveActiveRoute({ workOrderId: wo.id, selectedStages });
        } catch (rErr) {
            console.warn(`Could not resolve active route for WO ${wo.id}:`, rErr);
        }

        return res.status(200).json({
            ...wo,
            work_order_number: wo.wo_number,
            selected_stages: selectedStages,
            active_route: activeRoute
        });
    } catch (err: any) {
        console.error("Error fetching work order by ID:", err);
        return res.status(500).json({ error: "Failed to fetch work order: " + err.message });
    }
};

export const deleteWorkOrder = async (req: any, res: Response) => {
    const { id } = req.params;

    // Server-side role check
    const userRole = req.user?.role;
    const allowed = (userRole || '').toString().toLowerCase().replace(/\s/g, '');
    if (allowed !== 'admin' && allowed !== 'superadmin') {
        return res.status(403).json({ error: 'You do not have permission to delete this record.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Fetch wo_number before deleting
        const woFind = await client.query('SELECT wo_number FROM work_orders WHERE id = $1', [id]);
        const woNumber = woFind.rows.length > 0 ? woFind.rows[0].wo_number : null;

        // Find all batch IDs for this work order
        const batchRes = await client.query('SELECT id FROM batches WHERE work_order_id = $1', [id]);
        const batchIds = batchRes.rows.map(r => r.id);

        if (batchIds.length > 0) {
            // Find all barcodes for these batches
            const unitsRes = await client.query('SELECT barcode FROM units WHERE batch_id = ANY($1::int[])', [batchIds]);
            const barcodes = unitsRes.rows.map(r => r.barcode);

            if (barcodes.length > 0) {
                // Delete rework/debug sessions first (references scans and units)
                await client.query('DELETE FROM rework_sessions WHERE barcode = ANY($1::text[])', [barcodes]);
                await client.query('DELETE FROM debug_sessions WHERE barcode = ANY($1::text[])', [barcodes]);
                await client.query('DELETE FROM unit_serial_mapping WHERE barcode = ANY($1::text[])', [barcodes]);
            }

            // Delete all scans referencing these batches
            await client.query('DELETE FROM scans WHERE batch_id = ANY($1::int[])', [batchIds]);

            // Now safe to delete units
            await client.query('DELETE FROM units WHERE batch_id = ANY($1::int[])', [batchIds]);

            // Delete batch stage progress
            await client.query('DELETE FROM batch_stage_progress WHERE batch_id = ANY($1::int[])', [batchIds]);

            // Delete batches
            await client.query('DELETE FROM batches WHERE id = ANY($1::int[])', [batchIds]);
        }

        const result = await client.query('DELETE FROM work_orders WHERE id = $1 RETURNING *', [id]);

        if (woNumber) {
            try {
                await smtPool.query('DELETE FROM smt_work_orders WHERE id = $1', [woNumber]);
            } catch (smtErr) {
                console.error('Failed to delete SMT work order:', smtErr);
            }
        }

        await client.query('COMMIT');

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Work Order not found" });
        }
        res.status(200).json({ message: "Work Order deleted successfully" });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Error deleting work order:", err);
        res.status(500).json({ error: "Failed to delete work order" });
    } finally {
        client.release();
    }
};

