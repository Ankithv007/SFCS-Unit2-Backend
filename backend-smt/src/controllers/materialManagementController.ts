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

interface ParsedBarcode {
    uid: string;
    veplPartNo: string;
    quantity: number;
}

export const parseSMTBarcode = (rawBarcode: string): ParsedBarcode => {
    const sanitized = rawBarcode.trim().replace(/[\r\n]+/g, '');
    const regex = /^ue1(?:UUID|UID)\d+-[a-zA-Z0-9]+1D<Facts>Q\d+$/;
    if (!regex.test(sanitized)) {
        throw new Error('Invalid barcode format.');
    }
    const uidIndex = sanitized.indexOf('UID');
    const dashIndex = sanitized.indexOf('-');
    const uid = sanitized.slice(uidIndex, dashIndex);
    const factsIndex = sanitized.indexOf('<Facts>');
    let veplPartNo = sanitized.slice(dashIndex + 1, factsIndex);
    if (veplPartNo.endsWith('1D')) {
        veplPartNo = veplPartNo.slice(0, -2);
    }
    const qtyPart = sanitized.slice(factsIndex + 7);
    let qtyStr = qtyPart;
    if (qtyStr.startsWith('Q')) {
        qtyStr = qtyStr.slice(1);
    }
    const quantity = parseInt(qtyStr, 10);
    return { uid, veplPartNo, quantity };
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
                br.revision_number AS locked_bom_revision,
                COALESCE(stats.total_components, 0)::int AS total_components,
                COALESCE(stats.total_request_scanned, 0)::int AS total_request_scanned,
                COALESCE(stats.total_return_scanned, 0)::int AS total_return_scanned
            FROM material_management mm
            JOIN qms_master qm ON mm.qms_id = qm.id
            JOIN smt_work_orders wo ON mm.work_order_id = wo.id
            LEFT JOIN qms_bom_revisions br ON mm.bom_revision_id = br.id
            LEFT JOIN (
                SELECT 
                    mmi.material_management_id,
                    COUNT(*)::int AS total_components,
                    COUNT(CASE WHEN COALESCE(issued_agg.issued_sum, 0) > 0 THEN 1 END)::int AS total_request_scanned,
                    COUNT(CASE WHEN COALESCE(returned_agg.returned_sum, 0) > 0 THEN 1 END)::int AS total_return_scanned
                FROM material_management_items mmi
                LEFT JOIN (
                    SELECT material_request_item_id, SUM(issued_qty) AS issued_sum
                    FROM issued_material_details
                    GROUP BY material_request_item_id
                ) issued_agg ON mmi.id = issued_agg.material_request_item_id
                LEFT JOIN (
                    SELECT imd.material_request_item_id, SUM(rmd.returned_qty) AS returned_sum
                    FROM returned_material_details rmd
                    JOIN issued_material_details imd ON rmd.issued_material_detail_id = imd.id
                    GROUP BY imd.material_request_item_id
                ) returned_agg ON mmi.id = returned_agg.material_request_item_id
                GROUP BY mmi.material_management_id
            ) stats ON mm.id = stats.material_management_id
            WHERE mm.id = $1;
        `;
        const result = await pool.query(query, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Material Management record not found.' });
        }

        const row = result.rows[0];
        // Add aliases to match return example exactly
        row.work_order_no = row.work_order_number;
        row.production_qty = row.production_quantity;
        row.bom_revision = row.bom_revision_number ? `Rev ${row.bom_revision_number}` : 'Rev 1.1';

        res.status(200).json(row);
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
        // Calculating dynamic quantities from child tables
        const savedItemsRes = await pool.query(`
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
                COALESCE(issued_agg.issued_qty, 0) AS issued_qty,
                COALESCE(issued_agg.issued_qty, 0) - mmi.required_qty AS delta_qty,
                COALESCE(returned_agg.returned_qty, 0) AS return_qty,
                COALESCE(issued_agg.issued_qty, 0) - COALESCE(returned_agg.returned_qty, 0) AS return_delta
            FROM material_management_items mmi
            LEFT JOIN (
                SELECT 
                    material_request_item_id,
                    SUM(issued_qty) AS issued_qty
                FROM issued_material_details
                GROUP BY material_request_item_id
            ) issued_agg ON mmi.id = issued_agg.material_request_item_id
            LEFT JOIN (
                SELECT 
                    imd.material_request_item_id,
                    SUM(rmd.returned_qty) AS returned_qty
                FROM returned_material_details rmd
                JOIN issued_material_details imd ON rmd.issued_material_detail_id = imd.id
                GROUP BY imd.material_request_item_id
            ) returned_agg ON mmi.id = returned_agg.material_request_item_id
            WHERE mmi.material_management_id = $1 AND mmi.sl_no ~ '^[0-9]+$'
            ORDER BY mmi.id ASC
        `, [id]);

        const savedItems = savedItemsRes.rows;
        const latestItems = latestItemsRes.rows;
        const mergedList: any[] = [];
        let newComponentsCount = 0;
        let changedComponentsCount = 0;
        let removedComponentsCount = 0;

        const hasSavedItems = savedItems.length > 0;

        if (!hasSavedItems) {
            // Auto-initialize material_management_items in a transaction so we have database IDs for scanning
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                for (const item of latestItems) {
                    const qtyPerProduct = parseFloat(item.qty_per_product || 0);
                    const requiredQty = qtyPerProduct * production_quantity;
                    await client.query(`
                        INSERT INTO material_management_items (
                            material_management_id, qms_bom_item_id, vepl_part_no, description,
                            manufacturer, mfr_part_no, qty_per_product, required_qty,
                            issued_qty, delta_qty, created_by, updated_by, sl_no
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $10, $10, $11)
                    `, [
                        id,
                        item.qms_bom_item_id,
                        item.vepl_part_no,
                        item.description || null,
                        item.manufacturer || null,
                        item.mfr_part_no || null,
                        qtyPerProduct,
                        requiredQty,
                        -requiredQty,
                        'System Init',
                        item.sl_no || null
                    ]);
                }
                await client.query('COMMIT');
            } catch (err) {
                await client.query('ROLLBACK');
                logger.error('Failed to auto-init BOM items:', err);
                throw err;
            } finally {
                client.release();
            }

            // Re-fetch initialized items
            const refetchedRes = await pool.query(`
                SELECT 
                    id AS material_management_item_id,
                    qms_bom_item_id,
                    sl_no,
                    vepl_part_no,
                    description,
                    manufacturer,
                    mfr_part_no,
                    qty_per_product,
                    required_qty,
                    0 AS issued_qty,
                    -required_qty AS delta_qty,
                    0 AS total_uid_count
                FROM material_management_items
                WHERE material_management_id = $1 AND sl_no ~ '^[0-9]+$'
                ORDER BY id ASC
            `, [id]);

            refetchedRes.rows.forEach(item => {
                mergedList.push({
                    ...item,
                    qty_per_product: parseFloat(item.qty_per_product),
                    required_qty: parseFloat(item.required_qty),
                    issued_qty: parseFloat(item.issued_qty),
                    delta_qty: parseFloat(item.delta_qty),
                    issued_delta: parseFloat(item.delta_qty),
                    return_qty: 0,
                    return_delta: 0,
                    total_uid_count: 0,
                    issued_uids: [],
                    returned_uids: [],
                    is_new: false,
                    is_changed: false,
                    is_removed: false
                });
            });
        } else {
            // Fetch all scanned UIDs for the items
            const uidsRes = await pool.query(`
                SELECT 
                    imd.material_request_item_id,
                    imd.uid,
                    imd.issued_qty,
                    imd.remaining_qty,
                    imd.scanned_by,
                    imd.scanned_at,
                    COALESCE(ret.returned_qty, 0) AS returned_qty
                FROM issued_material_details imd
                LEFT JOIN (
                    SELECT 
                        issued_material_detail_id, 
                        SUM(returned_qty) AS returned_qty
                    FROM returned_material_details
                    GROUP BY issued_material_detail_id
                ) ret ON ret.issued_material_detail_id = imd.id
                WHERE imd.material_request_item_id IN (
                    SELECT id FROM material_management_items WHERE material_management_id = $1
                )
                ORDER BY imd.scanned_at ASC
            `, [id]);

            const uidsMap = new Map<string, any[]>();
            uidsRes.rows.forEach(row => {
                const list = uidsMap.get(row.material_request_item_id) || [];
                list.push({
                    uid: row.uid,
                    issued_qty: parseFloat(row.issued_qty),
                    remaining_qty: parseFloat(row.remaining_qty),
                    returned_qty: parseFloat(row.returned_qty),
                    scanned_by: row.scanned_by,
                    scanned_at: row.scanned_at
                });
                uidsMap.set(row.material_request_item_id, list);
            });

            // Fetch all returned UIDs details
            const returnedUidsRes = await pool.query(`
                SELECT 
                    imd.material_request_item_id,
                    rmd.uid,
                    rmd.returned_qty,
                    rmd.remaining_qty_after,
                    rmd.returned_by,
                    rmd.returned_at
                FROM returned_material_details rmd
                JOIN issued_material_details imd ON rmd.issued_material_detail_id = imd.id
                WHERE imd.material_request_item_id IN (
                    SELECT id FROM material_management_items WHERE material_management_id = $1
                )
                ORDER BY rmd.returned_at ASC
            `, [id]);

            const returnedUidsMap = new Map<string, any[]>();
            returnedUidsRes.rows.forEach(row => {
                const list = returnedUidsMap.get(row.material_request_item_id) || [];
                list.push({
                    uid: row.uid,
                    returned_qty: parseFloat(row.returned_qty),
                    remaining_qty_after: parseFloat(row.remaining_qty_after),
                    returned_by: row.returned_by,
                    returned_at: row.returned_at
                });
                returnedUidsMap.set(row.material_request_item_id, list);
            });

            const latestPartNos = new Set<string>();

            // Process all items in the latest BOM revision
            latestItems.forEach(item => {
                const partNoKey = item.vepl_part_no ? item.vepl_part_no.toLowerCase() : '';
                latestPartNos.add(partNoKey);

                const saved = savedItems.find(s => s.vepl_part_no.toLowerCase() === partNoKey);
                const qtyPerProduct = parseFloat(item.qty_per_product || 0);
                const requiredQty = qtyPerProduct * production_quantity;

                if (saved) {
                    const isChanged = 
                        (item.description || '') !== (saved.description || '') ||
                        (item.manufacturer || '') !== (saved.manufacturer || '') ||
                        (item.mfr_part_no || '') !== (saved.mfr_part_no || '') ||
                        parseFloat(item.qty_per_product || 0) !== parseFloat(saved.qty_per_product || 0);

                    if (isChanged) {
                        changedComponentsCount++;
                    }

                    const issuedQty = parseFloat(saved.issued_qty || 0);
                    const returnQty = parseFloat(saved.return_qty || 0);
                    const deltaQty = issuedQty - requiredQty;
                    const returnDelta = issuedQty - returnQty;
                    const issuedUids = uidsMap.get(saved.material_management_item_id) || [];
                    const returnedUids = returnedUidsMap.get(saved.material_management_item_id) || [];

                    mergedList.push({
                        qms_bom_item_id: item.qms_bom_item_id,
                        material_management_item_id: saved.material_management_item_id,
                        sl_no: item.sl_no || saved.sl_no,
                        vepl_part_no: item.vepl_part_no,
                        description: item.description,
                        manufacturer: item.manufacturer,
                        mfr_part_no: item.mfr_part_no,
                        qty_per_product: qtyPerProduct,
                        required_qty: requiredQty,
                        issued_qty: issuedQty,
                        delta_qty: deltaQty,
                        issued_delta: deltaQty,
                        return_qty: returnQty,
                        return_delta: returnDelta,
                        total_uid_count: issuedUids.length,
                        issued_uids: issuedUids,
                        returned_uids: returnedUids,
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
                        delta_qty: -requiredQty,
                        issued_delta: -requiredQty,
                        return_qty: 0,
                        return_delta: 0,
                        total_uid_count: 0,
                        issued_uids: [],
                        returned_uids: [],
                        is_new: true,
                        is_changed: false,
                        is_removed: false
                    });
                }
            });

            // Process removed items
            savedItems.forEach(saved => {
                const partNoKey = saved.vepl_part_no ? saved.vepl_part_no.toLowerCase() : '';
                if (!latestPartNos.has(partNoKey)) {
                    removedComponentsCount++;
                    const qtyPerProduct = parseFloat(saved.qty_per_product || 0);
                    const requiredQty = qtyPerProduct * production_quantity;
                    const issuedQty = parseFloat(saved.issued_qty || 0);
                    const returnQty = parseFloat(saved.return_qty || 0);
                    const deltaQty = issuedQty - requiredQty;
                    const returnDelta = issuedQty - returnQty;
                    const issuedUids = uidsMap.get(saved.material_management_item_id) || [];
                    const returnedUids = returnedUidsMap.get(saved.material_management_item_id) || [];

                    mergedList.push({
                        qms_bom_item_id: saved.qms_bom_item_id,
                        material_management_item_id: saved.material_management_item_id,
                        sl_no: saved.sl_no,
                        vepl_part_no: saved.vepl_part_no,
                        description: saved.description,
                        manufacturer: saved.manufacturer,
                        mfr_part_no: saved.mfr_part_no,
                        qty_per_product: qtyPerProduct,
                        required_qty: requiredQty,
                        issued_qty: issuedQty,
                        delta_qty: deltaQty,
                        issued_delta: deltaQty,
                        return_qty: returnQty,
                        return_delta: returnDelta,
                        total_uid_count: issuedUids.length,
                        issued_uids: issuedUids,
                        returned_uids: returnedUids,
                        is_new: false,
                        is_changed: false,
                        is_removed: true
                    });
                }
            });
        }

        // Preserve order
        const partNoOrder = new Map<string, number>();
        latestItems.forEach((item, index) => {
            if (item.vepl_part_no) {
                const key = item.vepl_part_no.toLowerCase();
                if (!partNoOrder.has(key)) {
                    partNoOrder.set(key, index);
                }
            }
        });

        mergedList.sort((a, b) => {
            if (a.is_removed !== b.is_removed) {
                return a.is_removed ? 1 : -1;
            }
            if (a.is_removed) {
                return (a.vepl_part_no || '').localeCompare(b.vepl_part_no || '');
            }
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

        // 2. Fetch the BOM items dynamically calculating dynamic quantities from child tables
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
                COALESCE(issued_agg.issued_qty, 0) AS issued_qty,
                COALESCE(issued_agg.issued_qty, 0) - mmi.required_qty AS delta_qty,
                COALESCE(returned_agg.return_qty, 0) AS return_qty,
                COALESCE(issued_agg.issued_qty, 0) - COALESCE(returned_agg.return_qty, 0) AS return_delta
            FROM material_management_items mmi
            LEFT JOIN qms_bom_items qbi ON mmi.qms_bom_item_id = qbi.id
            LEFT JOIN (
                SELECT 
                    material_request_item_id,
                    SUM(issued_qty) AS issued_qty
                FROM issued_material_details
                GROUP BY material_request_item_id
            ) issued_agg ON mmi.id = issued_agg.material_request_item_id
            LEFT JOIN (
                SELECT 
                    imd.material_request_item_id,
                    SUM(rmd.returned_qty) AS return_qty
                FROM returned_material_details rmd
                JOIN issued_material_details imd ON rmd.issued_material_detail_id = imd.id
                GROUP BY imd.material_request_item_id
            ) returned_agg ON mmi.id = returned_agg.material_request_item_id
            WHERE mmi.material_management_id = $1 AND mmi.sl_no ~ '^[0-9]+$'
            ORDER BY qbi.id ASC NULLS LAST, mmi.id ASC
        `, [id]);

        const bomItems = bomItemsQuery.rows;

        // Fetch scanned UIDs list for all items in the request formatted with Arrow
        const uidsQuery = await pool.query(`
            SELECT material_request_item_id, uid, issued_qty
            FROM issued_material_details
            WHERE material_request_item_id IN (
                SELECT id FROM material_management_items WHERE material_management_id = $1
            )
            ORDER BY scanned_at ASC
        `, [id]);

        const uidsMap = new Map<string, string[]>();
        uidsQuery.rows.forEach(r => {
            const list = uidsMap.get(r.material_request_item_id) || [];
            list.push(`${r.uid} → ${parseFloat(r.issued_qty)}`);
            uidsMap.set(r.material_request_item_id, list);
        });

        // Fetch returned UIDs list for all items in the request formatted with Arrow
        const returnedUidsQuery = await pool.query(`
            SELECT imd.material_request_item_id, rmd.uid, rmd.returned_qty
            FROM returned_material_details rmd
            JOIN issued_material_details imd ON rmd.issued_material_detail_id = imd.id
            WHERE imd.material_request_item_id IN (
                SELECT id FROM material_management_items WHERE material_management_id = $1
            )
            ORDER BY rmd.returned_at ASC
        `, [id]);

        const returnedUidsMap = new Map<string, string[]>();
        const groupedReturns = new Map<string, Map<string, number>>();
        returnedUidsQuery.rows.forEach(r => {
            const itemMap = groupedReturns.get(r.material_request_item_id) || new Map<string, number>();
            itemMap.set(r.uid, (itemMap.get(r.uid) || 0) + parseFloat(r.returned_qty));
            groupedReturns.set(r.material_request_item_id, itemMap);
        });

        groupedReturns.forEach((uidMap, itemId) => {
            const list: string[] = [];
            uidMap.forEach((qty, uid) => {
                list.push(`${uid} → ${qty}`);
            });
            returnedUidsMap.set(itemId, list);
        });

        // Generate Workbook
        const workbook = new ExcelJS.Workbook();
        workbook.creator = operator;
        workbook.created = new Date();

        const bomSheet = workbook.addWorksheet('Material BOM Details');
        bomSheet.views = [{ showGridLines: true }];

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

        for (let r = 1; r <= 9; r++) {
            const row = bomSheet.getRow(r);
            row.getCell(1).font = { bold: true };
            row.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
            row.getCell(2).alignment = { vertical: 'middle', horizontal: 'left' };
        }

        bomSheet.addRow([]);
        bomSheet.addRow([]);

        const bomHeaders = [
            'Sl No',
            'VEPL Part No',
            'Description',
            'Manufacturer',
            'Mfr. Part No',
            'Qty / Product',
            'Required Qty',
            'Issued Qty',
            'UID Issued',
            'Issued Delta',
            'Return UID',
            'Return Qty',
            'Return Delta'
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

        bomItems.forEach((item, index) => {
            const rowIndex = 13 + index;
            const qtyPerProd = item.qty_per_product !== null ? parseFloat(item.qty_per_product) : 0;
            const reqQty = item.required_qty !== null ? parseFloat(item.required_qty) : 0;
            const issuedQty = item.issued_qty !== null ? parseFloat(item.issued_qty) : 0;
            const deltaQtyVal = item.delta_qty !== null ? parseFloat(item.delta_qty) : 0;
            const returnQtyVal = item.return_qty !== null ? parseFloat(item.return_qty) : 0;
            const returnDeltaVal = item.return_delta !== null ? parseFloat(item.return_delta) : 0;
            
            const uidsStr = (uidsMap.get(item.material_management_item_id) || []).join('\n');
            const retUidsStr = (returnedUidsMap.get(item.material_management_item_id) || []).join('\n');

            bomSheet.addRow([
                item.sl_no || '',
                item.vepl_part_no || '',
                item.description || '',
                item.manufacturer || '',
                item.mfr_part_no || '',
                qtyPerProd,
                reqQty,
                issuedQty,
                uidsStr,
                deltaQtyVal,
                retUidsStr,
                returnQtyVal,
                returnDeltaVal
            ]);

            const row = bomSheet.getRow(rowIndex);
            const isEven = rowIndex % 2 === 0;
            const rowBgColor = isEven ? 'FFF8FAFC' : 'FFFFFFFF';

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

                if (colIndex === 3 || colIndex === 4 || colIndex === 5 || colIndex === 9 || colIndex === 11) {
                    cell.alignment = { 
                        vertical: 'middle', 
                        horizontal: 'left', 
                        wrapText: true 
                    };
                } else if (colIndex === 1 || colIndex === 2) {
                    cell.alignment = { 
                        vertical: 'middle', 
                        horizontal: 'center' 
                    };
                } else {
                    cell.numFmt = '#,##0.00';
                    cell.alignment = { 
                        vertical: 'middle', 
                        horizontal: 'right' 
                    };
                }
            });

            // Adjust row height
            let maxLines = 1;
            [item.description, item.manufacturer, item.mfr_part_no, uidsStr, retUidsStr].forEach((text) => {
                if (text) {
                    const lines = text.toString().split('\n').length;
                    if (lines > maxLines) maxLines = lines;
                    const charLimit = 40;
                    const wrapLines = Math.ceil(text.toString().length / charLimit);
                    if (wrapLines > maxLines) maxLines = wrapLines;
                }
            });
            row.height = maxLines * 16 + 10;
        });

        const colWidths = [10, 20, 40, 40, 40, 15, 15, 15, 25, 15, 25, 15, 15];
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

/**
 * POST /api/material-management/records/:id/scan
 * Process scanned material barcode, parsing it and updating scan tables dynamically
 */
export const scanMaterialBarcode = async (req: Request, res: Response) => {
    const { id } = req.params; // material_management ID
    const { material_management_item_id, barcode } = req.body;
    const operator = getOperator(req);

    if (!material_management_item_id || !barcode) {
        return res.status(400).json({ error: 'BOM item ID and barcode are required.' });
    }

    let parsed;
    try {
        parsed = parseSMTBarcode(barcode);
    } catch (parseErr: any) {
        return res.status(400).json({ error: parseErr.message });
    }

    const { uid, veplPartNo, quantity } = parsed;
    const sanitized = barcode.trim().replace(/[\r\n]+/g, '');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Fetch the BOM item and master record details (locked for update)
        const itemRes = await client.query(`
            SELECT mmi.*, mm.status, mm.work_order_number
            FROM material_management_items mmi
            JOIN material_management mm ON mmi.material_management_id = mm.id
            WHERE mmi.id = $1 FOR UPDATE
        `, [material_management_item_id]);

        if (itemRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'BOM item not found.' });
        }

        const item = itemRes.rows[0];
        const status = item.status;
        const vepl_part_no = item.vepl_part_no;
        const required_qty = parseFloat(item.required_qty);
        const material_request_number = item.work_order_number;

        // 2. Validate request status
        if (status === 'COMPLETED' || status === 'CLOSED') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Cannot scan barcode for completed or closed request.' });
        }

        // 3. Validate part number (case insensitive, trimmed)
        if (veplPartNo.trim().toUpperCase() !== vepl_part_no.trim().toUpperCase()) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Material does not belong to this BOM.' });
        }

        // 4. Validate duplicate scans (in the same material request item) - Lock for update to prevent concurrent duplicates
        const duplicateRes = await client.query(`
            SELECT 1 FROM issued_material_details 
            WHERE material_request_item_id = $1 AND uid = $2 FOR UPDATE
        `, [material_management_item_id, uid]);

        if (duplicateRes.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'This UID has already been scanned.' });
        }

        // 5. Over-issuance check
        const sumRes = await client.query(`
            SELECT COALESCE(SUM(issued_qty), 0) AS current_issued
            FROM issued_material_details
            WHERE material_request_item_id = $1
        `, [material_management_item_id]);
        
        const current_issued = parseFloat(sumRes.rows[0].current_issued);

        if (current_issued >= required_qty) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'This scan exceeds the required quantity.' });
        }

        // 6. Perform insertions with raw_barcode and server-side remaining_qty initialization
        await client.query(`
            INSERT INTO issued_material_details (
                material_request_item_id, uid, vepl_part_no, issued_qty, remaining_qty, scanned_by, raw_barcode
            ) VALUES ($1, $2, $3, $4, $4, $5, $6)
        `, [material_management_item_id, uid, vepl_part_no, quantity, operator, sanitized]);

        await client.query(`
            INSERT INTO material_management_audit_logs (
                material_request_number, vepl_part_no, uid, quantity, operator, action
            ) VALUES ($1, $2, $3, $4, $5, 'Material Issued')
        `, [material_request_number, vepl_part_no, uid, quantity, operator]);

        await client.query(`
            UPDATE material_management
            SET updated_by = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
        `, [operator, item.material_management_id]);

        await client.query('COMMIT');

        // 7. Calculate and return updated stats
        const listRes = await client.query(`
            SELECT 
                imd.uid, 
                imd.issued_qty, 
                imd.remaining_qty, 
                imd.scanned_by, 
                imd.scanned_at,
                COALESCE(ret.returned_qty, 0) AS returned_qty
            FROM issued_material_details imd
            LEFT JOIN (
                SELECT 
                    issued_material_detail_id, 
                    SUM(returned_qty) AS returned_qty
                FROM returned_material_details
                GROUP BY issued_material_detail_id
            ) ret ON ret.issued_material_detail_id = imd.id
            WHERE imd.material_request_item_id = $1
            ORDER BY imd.scanned_at ASC
        `, [material_management_item_id]);

        const issued_uids = listRes.rows.map(r => ({
            uid: r.uid,
            issued_qty: parseFloat(r.issued_qty),
            remaining_qty: parseFloat(r.remaining_qty),
            returned_qty: parseFloat(r.returned_qty),
            scanned_by: r.scanned_by,
            scanned_at: r.scanned_at
        }));

        const returnedRes = await client.query(`
            SELECT 
                rmd.uid, 
                rmd.returned_qty, 
                rmd.remaining_qty_after, 
                rmd.returned_by, 
                rmd.returned_at
            FROM returned_material_details rmd
            JOIN issued_material_details imd ON rmd.issued_material_detail_id = imd.id
            WHERE imd.material_request_item_id = $1
            ORDER BY rmd.returned_at ASC
        `, [material_management_item_id]);

        const returned_uids = returnedRes.rows.map(r => ({
            uid: r.uid,
            returned_qty: parseFloat(r.returned_qty),
            remaining_qty_after: parseFloat(r.remaining_qty_after),
            returned_by: r.returned_by,
            returned_at: r.returned_at
        }));

        const new_issued_qty = issued_uids.reduce((sum, r) => sum + r.issued_qty, 0);
        const new_return_qty = returned_uids.reduce((sum, r) => sum + r.returned_qty, 0);
        const new_delta_qty = new_issued_qty - required_qty;
        const new_return_delta = new_issued_qty - new_return_qty;

        return res.status(200).json({
            material_request_item_id: material_management_item_id,
            required_qty,
            issued_qty: new_issued_qty,
            delta_qty: new_delta_qty,
            issued_delta: new_delta_qty,
            return_qty: new_return_qty,
            return_delta: new_return_delta,
            total_uid_count: issued_uids.length,
            issued_uids,
            returned_uids,
            message: 'Material scanned successfully.'
        });

    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error(`Error scanning barcode for record ${id}:`, err);
        return res.status(500).json({ error: 'Failed to process barcode scan.' });
    } finally {
        client.release();
    }
};

/**
 * POST /api/material-management/records/:id/return-scan
 * Process scanned return barcode, performing row locking, validation, and audit log generation
 */
export const scanReturnBarcode = async (req: Request, res: Response) => {
    const { id } = req.params; // material_management ID
    const { material_management_item_id, barcode } = req.body;
    const operator = getOperator(req);

    if (!material_management_item_id || !barcode) {
        return res.status(400).json({ error: 'BOM item ID and barcode are required.' });
    }

    let parsed;
    try {
        parsed = parseSMTBarcode(barcode);
    } catch (parseErr: any) {
        return res.status(400).json({ error: parseErr.message });
    }

    const { uid, veplPartNo, quantity: returnQtyVal } = parsed;
    const sanitized = barcode.trim().replace(/[\r\n]+/g, '');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Fetch the BOM item details (locked for update)
        const itemRes = await client.query(`
            SELECT mmi.*, mm.status, mm.work_order_number
            FROM material_management_items mmi
            JOIN material_management mm ON mmi.material_management_id = mm.id
            WHERE mmi.id = $1 FOR UPDATE
        `, [material_management_item_id]);

        if (itemRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'BOM item not found.' });
        }

        const item = itemRes.rows[0];
        const status = item.status;
        const vepl_part_no = item.vepl_part_no;
        const required_qty = parseFloat(item.required_qty);
        const material_request_number = item.work_order_number;

        // 2. Validate request status (block CLOSED)
        if (status === 'CLOSED') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Cannot scan returns for a closed request.' });
        }

        // 3. Lock matching issued_material_details record by UID and material_management_id
        const issueRes = await client.query(`
            SELECT imd.id, imd.material_request_item_id, imd.issued_qty, imd.remaining_qty, imd.vepl_part_no 
            FROM issued_material_details imd
            JOIN material_management_items mmi ON imd.material_request_item_id = mmi.id
            WHERE mmi.material_management_id = $1 AND imd.uid = $2
            FOR UPDATE
        `, [id, uid]);

        if (issueRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'The UID was never requested.' });
        }

        const issueRecord = issueRes.rows[0];

        // 4. Validate part number from barcode matches requested part number for this UID
        if (veplPartNo.trim().toUpperCase() !== issueRecord.vepl_part_no.trim().toUpperCase()) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'The VEPL Part Number does not match the requested UID.' });
        }

        // 5. For modal-based return scan, make sure it belongs to the BOM item we are scanning for in the modal
        if (issueRecord.material_request_item_id !== material_management_item_id) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'This UID belongs to a different BOM item.' });
        }

        const currentRemaining = parseFloat(issueRecord.remaining_qty);

        // 6. Validate remaining quantity of this UID
        if (currentRemaining <= 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'This UID has already been fully returned.' });
        }

        if (returnQtyVal > currentRemaining) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Return quantity exceeds the remaining quantity for this UID.' });
        }

        const remainingAfter = currentRemaining - returnQtyVal;

        // 6. Perform insertions & updates
        await client.query(`
            INSERT INTO returned_material_details (
                issued_material_detail_id, uid, returned_qty, remaining_qty_after, raw_barcode, returned_by
            ) VALUES ($1, $2, $3, $4, $5, $6)
        `, [issueRecord.id, uid, returnQtyVal, remainingAfter, sanitized, operator]);

        await client.query(`
            UPDATE issued_material_details
            SET remaining_qty = $1
            WHERE id = $2
        `, [remainingAfter, issueRecord.id]);

        await client.query(`
            INSERT INTO material_management_audit_logs (
                material_request_number, vepl_part_no, uid, quantity, operator, action
            ) VALUES ($1, $2, $3, $4, $5, 'Material Returned')
        `, [material_request_number, vepl_part_no, uid, returnQtyVal, operator]);

        await client.query(`
            UPDATE material_management
            SET updated_by = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
        `, [operator, item.material_management_id]);

        await client.query('COMMIT');

        // 7. Calculate and return updated stats
        const listRes = await client.query(`
            SELECT 
                imd.uid, 
                imd.issued_qty, 
                imd.remaining_qty, 
                imd.scanned_by, 
                imd.scanned_at,
                COALESCE(ret.returned_qty, 0) AS returned_qty
            FROM issued_material_details imd
            LEFT JOIN (
                SELECT 
                    issued_material_detail_id, 
                    SUM(returned_qty) AS returned_qty
                FROM returned_material_details
                GROUP BY issued_material_detail_id
            ) ret ON ret.issued_material_detail_id = imd.id
            WHERE imd.material_request_item_id = $1
            ORDER BY imd.scanned_at ASC
        `, [material_management_item_id]);

        const issued_uids = listRes.rows.map(r => ({
            uid: r.uid,
            issued_qty: parseFloat(r.issued_qty),
            remaining_qty: parseFloat(r.remaining_qty),
            returned_qty: parseFloat(r.returned_qty),
            scanned_by: r.scanned_by,
            scanned_at: r.scanned_at
        }));

        const returnedRes = await client.query(`
            SELECT 
                rmd.uid, 
                rmd.returned_qty, 
                rmd.remaining_qty_after, 
                rmd.returned_by, 
                rmd.returned_at
            FROM returned_material_details rmd
            JOIN issued_material_details imd ON rmd.issued_material_detail_id = imd.id
            WHERE imd.material_request_item_id = $1
            ORDER BY rmd.returned_at ASC
        `, [material_management_item_id]);

        const returned_uids = returnedRes.rows.map(r => ({
            uid: r.uid,
            returned_qty: parseFloat(r.returned_qty),
            remaining_qty_after: parseFloat(r.remaining_qty_after),
            returned_by: r.returned_by,
            returned_at: r.returned_at
        }));

        const new_issued_qty = issued_uids.reduce((sum, r) => sum + r.issued_qty, 0);
        const new_return_qty = returned_uids.reduce((sum, r) => sum + r.returned_qty, 0);
        const new_delta_qty = new_issued_qty - required_qty;
        const new_return_delta = new_issued_qty - new_return_qty;

        return res.status(200).json({
            material_request_item_id: material_management_item_id,
            required_qty,
            issued_qty: new_issued_qty,
            delta_qty: new_delta_qty,
            issued_delta: new_delta_qty,
            return_qty: new_return_qty,
            return_delta: new_return_delta,
            total_uid_count: issued_uids.length,
            issued_uids,
            returned_uids,
            message: 'Material returned successfully.'
        });

    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error(`Error scanning return barcode for record ${id}:`, err);
        return res.status(500).json({ error: 'Failed to process return barcode scan.' });
    } finally {
        client.release();
    }
};

/**
 * POST /api/material-management/global-scan
 * High-speed global barcode scanner API supporting issue/return modes
 */
export const globalScanBarcode = async (req: Request, res: Response) => {
    const { material_management_id, mode, barcode } = req.body;
    const operator = getOperator(req);

    if (!material_management_id || !mode || !barcode) {
        return res.status(400).json({ error: 'material_management_id, mode, and barcode are required.' });
    }

    if (mode !== 'request' && mode !== 'return') {
        return res.status(400).json({ error: "Invalid mode. Mode must be 'request' or 'return'." });
    }

    let parsed;
    try {
        parsed = parseSMTBarcode(barcode);
    } catch (parseErr: any) {
        return res.status(400).json({ error: parseErr.message });
    }

    const { uid, veplPartNo, quantity } = parsed;
    const sanitized = barcode.trim().replace(/[\r\n]+/g, '');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Locate the matching BOM item using material_management_id and veplPartNo (case-insensitive)
        const itemRes = await client.query(`
            SELECT mmi.*, mm.status, mm.work_order_number
            FROM material_management_items mmi
            JOIN material_management mm ON mmi.material_management_id = mm.id
            WHERE mmi.material_management_id = $1 AND UPPER(TRIM(mmi.vepl_part_no)) = UPPER(TRIM($2))
            FOR UPDATE
        `, [material_management_id, veplPartNo]);

        if (itemRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: `VEPL Part Number ${veplPartNo} not found in current BOM.` });
        }

        const item = itemRes.rows[0];
        const status = item.status;
        const vepl_part_no = item.vepl_part_no;
        const required_qty = parseFloat(item.required_qty);
        const material_request_number = item.work_order_number;
        let material_management_item_id = item.id;

        if (mode === 'request') {
            // 2. Validate request status (block completed or closed)
            if (status === 'COMPLETED' || status === 'CLOSED') {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Cannot scan barcode for completed or closed request.' });
            }

            // 3. Validate duplicate scans (in the same material request item) - Lock for update
            const duplicateRes = await client.query(`
                SELECT 1 FROM issued_material_details 
                WHERE material_request_item_id = $1 AND uid = $2 FOR UPDATE
            `, [material_management_item_id, uid]);

            if (duplicateRes.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'This UID has already been scanned.' });
            }

            // 4. Over-issuance check
            const sumRes = await client.query(`
                SELECT COALESCE(SUM(issued_qty), 0) AS current_issued
                FROM issued_material_details
                WHERE material_request_item_id = $1
            `, [material_management_item_id]);
            
            const current_issued = parseFloat(sumRes.rows[0].current_issued);

            if (current_issued >= required_qty) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'This scan exceeds the required quantity.' });
            }

            // 5. Perform insertions with raw_barcode
            await client.query(`
                INSERT INTO issued_material_details (
                    material_request_item_id, uid, vepl_part_no, issued_qty, remaining_qty, scanned_by, raw_barcode
                ) VALUES ($1, $2, $3, $4, $4, $5, $6)
            `, [material_management_item_id, uid, vepl_part_no, quantity, operator, sanitized]);

            await client.query(`
                INSERT INTO material_management_audit_logs (
                    material_request_number, vepl_part_no, uid, quantity, operator, action
                ) VALUES ($1, $2, $3, $4, $5, 'Material Issued')
            `, [material_request_number, vepl_part_no, uid, quantity, operator]);

        } else {
            // mode === 'return'
            // 2. Validate request status (block CLOSED)
            if (status === 'CLOSED') {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Cannot scan returns for a closed request.' });
            }

            // 3. Lock matching issued record by UID and material_management_id
            const issueRes = await client.query(`
                SELECT imd.id, imd.material_request_item_id, imd.issued_qty, imd.remaining_qty, imd.vepl_part_no
                FROM issued_material_details imd
                JOIN material_management_items mmi ON imd.material_request_item_id = mmi.id
                WHERE mmi.material_management_id = $1 AND imd.uid = $2
                FOR UPDATE
            `, [material_management_id, uid]);

            if (issueRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'The UID was never requested.' });
            }

            const issueRecord = issueRes.rows[0];

            // Validate part number from barcode matches requested part number for this UID
            if (veplPartNo.trim().toUpperCase() !== issueRecord.vepl_part_no.trim().toUpperCase()) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'The VEPL Part Number does not match the requested UID.' });
            }

            // Update local material_management_item_id to match the issueRecord's item id
            // this ensures we update the correct BOM item row statistics
            material_management_item_id = issueRecord.material_request_item_id;

            const currentRemaining = parseFloat(issueRecord.remaining_qty);

            // 4. Validate remaining qty
            if (currentRemaining <= 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'This UID has already been fully returned.' });
            }

            if (quantity > currentRemaining) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Return quantity exceeds the remaining quantity for this UID.' });
            }

            const remainingAfter = currentRemaining - quantity;

            // 5. Insert return and update issue remaining
            await client.query(`
                INSERT INTO returned_material_details (
                    issued_material_detail_id, uid, returned_qty, remaining_qty_after, raw_barcode, returned_by
                ) VALUES ($1, $2, $3, $4, $5, $6)
            `, [issueRecord.id, uid, quantity, remainingAfter, sanitized, operator]);

            await client.query(`
                UPDATE issued_material_details
                SET remaining_qty = $1
                WHERE id = $2
            `, [remainingAfter, issueRecord.id]);

            await client.query(`
                INSERT INTO material_management_audit_logs (
                    material_request_number, vepl_part_no, uid, quantity, operator, action
                ) VALUES ($1, $2, $3, $4, $5, 'Material Returned')
            `, [material_request_number, vepl_part_no, uid, quantity, operator]);
        }

        // Update the material_management updated_at timestamp
        await client.query(`
            UPDATE material_management
            SET updated_by = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
        `, [operator, material_management_id]);

        await client.query('COMMIT');

        // 6. Fetch updated BOM row data
        const listRes = await client.query(`
            SELECT 
                imd.uid, 
                imd.issued_qty, 
                imd.remaining_qty, 
                imd.scanned_by, 
                imd.scanned_at,
                COALESCE(ret.returned_qty, 0) AS returned_qty
            FROM issued_material_details imd
            LEFT JOIN (
                SELECT 
                    issued_material_detail_id, 
                    SUM(returned_qty) AS returned_qty
                FROM returned_material_details
                GROUP BY issued_material_detail_id
            ) ret ON ret.issued_material_detail_id = imd.id
            WHERE imd.material_request_item_id = $1
            ORDER BY imd.scanned_at ASC
        `, [material_management_item_id]);

        const issued_uids = listRes.rows.map(r => ({
            uid: r.uid,
            issued_qty: parseFloat(r.issued_qty),
            remaining_qty: parseFloat(r.remaining_qty),
            returned_qty: parseFloat(r.returned_qty),
            scanned_by: r.scanned_by,
            scanned_at: r.scanned_at
        }));

        const returnedRes = await client.query(`
            SELECT 
                rmd.uid, 
                rmd.returned_qty, 
                rmd.remaining_qty_after, 
                rmd.returned_by, 
                rmd.returned_at
            FROM returned_material_details rmd
            JOIN issued_material_details imd ON rmd.issued_material_detail_id = imd.id
            WHERE imd.material_request_item_id = $1
            ORDER BY rmd.returned_at ASC
        `, [material_management_item_id]);

        const returned_uids = returnedRes.rows.map(r => ({
            uid: r.uid,
            returned_qty: parseFloat(r.returned_qty),
            remaining_qty_after: parseFloat(r.remaining_qty_after),
            returned_by: r.returned_by,
            returned_at: r.returned_at
        }));

        const new_issued_qty = issued_uids.reduce((sum, r) => sum + r.issued_qty, 0);
        const new_return_qty = returned_uids.reduce((sum, r) => sum + r.returned_qty, 0);
        const new_delta_qty = new_issued_qty - required_qty;
        const new_return_delta = new_issued_qty - new_return_qty;

        const updated_row = {
            id: material_management_item_id,
            material_management_id,
            qms_bom_item_id: item.qms_bom_item_id,
            vepl_part_no: item.vepl_part_no,
            description: item.description,
            manufacturer: item.manufacturer,
            mfr_part_no: item.mfr_part_no,
            qty_per_product: parseFloat(item.qty_per_product),
            required_qty,
            issued_qty: new_issued_qty,
            delta_qty: new_delta_qty,
            issued_delta: new_delta_qty,
            return_qty: new_return_qty,
            return_delta: new_return_delta,
            total_uid_count: issued_uids.length,
            issued_uids,
            returned_uids
        };

        // 7. Retrieve updated summary statistics for the record
        const summaryRes = await pool.query(`
            SELECT 
                COALESCE(stats.total_components, 0)::int AS total_components,
                COALESCE(stats.total_request_scanned, 0)::int AS total_request_scanned,
                COALESCE(stats.total_return_scanned, 0)::int AS total_return_scanned
            FROM material_management mm
            LEFT JOIN (
                SELECT 
                    mmi.material_management_id,
                    COUNT(*)::int AS total_components,
                    COUNT(CASE WHEN COALESCE(issued_agg.issued_sum, 0) > 0 THEN 1 END)::int AS total_request_scanned,
                    COUNT(CASE WHEN COALESCE(returned_agg.returned_sum, 0) > 0 THEN 1 END)::int AS total_return_scanned
                FROM material_management_items mmi
                LEFT JOIN (
                    SELECT material_request_item_id, SUM(issued_qty) AS issued_sum
                    FROM issued_material_details
                    GROUP BY material_request_item_id
                ) issued_agg ON mmi.id = issued_agg.material_request_item_id
                LEFT JOIN (
                    SELECT imd.material_request_item_id, SUM(rmd.returned_qty) AS returned_sum
                    FROM returned_material_details rmd
                    JOIN issued_material_details imd ON rmd.issued_material_detail_id = imd.id
                    GROUP BY imd.material_request_item_id
                ) returned_agg ON mmi.id = returned_agg.material_request_item_id
                GROUP BY mmi.material_management_id
            ) stats ON mm.id = stats.material_management_id
            WHERE mm.id = $1;
        `, [material_management_id]);

        const summary = summaryRes.rows[0] || {
            total_components: 0,
            total_request_scanned: 0,
            total_return_scanned: 0
        };

        return res.status(200).json({
            success: true,
            message: mode === 'request' ? 'Material issued successfully.' : 'Material returned successfully.',
            updated_row_id: material_management_item_id,
            updated_row,
            summary,
            scanned_info: {
                uid,
                veplPartNo,
                quantity
            }
        });

    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error(`Error in globalScanBarcode for record ${material_management_id}:`, err);
        return res.status(500).json({ error: err.message || 'Failed to process global barcode scan.' });
    } finally {
        client.release();
    }
};
