import { Request, Response } from 'express';
import * as ExcelJS from 'exceljs';
import pool from '../config/db';
import { createLogger } from '../utils/logger';

const logger = createLogger('MaterialManagement');

// Helper to get user operator details
const getOperator = (req: Request): string => {
    const user = (req as any).user;
    return user?.name || user?.email || 'Unknown Operator';
};

/**
 * GET /api/material-management/eligible-wos
 * Fetch all active QMS work orders that do NOT have a DRAFT or ACTIVE Material Management record
 */
export const getEligibleWorkOrders = async (req: Request, res: Response) => {
    try {
        const query = `
            SELECT 
                qm.id AS qms_id, 
                qm.work_order_number AS id,
                qm.work_order_number, 
                qm.po_number, 
                qm.product_name, 
                qm.product_description, 
                qm.quantity,
                wo.po_document_name, 
                wo.po_document_path, 
                wo.po_document_type,
                qm.bom_file_path,
                qm.ecn_file_path,
                qm.assembly_drawing_file_path,
                qm.files_metadata,
                br.id AS bom_revision_id,
                br.revision_number AS bom_revision_number
            FROM qms_master qm
            JOIN smt_work_orders wo ON qm.work_order_number = wo.id
            LEFT JOIN LATERAL (
                SELECT id, revision_number 
                FROM qms_bom_revisions 
                WHERE qms_id = qm.id 
                ORDER BY id DESC 
                LIMIT 1
            ) br ON true
            WHERE qm.is_deleted = false 
              AND qm.status = 'Active' 
              AND NOT EXISTS (
                  SELECT 1 
                  FROM material_management mm 
                  WHERE mm.work_order_id = wo.id 
                    AND mm.status IN ('DRAFT', 'ACTIVE')
              )
            ORDER BY qm.work_order_number ASC;
        `;
        const result = await pool.query(query);
        res.status(200).json(result.rows);
    } catch (err: any) {
        logger.error('Error fetching eligible work orders:', err);
        res.status(500).json({ error: 'Failed to fetch eligible work orders.' });
    }
};

/**
 * POST /api/material-management/create
 * Create a new Material Management record (DRAFT) snapshotting WO details and locking latest BOM revision
 */
export const createMaterialManagement = async (req: Request, res: Response) => {
    const { work_order_id, qms_id, remarks } = req.body;
    const operator = getOperator(req);

    if (!work_order_id || !qms_id) {
        return res.status(400).json({ error: 'Work Order ID and QMS ID are required.' });
    }

    try {
        // Enforce backend business rule: only one DRAFT or ACTIVE record per Work Order
        const checkActive = await pool.query(`
            SELECT id FROM material_management 
            WHERE work_order_id = $1 AND status IN ('DRAFT', 'ACTIVE')
        `, [work_order_id]);

        if (checkActive.rows.length > 0) {
            return res.status(400).json({ 
                error: 'An active or draft Material Management record already exists for this Work Order.' 
            });
        }

        // Fetch Work Order snapshot details
        const woRes = await pool.query(`
            SELECT id, product_name, product_description, quantity 
            FROM smt_work_orders WHERE id = $1
        `, [work_order_id]);

        if (woRes.rows.length === 0) {
            return res.status(404).json({ error: 'Work Order not found.' });
        }
        const wo = woRes.rows[0];

        // Fetch QMS snapshot details
        const qmsRes = await pool.query(`
            SELECT id, po_number FROM qms_master WHERE id = $1 AND is_deleted = false
        `, [qms_id]);

        if (qmsRes.rows.length === 0) {
            return res.status(404).json({ error: 'Active QMS record not found.' });
        }
        const qms = qmsRes.rows[0];

        // Fetch and lock latest BOM revision
        const bomRevRes = await pool.query(`
            SELECT id, revision_number FROM qms_bom_revisions 
            WHERE qms_id = $1 
            ORDER BY id DESC LIMIT 1
        `, [qms_id]);

        if (bomRevRes.rows.length === 0) {
            return res.status(400).json({ 
                error: 'No BOM revision found for this QMS record. Please upload a BOM file first.' 
            });
        }
        const lockedBom = bomRevRes.rows[0];

        // Insert Master
        const insertQuery = `
            INSERT INTO material_management (
                work_order_id, qms_id, work_order_number, po_number, product_name, 
                product_description, quantity, production_quantity, bom_revision_id, 
                bom_revision_number, status, remarks, created_by, updated_by
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'DRAFT', $11, $12, $12
            ) RETURNING *;
        `;
        const result = await pool.query(insertQuery, [
            wo.id,
            qms.id,
            wo.id, // work_order_number is same as ID
            qms.po_number || null,
            wo.product_name || null,
            wo.product_description || null,
            wo.quantity,
            wo.quantity, // copy quantity into production_quantity snapshot
            lockedBom.id,
            lockedBom.revision_number,
            remarks || null,
            operator
        ]);

        res.status(201).json({ 
            message: 'Material Management record created successfully in DRAFT state.',
            record: result.rows[0]
        });
    } catch (err: any) {
        logger.error('Error creating material management record:', err);
        res.status(500).json({ error: 'Failed to create Material Management record.' });
    }
};

export const getMaterialManagementRecords = async (req: Request, res: Response) => {
    try {
        const query = `
            SELECT mm.*
            FROM material_management mm
            ORDER BY mm.updated_at DESC;
        `;
        const result = await pool.query(query);
        res.status(200).json(result.rows);
    } catch (err: any) {
        logger.error('Error fetching material management records:', err);
        res.status(500).json({ error: 'Failed to fetch Material Management records.' });
    }
};

/**
 * GET /api/material-management/records/:id
 * Fetch complete details of a specific record by UUID
 */
export const getMaterialManagementDetail = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const query = `
            SELECT 
                mm.*,
                qm.bom_file_path,
                qm.ecn_file_path,
                qm.assembly_drawing_file_path,
                qm.files_metadata,
                wo.po_document_name,
                wo.po_document_path,
                wo.po_document_type,
                br.uploaded_by AS bom_uploaded_by,
                br.uploaded_at AS bom_uploaded_at,
                br.revision_number AS locked_bom_revision
            FROM material_management mm
            JOIN qms_master qm ON mm.qms_id = qm.id
            JOIN smt_work_orders wo ON mm.work_order_id = wo.id
            LEFT JOIN qms_bom_revisions br ON mm.bom_revision_id = br.id
            WHERE mm.id = $1;
        `;
        const result = await pool.query(query, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Material Management record not found.' });
        }

        res.status(200).json(result.rows[0]);
    } catch (err: any) {
        logger.error(`Error fetching detail for record ${id}:`, err);
        res.status(500).json({ error: 'Failed to fetch record details.' });
    }
};

/**
 * GET /api/material-management/records/:id/bom
 * Fetch BOM items for the latest active QMS revision, merging with saved items by vepl_part_no
 */
export const getMaterialManagementBom = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        // Fetch Master Record to find qms_id, current bom_revision_id, and production_quantity
        const masterRes = await pool.query(`
            SELECT qms_id, bom_revision_id, production_quantity 
            FROM material_management 
            WHERE id = $1
        `, [id]);

        if (masterRes.rows.length === 0) {
            return res.status(404).json({ error: 'Material Management record not found.' });
        }

        const { qms_id, bom_revision_id, production_quantity } = masterRes.rows[0];

        // Find the latest active BOM revision for this QMS record
        const latestRevRes = await pool.query(`
            SELECT id, revision_number 
            FROM qms_bom_revisions 
            WHERE qms_id = $1 
            ORDER BY id DESC LIMIT 1
        `, [qms_id]);

        if (latestRevRes.rows.length === 0) {
            return res.status(400).json({ error: 'No BOM revisions found for this QMS record.' });
        }

        const latest_bom_revision_id = latestRevRes.rows[0].id;
        const latest_bom_revision_number = latestRevRes.rows[0].revision_number;

        // Fetch all components of the LATEST active BOM revision (strictly numeric Sl No)
        const latestItemsRes = await pool.query(`
            SELECT 
                id AS qms_bom_item_id,
                sl_no,
                vepl_part_no,
                description,
                manufacturer,
                manufacturer_part_no AS mfr_part_no,
                qty_per_product
            FROM qms_bom_items
            WHERE bom_revision_id = $1 AND sl_no ~ '^[0-9]+$'
            ORDER BY id ASC
        `, [latest_bom_revision_id]);

        // Fetch currently saved items in material_management_items for this record (strictly numeric Sl No)
        const savedItemsRes = await pool.query(`
            SELECT 
                id AS material_management_item_id,
                qms_bom_item_id,
                sl_no,
                vepl_part_no,
                description,
                manufacturer,
                mfr_part_no,
                qty_per_product,
                issued_qty,
                delta_qty
            FROM material_management_items
            WHERE material_management_id = $1 AND sl_no ~ '^[0-9]+$'
            ORDER BY id ASC
        `, [id]);

        console.log("Material Management ID:", id);

        const savedItems = savedItemsRes.rows;
        const latestItems = latestItemsRes.rows;

        // Map saved items by vepl_part_no for easy lookup
        const savedMap = new Map<string, any>();
        savedItems.forEach(item => {
            if (item.vepl_part_no) {
                savedMap.set(item.vepl_part_no.toLowerCase(), item);
            }
        });

        // Track merged items
        const mergedList: any[] = [];
        let newComponentsCount = 0;
        let changedComponentsCount = 0;
        let removedComponentsCount = 0;

        const hasSavedItems = savedItems.length > 0;

        if (!hasSavedItems) {
            // Fallback: No saved items yet. Load and display BOM from latest QMS revision automatically
            latestItems.forEach(item => {
                const qtyPerProduct = parseFloat(item.qty_per_product || 0);
                const requiredQty = qtyPerProduct * production_quantity;
                mergedList.push({
                    qms_bom_item_id: item.qms_bom_item_id,
                    sl_no: item.sl_no,
                    vepl_part_no: item.vepl_part_no,
                    description: item.description,
                    manufacturer: item.manufacturer,
                    mfr_part_no: item.mfr_part_no,
                    qty_per_product: qtyPerProduct,
                    required_qty: requiredQty,
                    issued_qty: 0,
                    delta_qty: requiredQty,
                    is_new: false,
                    is_changed: false,
                    is_removed: false
                });
            });
        } else {
            const latestPartNos = new Set<string>();

            // Process all items in the latest BOM revision
            latestItems.forEach(item => {
                const partNoKey = item.vepl_part_no ? item.vepl_part_no.toLowerCase() : '';
                latestPartNos.add(partNoKey);

                const saved = savedMap.get(partNoKey);
                const qtyPerProduct = parseFloat(item.qty_per_product || 0);
                const requiredQty = qtyPerProduct * production_quantity;

                if (saved) {
                    // Check if properties changed
                    const isChanged = 
                        (item.description || '') !== (saved.description || '') ||
                        (item.manufacturer || '') !== (saved.manufacturer || '') ||
                        (item.mfr_part_no || '') !== (saved.mfr_part_no || '') ||
                        parseFloat(item.qty_per_product || 0) !== parseFloat(saved.qty_per_product || 0);

                    if (isChanged) {
                        changedComponentsCount++;
                    }

                    const issuedQty = parseFloat(saved.issued_qty || 0);
                    const deltaQty = requiredQty - issuedQty;

                    mergedList.push({
                        qms_bom_item_id: item.qms_bom_item_id,
                        sl_no: item.sl_no || saved.sl_no,
                        vepl_part_no: item.vepl_part_no,
                        description: item.description,
                        manufacturer: item.manufacturer,
                        mfr_part_no: item.mfr_part_no,
                        qty_per_product: qtyPerProduct,
                        required_qty: requiredQty,
                        issued_qty: issuedQty,
                        delta_qty: deltaQty,
                        is_new: false,
                        is_changed: isChanged,
                        is_removed: false
                    });
                } else {
                    // New component
                    newComponentsCount++;
                    mergedList.push({
                        qms_bom_item_id: item.qms_bom_item_id,
                        sl_no: item.sl_no,
                        vepl_part_no: item.vepl_part_no,
                        description: item.description,
                        manufacturer: item.manufacturer,
                        mfr_part_no: item.mfr_part_no,
                        qty_per_product: qtyPerProduct,
                        required_qty: requiredQty,
                        issued_qty: 0,
                        delta_qty: requiredQty,
                        is_new: true,
                        is_changed: false,
                        is_removed: false
                    });
                }
            });

            // Process removed items (saved items not in the latest BOM revision)
            savedItems.forEach(saved => {
                const partNoKey = saved.vepl_part_no ? saved.vepl_part_no.toLowerCase() : '';
                if (!latestPartNos.has(partNoKey)) {
                    removedComponentsCount++;
                    const qtyPerProduct = parseFloat(saved.qty_per_product || 0);
                    const requiredQty = qtyPerProduct * production_quantity;
                    const issuedQty = parseFloat(saved.issued_qty || 0);
                    const deltaQty = requiredQty - issuedQty;

                    mergedList.push({
                        qms_bom_item_id: saved.qms_bom_item_id,
                        sl_no: saved.sl_no,
                        vepl_part_no: saved.vepl_part_no,
                        description: saved.description,
                        manufacturer: saved.manufacturer,
                        mfr_part_no: saved.mfr_part_no,
                        qty_per_product: qtyPerProduct,
                        required_qty: requiredQty,
                        issued_qty: issuedQty,
                        delta_qty: deltaQty,
                        is_new: false,
                        is_changed: false,
                        is_removed: true
                    });
                }
            });
        }

        console.log("BOM Rows Found:", mergedList.length);

        // Map vepl_part_no to its index in latestItems to preserve physical sequence
        const partNoOrder = new Map<string, number>();
        latestItems.forEach((item, index) => {
            if (item.vepl_part_no) {
                const key = item.vepl_part_no.toLowerCase();
                if (!partNoOrder.has(key)) {
                    partNoOrder.set(key, index);
                }
            }
        });

        // Sort: Preserve latest QMS BOM revision physical order, with removed components at the bottom
        mergedList.sort((a, b) => {
            if (a.is_removed !== b.is_removed) {
                return a.is_removed ? 1 : -1; // removed components at the bottom
            }
            if (a.is_removed) {
                // If both are removed, sort alphabetically by vepl_part_no
                return (a.vepl_part_no || '').localeCompare(b.vepl_part_no || '');
            }
            // For active/new/changed items, sort by their index/sequence in the latest BOM
            const keyA = a.vepl_part_no ? a.vepl_part_no.toLowerCase() : '';
            const keyB = b.vepl_part_no ? b.vepl_part_no.toLowerCase() : '';
            const orderA = partNoOrder.get(keyA) ?? 999999;
            const orderB = partNoOrder.get(keyB) ?? 999999;
            return orderA - orderB;
        });

        res.status(200).json({
            production_quantity,
            bom_revision_id,
            latest_bom_revision_id,
            latest_bom_revision_number,
            newComponentsCount,
            changedComponentsCount,
            removedComponentsCount,
            items: mergedList
        });

    } catch (err: any) {
        logger.error(`Error fetching BOM for record ${id}:`, err);
        res.status(500).json({ error: 'Failed to fetch BOM items.' });
    }
};

/**
 * POST /api/material-management/records/:id/sync-bom
 * Synchronize the record with the latest active QMS BOM revision.
 */
export const syncMaterialManagementBom = async (req: Request, res: Response) => {
    const { id } = req.params;
    const operator = getOperator(req);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Fetch Master Record to get qms_id, production_quantity
        const masterRes = await client.query(`
            SELECT qms_id, production_quantity, status 
            FROM material_management 
            WHERE id = $1 FOR UPDATE
        `, [id]);

        if (masterRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Material Management record not found.' });
        }

        const { qms_id, production_quantity } = masterRes.rows[0];

        // Find the latest active BOM revision for this QMS record
        const latestRevRes = await client.query(`
            SELECT id, revision_number 
            FROM qms_bom_revisions 
            WHERE qms_id = $1 
            ORDER BY id DESC LIMIT 1
        `, [qms_id]);

        if (latestRevRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'No BOM revisions found for this QMS record.' });
        }

        const latest_bom_revision_id = latestRevRes.rows[0].id;
        const latest_bom_revision_number = latestRevRes.rows[0].revision_number;

        // Fetch all components of the LATEST active BOM revision (strictly numeric Sl No)
        const latestItemsRes = await client.query(`
            SELECT 
                id AS qms_bom_item_id,
                sl_no,
                vepl_part_no,
                description,
                manufacturer,
                manufacturer_part_no AS mfr_part_no,
                qty_per_product
            FROM qms_bom_items
            WHERE bom_revision_id = $1 AND sl_no ~ '^[0-9]+$'
        `, [latest_bom_revision_id]);

        const latestItems = latestItemsRes.rows;

        // 1. Delete saved items whose vepl_part_no is NOT in the latest revision
        const latestPartNoList = latestItems.map(item => item.vepl_part_no.toLowerCase());
        
        if (latestPartNoList.length > 0) {
            await client.query(`
                DELETE FROM material_management_items
                WHERE material_management_id = $1 AND LOWER(vepl_part_no) NOT IN (${latestPartNoList.map((_, idx) => `$${idx + 2}`).join(', ')})
            `, [id, ...latestPartNoList]);
        } else {
            await client.query(`
                DELETE FROM material_management_items
                WHERE material_management_id = $1
            `, [id]);
        }

        // 2. Upsert items from the latest BOM revision
        for (const item of latestItems) {
            const { qms_bom_item_id, sl_no, vepl_part_no, description, manufacturer, mfr_part_no, qty_per_product } = item;
            
            const numQtyPerProduct = parseFloat(qty_per_product || 0);
            const numRequiredQty = numQtyPerProduct * production_quantity;

            // Check if already exists by vepl_part_no
            const currentItemRes = await client.query(`
                SELECT id, issued_qty FROM material_management_items 
                WHERE material_management_id = $1 AND LOWER(vepl_part_no) = LOWER($2)
            `, [id, vepl_part_no]);

            if (currentItemRes.rows.length > 0) {
                const currentItem = currentItemRes.rows[0];
                const issuedQty = parseFloat(currentItem.issued_qty || 0);
                const deltaQty = numRequiredQty - issuedQty;

                await client.query(`
                    UPDATE material_management_items
                    SET qms_bom_item_id = $1,
                        description = $2,
                        manufacturer = $3,
                        mfr_part_no = $4,
                        qty_per_product = $5,
                        required_qty = $6,
                        delta_qty = $7,
                        updated_by = $8,
                        updated_at = CURRENT_TIMESTAMP,
                        sl_no = $10
                    WHERE id = $9
                `, [
                    qms_bom_item_id,
                    description || null,
                    manufacturer || null,
                    mfr_part_no || null,
                    numQtyPerProduct,
                    numRequiredQty,
                    deltaQty,
                    operator,
                    currentItem.id,
                    sl_no || null
                ]);
            } else {
                // Insert new component with issued_qty = 0
                await client.query(`
                    INSERT INTO material_management_items (
                        material_management_id, qms_bom_item_id, vepl_part_no, description,
                        manufacturer, mfr_part_no, qty_per_product, required_qty,
                        issued_qty, delta_qty, created_by, updated_by, sl_no
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $8, $9, $9, $10)
                `, [
                    id,
                    qms_bom_item_id,
                    vepl_part_no,
                    description || null,
                    manufacturer || null,
                    mfr_part_no || null,
                    numQtyPerProduct,
                    numRequiredQty,
                    numRequiredQty,
                    operator,
                    sl_no || null
                ]);
            }
        }

        // 3. Update the master record with latest bom_revision_id and bom_revision_number
        await client.query(`
            UPDATE material_management
            SET bom_revision_id = $1,
                bom_revision_number = $2,
                updated_by = $3,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $4
        `, [latest_bom_revision_id, latest_bom_revision_number, operator, id]);

        await client.query('COMMIT');
        res.status(200).json({ 
            message: 'BOM synchronized to latest active QMS revision successfully.',
            bom_revision_id: latest_bom_revision_id,
            bom_revision_number: latest_bom_revision_number
        });

    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error(`Error synchronizing BOM for record ${id}:`, err);
        res.status(500).json({ error: 'Failed to synchronize BOM.' });
    } finally {
        client.release();
    }
};

/**
 * POST /api/material-management/records/:id/bom
 * Save Draft or Complete BOM values via UPSERT strategy, logging history logs
 */
export const saveMaterialManagementBom = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { items, remarks, status } = req.body;
    const operator = getOperator(req);

    if (!Array.isArray(items)) {
        return res.status(400).json({ error: 'BOM items must be an array.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Check if master record exists and get current status
        const masterRes = await client.query(`
            SELECT status, production_quantity FROM material_management 
            WHERE id = $1 FOR UPDATE
        `, [id]);

        if (masterRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Material Management record not found.' });
        }

        const currentStatus = masterRes.rows[0].status;
        const productionQty = masterRes.rows[0].production_quantity;

        // Perform status update validation if status changes
        if (status && status !== currentStatus) {
            const allowedTransitions: { [key: string]: string[] } = {
                'DRAFT': ['ACTIVE', 'COMPLETED', 'CLOSED'],
                'ACTIVE': ['COMPLETED', 'CLOSED'],
                'COMPLETED': ['CLOSED'],
                'CLOSED': []
            };

            const allowed = allowedTransitions[currentStatus] || [];
            if (!allowed.includes(status)) {
                await client.query('ROLLBACK');
                return res.status(400).json({ 
                    error: `Invalid status transition from ${currentStatus} to ${status}.` 
                });
            }
        }

        // Loop through each item to perform UPSERT and log history changes
        for (const item of items) {
            const { qms_bom_item_id, sl_no, vepl_part_no, description, manufacturer, mfr_part_no, qty_per_product, issued_qty } = item;
            
            const numQtyPerProduct = parseFloat(qty_per_product || 0);
            const numRequiredQty = numQtyPerProduct * productionQty;
            const numIssuedQty = parseFloat(issued_qty || 0);
            const numDeltaQty = numRequiredQty - numIssuedQty;

            // Fetch current state by vepl_part_no to prevent duplicates
            const currentItemRes = await client.query(`
                SELECT id, issued_qty, delta_qty FROM material_management_items 
                WHERE material_management_id = $1 AND LOWER(vepl_part_no) = LOWER($2)
            `, [id, vepl_part_no]);

            let itemId: string;
            let prevIssued: number | null = null;
            let prevDelta: number | null = null;

            if (currentItemRes.rows.length > 0) {
                const currentItem = currentItemRes.rows[0];
                itemId = currentItem.id;
                prevIssued = parseFloat(currentItem.issued_qty || 0);
                prevDelta = parseFloat(currentItem.delta_qty || 0);

                // Update row
                await client.query(`
                    UPDATE material_management_items
                    SET qms_bom_item_id = $1,
                        description = $2,
                        manufacturer = $3,
                        mfr_part_no = $4,
                        qty_per_product = $5,
                        required_qty = $6,
                        issued_qty = $7,
                        delta_qty = $8,
                        updated_by = $9,
                        updated_at = CURRENT_TIMESTAMP,
                        sl_no = $11
                    WHERE id = $10
                `, [
                    qms_bom_item_id || null,
                    description || null,
                    manufacturer || null,
                    mfr_part_no || null,
                    numQtyPerProduct,
                    numRequiredQty,
                    numIssuedQty,
                    numDeltaQty,
                    operator,
                    itemId,
                    sl_no || null
                ]);
            } else {
                // Insert new row
                const insertItemRes = await client.query(`
                    INSERT INTO material_management_items (
                        material_management_id, qms_bom_item_id, vepl_part_no, description,
                        manufacturer, mfr_part_no, qty_per_product, required_qty,
                        issued_qty, delta_qty, created_by, updated_by, sl_no
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $12)
                    RETURNING id
                `, [
                    id,
                    qms_bom_item_id || null,
                    vepl_part_no,
                    description || null,
                    manufacturer || null,
                    mfr_part_no || null,
                    numQtyPerProduct,
                    numRequiredQty,
                    numIssuedQty,
                    numDeltaQty,
                    operator,
                    sl_no || null
                ]);
                itemId = insertItemRes.rows[0].id;
            }

            // If quantity changed or it's new, log in history table
            if (prevIssued === null || prevIssued !== numIssuedQty || prevDelta !== numDeltaQty) {
                await client.query(`
                    INSERT INTO material_management_item_history (
                        material_management_item_id, previous_issued_qty, new_issued_qty,
                        previous_delta_qty, new_delta_qty, remarks, changed_by
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                `, [
                    itemId,
                    prevIssued,
                    numIssuedQty,
                    prevDelta,
                    numDeltaQty,
                    remarks || 'BOM Quantity save action',
                    operator
                ]);
            }
        }

        // Update master record status and remarks if requested
        if (status) {
            await client.query(`
                UPDATE material_management
                SET status = $1,
                    remarks = COALESCE($2, remarks),
                    updated_by = $3,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $4
            `, [status, remarks || null, operator, id]);
        } else {
            await client.query(`
                UPDATE material_management
                SET updated_by = $1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $2
            `, [operator, id]);
        }

        await client.query('COMMIT');
        res.status(200).json({ message: 'BOM items saved and updated successfully.' });

    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error(`Error saving BOM items for record ${id}:`, err);
        res.status(500).json({ error: 'Failed to save BOM items.' });
    } finally {
        client.release();
    }
};

/**
 * PUT /api/material-management/records/:id/status
 * Update master record status enforcing allowed transitions
 */
export const updateMaterialManagementStatus = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status, remarks } = req.body;
    const operator = getOperator(req);

    if (!status) {
        return res.status(400).json({ error: 'Status value is required.' });
    }

    try {
        const check = await pool.query(`
            SELECT status FROM material_management WHERE id = $1
        `, [id]);

        if (check.rows.length === 0) {
            return res.status(404).json({ error: 'Material Management record not found.' });
        }

        const currentStatus = check.rows[0].status;

        const allowedTransitions: { [key: string]: string[] } = {
            'DRAFT': ['ACTIVE', 'COMPLETED', 'CLOSED'],
            'ACTIVE': ['COMPLETED', 'CLOSED'],
            'COMPLETED': ['CLOSED'],
            'CLOSED': []
        };

        const allowed = allowedTransitions[currentStatus] || [];
        if (!allowed.includes(status)) {
            return res.status(400).json({ 
                error: `Invalid status transition from ${currentStatus} to ${status}.` 
            });
        }

        await pool.query(`
            UPDATE material_management
            SET status = $1,
                remarks = COALESCE($2, remarks),
                updated_by = $3,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $4
        `, [status, remarks || null, operator, id]);

        res.status(200).json({ 
            message: `Status updated successfully to ${status}.` 
        });
    } catch (err: any) {
        logger.error(`Error updating status for record ${id}:`, err);
        res.status(500).json({ error: 'Failed to update record status.' });
    }
};

/**
 * GET /api/material-management/records/:id/export/excel
 * Export Material Management Record summary and BOM items to a multi-sheet Excel file.
 */
export const exportMaterialManagementExcel = async (req: Request, res: Response) => {
    const { id } = req.params;
    const operator = getOperator(req);
    const generatedDateStr = new Date().toLocaleString();

    try {
        // 1. Fetch the master record
        const recordQuery = await pool.query(`
            SELECT mm.*, qm.quantity AS original_quantity
            FROM material_management mm
            JOIN qms_master qm ON mm.qms_id = qm.id
            WHERE mm.id = $1
        `, [id]);

        if (recordQuery.rows.length === 0) {
            return res.status(404).json({ error: 'Material Management record not found.' });
        }

        const record = recordQuery.rows[0];

        // 2. Fetch the BOM items ordered by their sequence in the latest QMS BOM (using left join on qms_bom_items, strictly numeric Sl No)
        const bomItemsQuery = await pool.query(`
            SELECT 
                mmi.id AS material_management_item_id,
                mmi.qms_bom_item_id,
                mmi.sl_no,
                mmi.vepl_part_no,
                mmi.description,
                mmi.manufacturer,
                mmi.mfr_part_no,
                mmi.qty_per_product,
                mmi.required_qty,
                mmi.issued_qty,
                mmi.delta_qty
            FROM material_management_items mmi
            LEFT JOIN qms_bom_items qbi ON mmi.qms_bom_item_id = qbi.id
            WHERE mmi.material_management_id = $1 AND mmi.sl_no ~ '^[0-9]+$'
            ORDER BY qbi.id ASC NULLS LAST, mmi.id ASC
        `, [id]);

        const bomItems = bomItemsQuery.rows;

        // Generate Workbook
        const workbook = new ExcelJS.Workbook();
        workbook.creator = operator;
        workbook.created = new Date();

        // Single Sheet: Material BOM Details
        const bomSheet = workbook.addWorksheet('Material BOM Details');
        bomSheet.views = [{ showGridLines: true }];

        // Header Information at the top
        const createdDateFormatted = record.created_at 
            ? new Date(record.created_at).toISOString().split('T')[0]
            : '—';

        bomSheet.addRow(['Work Order Number', record.work_order_number]);
        bomSheet.addRow(['PO Number', record.po_number || '—']);
        bomSheet.addRow(['Product Name', record.product_name || '—']);
        bomSheet.addRow(['Original WO Qty', record.original_quantity]);
        bomSheet.addRow(['Production Quantity', record.production_quantity]);
        bomSheet.addRow(['Current BOM Revision', record.bom_revision_number ? `Rev ${record.bom_revision_number}` : 'Rev 1.1']);
        bomSheet.addRow(['Status', record.status]);
        bomSheet.addRow(['Created By', record.created_by || '—']);
        bomSheet.addRow(['Created Date', createdDateFormatted]);

        // Format metadata headers in Column A (Bold, Left aligned)
        for (let r = 1; r <= 9; r++) {
            const row = bomSheet.getRow(r);
            row.getCell(1).font = { bold: true };
            row.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
            row.getCell(2).alignment = { vertical: 'middle', horizontal: 'left' };
        }

        // Leave 2 blank rows
        bomSheet.addRow([]);
        bomSheet.addRow([]);

        // BOM Table Headers on Row 12
        const bomHeaders = [
            'Sl No',
            'VEPL Part No',
            'Description',
            'Manufacturer',
            'Mfr. Part No',
            'Qty / Product',
            'Required Qty',
            'Issued Qty',
            'Delta'
        ];
        bomSheet.addRow(bomHeaders);

        const tableHeaderRowIndex = 12;
        const bomHeaderRow = bomSheet.getRow(tableHeaderRowIndex);
        bomHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        bomHeaderRow.height = 28;
        bomHeaderRow.eachCell((cell) => {
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF1E3A8A' } // Dark blue
            };
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            cell.border = {
                top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
                left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
                bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
                right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
            };
        });

        // Add BOM items data starting from row 13
        bomItems.forEach((item, index) => {
            const rowIndex = 13 + index;
            const qtyPerProd = item.qty_per_product !== null ? parseFloat(item.qty_per_product) : 0;
            const reqQty = item.required_qty !== null ? parseFloat(item.required_qty) : 0;
            const issuedQty = item.issued_qty !== null ? parseFloat(item.issued_qty) : 0;
            const deltaQtyVal = item.delta_qty !== null ? parseFloat(item.delta_qty) : 0;

            bomSheet.addRow([
                item.sl_no || '',
                item.vepl_part_no || '',
                item.description || '',
                item.manufacturer || '',
                item.mfr_part_no || '',
                qtyPerProd,
                reqQty,
                issuedQty,
                deltaQtyVal
            ]);

            const row = bomSheet.getRow(rowIndex);
            const isEven = rowIndex % 2 === 0;
            const rowBgColor = isEven ? 'FFF8FAFC' : 'FFFFFFFF'; // Alternating row color

            row.eachCell((cell, colIndex) => {
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: rowBgColor }
                };
                cell.border = {
                    top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
                    left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
                    bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
                    right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
                };

                // Alignment & wrapping
                if (colIndex === 3 || colIndex === 4 || colIndex === 5) {
                    // Description, Manufacturer, Mfr. Part No
                    cell.alignment = { 
                        vertical: 'middle', 
                        horizontal: 'left', 
                        wrapText: true 
                    };
                } else if (colIndex === 1 || colIndex === 2) {
                    // Sl No, VEPL Part No
                    cell.alignment = { 
                        vertical: 'middle', 
                        horizontal: 'center' 
                    };
                } else {
                    // Numeric Columns
                    cell.numFmt = '#,##0.00';
                    cell.alignment = { 
                        vertical: 'middle', 
                        horizontal: 'right' 
                    };
                }
            });

            // Auto row height estimation based on text length and newline wraps
            let maxLines = 1;
            [item.description, item.manufacturer, item.mfr_part_no].forEach((text) => {
                if (text) {
                    const lines = text.toString().split('\n').length;
                    if (lines > maxLines) maxLines = lines;
                    const charLimit = 40; // column width is 40
                    const wrapLines = Math.ceil(text.toString().length / charLimit);
                    if (wrapLines > maxLines) maxLines = wrapLines;
                }
            });
            row.height = maxLines * 16 + 10;
        });

        // Set exact requested column widths
        const colWidths = [10, 20, 40, 40, 40, 15, 15, 15, 15];
        colWidths.forEach((w, idx) => {
            const col = bomSheet.getColumn(idx + 1);
            col.width = w;
        });

        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="Material_Report_${record.work_order_number}.xlsx"`
        );

        await workbook.xlsx.write(res);
        res.end();

    } catch (err: any) {
        logger.error(`Error exporting Excel for record ${id}:`, err);
        res.status(500).json({ error: 'Failed to export Excel report.' });
    }
};
