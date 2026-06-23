import { Request, Response } from 'express';
import * as ExcelJS from 'exceljs';
import pool from '../config/db';
import { createLogger } from '../utils/logger';

const logger = createLogger('MaterialReturn');

// Helper to get user operator details
const getOperator = (req: Request): string => {
    const user = (req as any).user;
    return user?.name || user?.email || 'Unknown Operator';
};

/**
 * GET /api/material-return/eligible-wos
 * Fetch all work orders where a completed/closed Material Request exists (status IN ('COMPLETED', 'CLOSED')) 
 * and no Material Return record exists yet
 */
export const getEligibleWorkOrders = async (req: Request, res: Response) => {
    try {
        const query = `
            SELECT 
                mm.id AS material_management_id,
                mm.qms_id,
                mm.work_order_id,
                mm.work_order_number,
                mm.po_number,
                mm.product_name,
                mm.product_description,
                mm.quantity,
                mm.bom_revision_number AS current_bom_revision
            FROM material_management mm
            WHERE mm.status IN ('COMPLETED', 'CLOSED')
              AND NOT EXISTS (
                  SELECT 1 
                  FROM material_return mr 
                  WHERE mr.material_management_id = mm.id
              )
            ORDER BY mm.work_order_number ASC;
        `;
        const result = await pool.query(query);
        res.status(200).json(result.rows);
    } catch (err: any) {
        logger.error('Error fetching eligible work orders for returns:', err);
        res.status(500).json({ error: 'Failed to fetch eligible work orders.' });
    }
};

/**
 * POST /api/material-return/create
 * Create a new Material Return record (DRAFT) snapshotting WO/QMS details and locked BOM revision
 */
export const createMaterialReturn = async (req: Request, res: Response) => {
    const { work_order_id, qms_id, remarks, material_management_id } = req.body;
    const operator = getOperator(req);

    if (!work_order_id || !qms_id || !material_management_id) {
        return res.status(400).json({ error: 'Work Order ID, QMS ID, and Material Management ID are required.' });
    }

    try {
        // Enforce duplicate record check: only one Material Return record per Material Request
        const checkExisting = await pool.query(`
            SELECT id FROM material_return WHERE material_management_id = $1
        `, [material_management_id]);

        if (checkExisting.rows.length > 0) {
            return res.status(200).json({ 
                message: 'Material Return record already exists. Opening existing record.',
                record: checkExisting.rows[0],
                alreadyExists: true
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

        // Fetch current BOM revision from Document Process (QMS)
        const bomRevRes = await pool.query(`
            SELECT revision_number FROM qms_bom_revisions 
            WHERE qms_id = $1 
            ORDER BY id DESC LIMIT 1
        `, [qms_id]);

        const current_bom_revision = bomRevRes.rows.length > 0 ? bomRevRes.rows[0].revision_number : '1.1';

        // Insert Master
        const insertQuery = `
            INSERT INTO material_return (
                material_management_id, work_order_id, qms_id, work_order_number, po_number, product_name, 
                product_description, quantity, current_bom_revision, status, remarks, created_by, updated_by
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, 'DRAFT', $10, $11, $11
            ) RETURNING *;
        `;
        const result = await pool.query(insertQuery, [
            material_management_id,
            wo.id,
            qms.id,
            wo.id,
            qms.po_number || null,
            wo.product_name || null,
            wo.product_description || null,
            wo.quantity,
            current_bom_revision,
            remarks || null,
            operator
        ]);

        res.status(201).json({ 
            message: 'Material Return record created successfully in DRAFT state.',
            record: result.rows[0]
        });
    } catch (err: any) {
        logger.error('Error creating material return record:', err);
        res.status(500).json({ error: 'Failed to create Material Return record.' });
    }
};

/**
 * GET /api/material-return/records
 * Fetch all return records, dynamically joining current_bom_revision
 */
export const getMaterialReturnRecords = async (req: Request, res: Response) => {
    try {
        const query = `
            SELECT 
                mr.*,
                mm.bom_revision_number AS current_bom_revision
            FROM material_return mr
            JOIN material_management mm ON mr.material_management_id = mm.id
            ORDER BY mr.updated_at DESC;
        `;
        const result = await pool.query(query);
        res.status(200).json(result.rows);
    } catch (err: any) {
        logger.error('Error fetching material return records:', err);
        res.status(500).json({ error: 'Failed to fetch Material Return records.' });
    }
};

/**
 * GET /api/material-return/records/:id
 * Fetch complete details of a specific record by UUID including dynamic totals
 */
export const getMaterialReturnDetail = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const query = `
            SELECT 
                mr.*,
                mm.bom_revision_number AS current_bom_revision,
                (
                    SELECT COALESCE(COUNT(mmi.id), 0)
                    FROM material_management_items mmi
                    WHERE mmi.material_management_id = mr.material_management_id
                      AND mmi.sl_no ~ '^[0-9]+$'
                ) AS total_components,
                (
                    SELECT COALESCE(SUM(mmi.issued_qty), 0)
                    FROM material_management_items mmi
                    WHERE mmi.material_management_id = mr.material_management_id
                      AND mmi.sl_no ~ '^[0-9]+$'
                ) AS total_issued_qty,
                (
                    SELECT COALESCE(SUM(mri.return_qty), 0)
                    FROM material_return_items mri
                    WHERE mri.material_return_id = mr.id
                ) AS total_return_qty,
                (
                    SELECT COALESCE(SUM(mmi.issued_qty - COALESCE(mri.return_qty, 0)), 0)
                    FROM material_management_items mmi
                    LEFT JOIN material_return_items mri 
                        ON mri.material_management_item_id = mmi.id 
                        AND mri.material_return_id = mr.id
                    WHERE mmi.material_management_id = mr.material_management_id
                      AND mmi.sl_no ~ '^[0-9]+$'
                ) AS total_delta_qty,
                qm.bom_file_path,
                qm.ecn_file_path,
                qm.assembly_drawing_file_path,
                qm.files_metadata,
                wo.po_document_name,
                wo.po_document_path,
                wo.po_document_type
            FROM material_return mr
            JOIN material_management mm ON mr.material_management_id = mm.id
            JOIN qms_master qm ON mr.qms_id = qm.id
            JOIN smt_work_orders wo ON mr.work_order_id = wo.id
            WHERE mr.id = $1;
        `;
        const result = await pool.query(query, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Material Return record not found.' });
        }

        res.status(200).json(result.rows[0]);
    } catch (err: any) {
        logger.error(`Error fetching detail for return record ${id}:`, err);
        res.status(500).json({ error: 'Failed to fetch record details.' });
    }
};

/**
 * GET /api/material-return/records/:id/bom
 * Fetch BOM items dynamically joining latest Material Request BOM (material_management_items)
 * and left-joining saved return quantites (material_return_items)
 */
export const getMaterialReturnBom = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        // Fetch Master Return Record
        const masterRes = await pool.query(`
            SELECT material_management_id FROM material_return WHERE id = $1
        `, [id]);

        if (masterRes.rows.length === 0) {
            return res.status(404).json({ error: 'Material Return record not found.' });
        }

        const { material_management_id } = masterRes.rows[0];

        // Fetch current BOM revision from the Material Request
        const mmRes = await pool.query(`
            SELECT bom_revision_number FROM material_management WHERE id = $1
        `, [material_management_id]);
        const current_bom_revision = mmRes.rows.length > 0 ? mmRes.rows[0].bom_revision_number : '1.1';

        // Load items from the latest synchronized Material Request BOM
        const query = `
            SELECT 
                mmi.id AS material_management_item_id,
                mmi.sl_no,
                mmi.vepl_part_no,
                mmi.description,
                mmi.manufacturer,
                mmi.mfr_part_no,
                mmi.qty_per_product,
                mmi.required_qty,
                mmi.issued_qty,
                COALESCE(mri.return_qty, 0) AS return_qty,
                (mmi.issued_qty - COALESCE(mri.return_qty, 0)) AS delta_qty,
                mri.remarks
            FROM material_management_items mmi
            LEFT JOIN material_return_items mri 
                ON mri.material_management_item_id = mmi.id 
                AND mri.material_return_id = $1
            WHERE mmi.material_management_id = $2 AND mmi.sl_no ~ '^[0-9]+$'
            ORDER BY mmi.id ASC;
        `;
        const itemsRes = await pool.query(query, [id, material_management_id]);
        const items = itemsRes.rows;

        // Perform strict numerical sort by sl_no
        items.sort((a, b) => {
            const numA = parseInt(a.sl_no, 10) || 999999;
            const numB = parseInt(b.sl_no, 10) || 999999;
            return numA - numB;
        });

        res.status(200).json({
            current_bom_revision,
            items
        });
    } catch (err: any) {
        logger.error(`Error fetching return BOM for record ${id}:`, err);
        res.status(500).json({ error: 'Failed to fetch return BOM.' });
    }
};

/**
 * POST /api/material-return/records/:id/bom
 * Save return quantities and remarks, validating return_qty <= issued_qty
 */
export const saveMaterialReturnBom = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { items, remarks, status } = req.body;
    const operator = getOperator(req);

    if (!Array.isArray(items)) {
        return res.status(400).json({ error: 'BOM items must be an array.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Fetch Master Return Record
        const masterRes = await client.query(`
            SELECT material_management_id, qms_id FROM material_return WHERE id = $1 FOR UPDATE
        `, [id]);

        if (masterRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Material Return record not found.' });
        }

        const { material_management_id, qms_id } = masterRes.rows[0];

        // Loop and upsert with validation
        for (const item of items) {
            const { material_management_item_id, return_qty, remarks: itemRemarks } = item;

            // Fetch latest issued_qty from Material Request items
            const mmiRes = await client.query(`
                SELECT issued_qty FROM material_management_items 
                WHERE id = $1 AND material_management_id = $2
            `, [material_management_item_id, material_management_id]);

            if (mmiRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Material Request item not found.' });
            }

            const issuedQty = parseFloat(mmiRes.rows[0].issued_qty || '0');
            const returnQtyVal = parseFloat(return_qty || '0');

            // Validation: Return Qty cannot exceed Issued Qty
            if (returnQtyVal > issuedQty) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Return Qty cannot exceed Issued Qty.' });
            }

            // UPSERT
            await client.query(`
                INSERT INTO material_return_items (
                    material_return_id, material_management_item_id, return_qty, remarks, created_by, updated_by
                ) VALUES (
                    $1, $2, $3, $4, $5, $5
                )
                ON CONFLICT (material_return_id, material_management_item_id)
                DO UPDATE SET
                    return_qty = EXCLUDED.return_qty,
                    remarks = EXCLUDED.remarks,
                    updated_by = EXCLUDED.updated_by,
                    updated_at = CURRENT_TIMESTAMP;
            `, [
                id,
                material_management_item_id,
                returnQtyVal,
                itemRemarks || null,
                operator
            ]);
        }

        // Fetch latest BOM revision from Document Process (QMS) to update in master
        const bomRevRes = await client.query(`
            SELECT revision_number FROM qms_bom_revisions 
            WHERE qms_id = $1 
            ORDER BY id DESC LIMIT 1
        `, [qms_id]);
        const current_bom_revision = bomRevRes.rows.length > 0 ? bomRevRes.rows[0].revision_number : '1.1';

        // Update master record status, remarks, and locked revision
        if (status) {
            await client.query(`
                UPDATE material_return
                SET status = $1,
                    remarks = COALESCE($2, remarks),
                    current_bom_revision = $3,
                    updated_by = $4,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $5
            `, [status, remarks || null, current_bom_revision, operator, id]);
        } else {
            await client.query(`
                UPDATE material_return
                SET current_bom_revision = $1,
                    updated_by = $2,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $3
            `, [current_bom_revision, operator, id]);
        }

        await client.query('COMMIT');
        res.status(200).json({ message: 'Material Return BOM saved successfully.' });
    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error(`Error saving return BOM items for record ${id}:`, err);
        res.status(500).json({ error: 'Failed to save return BOM items.' });
    } finally {
        client.release();
    }
};

/**
 * GET /api/material-return/records/:id/export/excel
 * Export Material Return Record summary and BOM items to a multi-sheet Excel file.
 */
export const exportMaterialReturnExcel = async (req: Request, res: Response) => {
    const { id } = req.params;
    const operator = getOperator(req);
    const generatedDateStr = new Date().toLocaleString();

    try {
        // Fetch Master Return Record
        const recordQuery = await pool.query(`
            SELECT mr.*, qm.quantity AS original_quantity
            FROM material_return mr
            JOIN qms_master qm ON mr.qms_id = qm.id
            WHERE mr.id = $1
        `, [id]);

        if (recordQuery.rows.length === 0) {
            return res.status(404).json({ error: 'Material Return record not found.' });
        }

        const record = recordQuery.rows[0];

        // Fetch detailed BOM items (calculated dynamically)
        const bomItemsQuery = await pool.query(`
            SELECT 
                mmi.id AS material_management_item_id,
                mmi.sl_no,
                mmi.vepl_part_no,
                mmi.description,
                mmi.manufacturer,
                mmi.mfr_part_no,
                mmi.qty_per_product,
                mmi.required_qty,
                mmi.issued_qty,
                COALESCE(mri.return_qty, 0) AS return_qty,
                (mmi.issued_qty - COALESCE(mri.return_qty, 0)) AS delta_qty,
                mri.remarks
            FROM material_management_items mmi
            LEFT JOIN material_return_items mri 
                ON mri.material_management_item_id = mmi.id 
                AND mri.material_return_id = $1
            WHERE mmi.material_management_id = $2 AND mmi.sl_no ~ '^[0-9]+$'
            ORDER BY mmi.id ASC;
        `, [id, record.material_management_id]);

        const bomItems = bomItemsQuery.rows;

        // Perform numerical sort by sl_no
        bomItems.sort((a, b) => {
            const numA = parseInt(a.sl_no, 10) || 999999;
            const numB = parseInt(b.sl_no, 10) || 999999;
            return numA - numB;
        });

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
        bomSheet.addRow(['Production Quantity', record.quantity]);
        bomSheet.addRow(['Current BOM Revision', record.current_bom_revision ? `Rev ${record.current_bom_revision}` : 'Rev 1.1']);
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
            'Return Qty',
            'Delta',
            'Remarks'
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
            const returnQtyVal = item.return_qty !== null ? parseFloat(item.return_qty) : 0;
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
                returnQtyVal,
                deltaQtyVal,
                item.remarks || ''
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
                if (colIndex === 3 || colIndex === 4 || colIndex === 5 || colIndex === 11) {
                    // Description, Manufacturer, Mfr. Part No, Remarks
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
            [item.description, item.manufacturer, item.mfr_part_no, item.remarks].forEach((text) => {
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
        const colWidths = [10, 20, 40, 40, 40, 15, 15, 15, 15, 15, 40];
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
            `attachment; filename="Material_Return_Report_${record.work_order_number}.xlsx"`
        );

        await workbook.xlsx.write(res);
        res.end();

    } catch (err: any) {
        logger.error(`Error exporting return Excel for record ${id}:`, err);
        res.status(500).json({ error: 'Failed to export Excel report.' });
    }
};
