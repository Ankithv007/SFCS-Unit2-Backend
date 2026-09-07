import { Request, Response } from 'express';
import pool from '../config/db';
import { createLogger } from '../utils/logger';
import * as ExcelJS from 'exceljs';

const logger = createLogger('ADMIN_DASHBOARD_CONTROLLER');

/**
 * Helper to safely format numbers and prevent NaN/null/Infinity
 */
const safeNumber = (val: any): number => {
    const num = Number(val);
    return isNaN(num) || !isFinite(num) ? 0 : num;
};

/**
 * Helper to format IST timestamp cleanly
 */
const formatTimestamp = (dateInput: any): string => {
    if (!dateInput) return 'Not Started';
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) return 'Not Started';

    return new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    }).format(date);
};

/**
 * GET /api/smt/admin/dashboard/live-work-orders
 * Returns active/in-progress Work Orders
 */
export const getLiveWorkOrders = async (req: Request, res: Response) => {
    try {
        const query = `
            SELECT wo.id, wo.product_name, wo.quantity, wo.created_at, wo.status, wo.model_name
            FROM smt_work_orders wo
            WHERE LOWER(COALESCE(wo.status, '')) NOT IN ('cancelled', 'deleted', 'completed')
            ORDER BY wo.created_at DESC
        `;
        const result = await pool.query(query);

        res.status(200).json({
            success: true,
            total: result.rows.length,
            workOrders: result.rows.map(r => ({
                id: r.id,
                product_name: r.product_name,
                quantity: safeNumber(r.quantity),
                created_at: r.created_at,
                status: r.status,
                model_name: r.model_name
            }))
        });
    } catch (err: any) {
        logger.error('Error fetching live work orders:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch live work orders',
            details: err.message
        });
    }
};

/**
 * GET /api/smt/admin/work-orders/search
 * Server-side debounced search for active & historical Work Orders
 */
export const searchWorkOrders = async (req: Request, res: Response) => {
    try {
        const q = req.query.q ? String(req.query.q).trim() : '';

        let query = `
            SELECT wo.id, wo.product_name, wo.quantity, wo.created_at, wo.status, wo.model_name, wo.po_id
            FROM smt_work_orders wo
        `;
        const params: any[] = [];

        if (q) {
            query += ` WHERE wo.id ILIKE $1 OR wo.product_name ILIKE $1 OR wo.po_id ILIKE $1 OR wo.model_name ILIKE $1`;
            params.push(`%${q}%`);
        }

        query += ` ORDER BY wo.created_at DESC LIMIT 20`;

        const result = await pool.query(query, params);

        res.status(200).json({
            success: true,
            workOrders: result.rows.map(r => ({
                id: r.id,
                product_name: r.product_name,
                quantity: safeNumber(r.quantity),
                created_at: r.created_at,
                status: r.status,
                model_name: r.model_name,
                po_id: r.po_id
            }))
        });
    } catch (err: any) {
        logger.error('Error searching work orders:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to search work orders',
            details: err.message
        });
    }
};

/**
 * GET /api/smt/admin/work-orders/:workOrderId/dashboard
 * Full production dashboard statistics for a single Work Order
 */
export const getWorkOrderDashboard = async (req: Request, res: Response) => {
    try {
        const { workOrderId } = req.params;
        const requestedDate = req.query.date ? String(req.query.date).trim() : '';

        if (!workOrderId) {
            return res.status(400).json({ success: false, error: 'Work Order ID is required' });
        }

        const dateParam = (requestedDate && requestedDate !== 'all' && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) ? requestedDate : null;

        // 1. Fetch Work Order Details
        const woRes = await pool.query(
            `SELECT id, quantity, created_at, status, product_name, model_name FROM smt_work_orders WHERE id = $1`,
            [workOrderId]
        );

        if (woRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Work Order not found' });
        }

        const wo = woRes.rows[0];
        const totalQuantity = safeNumber(wo.quantity);

        // Fetch distinct production dates for this Work Order
        const datesRes = await pool.query(
            `SELECT DISTINCT TO_CHAR(ts, 'YYYY-MM-DD') AS prod_date FROM (
                SELECT created_at AS ts FROM smt_serial_numbers WHERE work_order_id = $1
                UNION ALL
                SELECT created_at AS ts FROM smt_serial_batches WHERE work_order_id = $1 AND is_deleted = false
                UNION ALL
                SELECT scanned_at AS ts FROM smt_inspections WHERE (work_order_id = $1 OR serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1))
            ) AS t
            WHERE ts IS NOT NULL
            ORDER BY prod_date DESC`,
            [workOrderId]
        );
        const availableDates: string[] = datesRes.rows.map(r => r.prod_date).filter(Boolean);

        // 2. FIRST SERIAL GENERATION TIMESTAMP
        let startDateQuery = `SELECT MIN(created_at) AS first_ts FROM (
            SELECT created_at FROM smt_serial_numbers WHERE work_order_id = $1
            UNION ALL
            SELECT created_at FROM smt_serial_batches WHERE work_order_id = $1 AND is_deleted = false
        ) AS t`;
        let startDateParams: any[] = [workOrderId];

        if (dateParam) {
            startDateQuery = `SELECT MIN(created_at) AS first_ts FROM (
                SELECT created_at FROM smt_serial_numbers WHERE work_order_id = $1 AND TO_CHAR(created_at, 'YYYY-MM-DD') = $2
                UNION ALL
                SELECT created_at FROM smt_serial_batches WHERE work_order_id = $1 AND is_deleted = false AND TO_CHAR(created_at, 'YYYY-MM-DD') = $2
            ) AS t`;
            startDateParams.push(dateParam);
        }

        const startDateRes = await pool.query(startDateQuery, startDateParams);
        const rawStartDate = startDateRes.rows[0]?.first_ts;
        const startDate = rawStartDate ? formatTimestamp(rawStartDate) : (dateParam ? `No activity on ${dateParam}` : 'Not Started');

        // 3. Labelled Quantity (Actual Status)
        // 3. Printing Stage Inspections (Passed, Failed, Pending)
        let printPassQuery = `SELECT COUNT(DISTINCT COALESCE(scanned_barcode, serial_id::text)) AS pass_cnt
             FROM smt_inspections 
             WHERE (work_order_id = $1 OR serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1))
               AND process_step = 'Printing' AND status = 'PASS'`;
        let printFailQuery = `SELECT COUNT(DISTINCT COALESCE(scanned_barcode, serial_id::text)) AS fail_cnt
             FROM smt_inspections 
             WHERE (work_order_id = $1 OR serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1))
               AND process_step = 'Printing' AND status IN ('FAIL', 'REJECTED', 'INVALID')
               AND COALESCE(scanned_barcode, serial_id::text) NOT IN (
                   SELECT COALESCE(scanned_barcode, serial_id::text)
                   FROM smt_inspections
                   WHERE (work_order_id = $1 OR serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1))
                     AND process_step = 'Printing' AND status = 'PASS'
               )`;
        let countParams: any[] = [workOrderId];

        if (dateParam) {
            printPassQuery += ` AND TO_CHAR(scanned_at, 'YYYY-MM-DD') = $2`;
            printFailQuery += ` AND TO_CHAR(scanned_at, 'YYYY-MM-DD') = $2`;
            countParams.push(dateParam);
        }

        const printPassRes = await pool.query(printPassQuery, countParams);
        const printFailRes = await pool.query(printFailQuery, countParams);

        const printingPassed = safeNumber(printPassRes.rows[0]?.pass_cnt);
        const printingFailed = safeNumber(printFailRes.rows[0]?.fail_cnt);
        const labelled = printingPassed;
        const actualPending = Math.max(0, totalQuantity - printingPassed - printingFailed);
        const actualPercentage = totalQuantity > 0 ? safeNumber(((printingPassed / totalQuantity) * 100).toFixed(1)) : 0;

        // 4. Yield SPI (Actual Status / Total Quantity * 100)
        const yieldSPI = actualPercentage;

        // 5. Pre-AOI Inspections
        let prePassQuery = `SELECT COUNT(DISTINCT COALESCE(scanned_barcode, serial_id::text)) AS pass_cnt
             FROM smt_inspections 
             WHERE (work_order_id = $1 OR serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1))
               AND process_step = 'Pre AOI' AND status = 'PASS'`;
        let preFailQuery = `SELECT COUNT(DISTINCT COALESCE(scanned_barcode, serial_id::text)) AS fail_cnt
             FROM smt_inspections 
             WHERE (work_order_id = $1 OR serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1))
               AND process_step = 'Pre AOI' AND status IN ('FAIL', 'REJECTED', 'INVALID')
               AND COALESCE(scanned_barcode, serial_id::text) NOT IN (
                   SELECT COALESCE(scanned_barcode, serial_id::text)
                   FROM smt_inspections
                   WHERE (work_order_id = $1 OR serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1))
                     AND process_step = 'Pre AOI' AND status = 'PASS'
               )`;
        let preParams: any[] = [workOrderId];

        if (dateParam) {
            prePassQuery += ` AND TO_CHAR(scanned_at, 'YYYY-MM-DD') = $2`;
            preFailQuery += ` AND TO_CHAR(scanned_at, 'YYYY-MM-DD') = $2`;
            preParams.push(dateParam);
        }

        const preAoiPassRes = await pool.query(prePassQuery, preParams);
        const preAoiFailRes = await pool.query(preFailQuery, preParams);

        const preAoiPassed = safeNumber(preAoiPassRes.rows[0]?.pass_cnt);
        const preAoiFailed = safeNumber(preAoiFailRes.rows[0]?.fail_cnt);
        // Pre-AOI Pending = Total WO Quantity (or day's labelled) - Pre-AOI Passed - Pre-AOI Failed (clamped >= 0)
        const preAoiPending = Math.max(0, (dateParam ? labelled : totalQuantity) - preAoiPassed - preAoiFailed);
        const preAoiPercentage = totalQuantity > 0 ? safeNumber(((preAoiPassed / totalQuantity) * 100).toFixed(1)) : 0;

        // 6. Post-AOI Inspections
        const postAoiEligible = preAoiPassed;

        let postPassQuery = `SELECT COUNT(DISTINCT COALESCE(scanned_barcode, serial_id::text)) AS pass_cnt
             FROM smt_inspections 
             WHERE (work_order_id = $1 OR serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1))
               AND process_step = 'Post AOI' AND status = 'PASS'`;
        let postFailQuery = `SELECT COUNT(DISTINCT COALESCE(scanned_barcode, serial_id::text)) AS fail_cnt
             FROM smt_inspections 
             WHERE (work_order_id = $1 OR serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1))
               AND process_step = 'Post AOI' AND status IN ('FAIL', 'REJECTED', 'INVALID')
               AND COALESCE(scanned_barcode, serial_id::text) NOT IN (
                   SELECT COALESCE(scanned_barcode, serial_id::text)
                   FROM smt_inspections
                   WHERE (work_order_id = $1 OR serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1))
                     AND process_step = 'Post AOI' AND status = 'PASS'
               )`;
        let postParams: any[] = [workOrderId];

        if (dateParam) {
            postPassQuery += ` AND TO_CHAR(scanned_at, 'YYYY-MM-DD') = $2`;
            postFailQuery += ` AND TO_CHAR(scanned_at, 'YYYY-MM-DD') = $2`;
            postParams.push(dateParam);
        }

        const postAoiPassRes = await pool.query(postPassQuery, postParams);
        const postAoiFailRes = await pool.query(postFailQuery, postParams);

        const postAoiPassed = safeNumber(postAoiPassRes.rows[0]?.pass_cnt);
        const postAoiFailed = safeNumber(postAoiFailRes.rows[0]?.fail_cnt);
        const postAoiPending = Math.max(0, (dateParam ? preAoiPassed : totalQuantity) - postAoiPassed - postAoiFailed);
        const postAoiPercentage = totalQuantity > 0 ? safeNumber(((postAoiPassed / totalQuantity) * 100).toFixed(1)) : 0;

        // 6.5 SMT FG Inspections
        const smtFgEligible = postAoiPassed;

        let fgPassQuery = `SELECT COUNT(DISTINCT COALESCE(scanned_barcode, serial_id::text)) AS pass_cnt
             FROM smt_inspections 
             WHERE (work_order_id = $1 OR serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1))
               AND process_step = 'SMT FG' AND status = 'PASS'`;
        let fgFailQuery = `SELECT COUNT(DISTINCT COALESCE(scanned_barcode, serial_id::text)) AS fail_cnt
             FROM smt_inspections 
             WHERE (work_order_id = $1 OR serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1))
               AND process_step = 'SMT FG' AND status IN ('FAIL', 'REJECTED', 'INVALID')
               AND COALESCE(scanned_barcode, serial_id::text) NOT IN (
                   SELECT COALESCE(scanned_barcode, serial_id::text)
                   FROM smt_inspections
                   WHERE (work_order_id = $1 OR serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1))
                     AND process_step = 'SMT FG' AND status = 'PASS'
               )`;
        let fgParams: any[] = [workOrderId];

        if (dateParam) {
            fgPassQuery += ` AND TO_CHAR(scanned_at, 'YYYY-MM-DD') = $2`;
            fgFailQuery += ` AND TO_CHAR(scanned_at, 'YYYY-MM-DD') = $2`;
            fgParams.push(dateParam);
        }

        const smtFgPassRes = await pool.query(fgPassQuery, fgParams);
        const smtFgFailRes = await pool.query(fgFailQuery, fgParams);

        const smtFgPassed = safeNumber(smtFgPassRes.rows[0]?.pass_cnt);
        const smtFgFailed = safeNumber(smtFgFailRes.rows[0]?.fail_cnt);
        const smtFgPending = Math.max(0, (dateParam ? postAoiPassed : totalQuantity) - smtFgPassed - smtFgFailed);
        const smtFgPercentage = totalQuantity > 0 ? safeNumber(((smtFgPassed / totalQuantity) * 100).toFixed(1)) : 0;

        // Total SMT FG Passed across the entire Work Order (without date filter) for overall status
        const overallFgPassRes = await pool.query(
            `SELECT COUNT(DISTINCT COALESCE(scanned_barcode, serial_id::text)) AS pass_cnt
             FROM smt_inspections 
             WHERE (work_order_id = $1 OR serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1))
               AND process_step = 'SMT FG' AND status = 'PASS'`,
            [workOrderId]
        );
        const overallSmtFgPassed = safeNumber(overallFgPassRes.rows[0]?.pass_cnt);

        // 7. Overall Work Order Status Logic:
        // Show IN PROGRESS for any work order until SMT FG stage is passed for all quantity, then COMPLETED.
        let overallStatus = 'NOT STARTED';
        if (totalQuantity > 0 && overallSmtFgPassed >= totalQuantity) {
            overallStatus = 'COMPLETED';
        } else if (labelled > 0 || overallSmtFgPassed > 0 || preAoiPassed > 0 || postAoiPassed > 0) {
            overallStatus = 'IN PROGRESS';
        }

        res.status(200).json({
            success: true,
            workOrderId: wo.id,
            totalQuantity,
            startDate,
            overallStatus,
            productName: wo.product_name,
            modelName: wo.model_name,
            selectedDate: dateParam || 'all',
            availableDates,
            actualStatus: {
                labelled,
                passed: printingPassed,
                failed: printingFailed,
                pending: actualPending,
                percentage: actualPercentage
            },
            yieldSPI,
            preAOI: {
                passed: preAoiPassed,
                failed: preAoiFailed,
                pending: preAoiPending,
                percentage: preAoiPercentage
            },
            postAOI: {
                eligible: postAoiEligible,
                passed: postAoiPassed,
                failed: postAoiFailed,
                pending: postAoiPending,
                percentage: postAoiPercentage
            },
            smtFG: {
                eligible: smtFgEligible,
                passed: smtFgPassed,
                failed: smtFgFailed,
                pending: smtFgPending,
                percentage: smtFgPercentage
            }
        });
    } catch (err: any) {
        logger.error('Error in getWorkOrderDashboard:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to compute Work Order dashboard stats',
            details: err.message
        });
    }
};

/**
 * GET /api/smt/admin/work-orders/:workOrderId/export/excel
 * Export day-wise production details & inspection logs for a Work Order to Excel (.xlsx)
 */
export const exportWorkOrderDayExcel = async (req: Request, res: Response) => {
    try {
        const { workOrderId } = req.params;
        const requestedDate = req.query.date ? String(req.query.date).trim() : '';

        if (!workOrderId) {
            return res.status(400).json({ success: false, error: 'Work Order ID is required' });
        }

        const dateParam = (requestedDate && requestedDate !== 'all' && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) ? requestedDate : null;

        // Fetch Work Order Details
        const woRes = await pool.query(
            `SELECT id, quantity, created_at, status, product_name, model_name FROM smt_work_orders WHERE id = $1`,
            [workOrderId]
        );

        if (woRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Work Order not found' });
        }

        const wo = woRes.rows[0];
        const totalQuantity = safeNumber(wo.quantity);

        // Fetch Printing Stage Inspections (Passed, Failed, Pending)
        let printPassQuery = `SELECT COUNT(DISTINCT COALESCE(scanned_barcode, serial_id::text)) AS pass_cnt
             FROM smt_inspections 
             WHERE (work_order_id = $1 OR serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1))
               AND process_step = 'Printing' AND status = 'PASS'`;
        let printFailQuery = `SELECT COUNT(DISTINCT COALESCE(scanned_barcode, serial_id::text)) AS fail_cnt
             FROM smt_inspections 
             WHERE (work_order_id = $1 OR serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1))
               AND process_step = 'Printing' AND status IN ('FAIL', 'REJECTED', 'INVALID')
               AND COALESCE(scanned_barcode, serial_id::text) NOT IN (
                   SELECT COALESCE(scanned_barcode, serial_id::text)
                   FROM smt_inspections
                   WHERE (work_order_id = $1 OR serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1))
                     AND process_step = 'Printing' AND status = 'PASS'
               )`;
        let countParams: any[] = [workOrderId];

        if (dateParam) {
            printPassQuery += ` AND TO_CHAR(scanned_at, 'YYYY-MM-DD') = $2`;
            printFailQuery += ` AND TO_CHAR(scanned_at, 'YYYY-MM-DD') = $2`;
            countParams.push(dateParam);
        }

        const printPassRes = await pool.query(printPassQuery, countParams);
        const printFailRes = await pool.query(printFailQuery, countParams);

        const printingPassed = safeNumber(printPassRes.rows[0]?.pass_cnt);
        const printingFailed = safeNumber(printFailRes.rows[0]?.fail_cnt);
        const labelled = printingPassed;
        const actualPending = Math.max(0, totalQuantity - printingPassed - printingFailed);
        const actualPercentage = totalQuantity > 0 ? safeNumber(((printingPassed / totalQuantity) * 100).toFixed(1)) : 0;

        // Pre-AOI
        let prePassQuery = `SELECT COUNT(DISTINCT COALESCE(scanned_barcode, serial_id::text)) AS pass_cnt
             FROM smt_inspections 
             WHERE (work_order_id = $1 OR serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1))
               AND process_step = 'Pre AOI' AND status = 'PASS'`;
        let preFailQuery = `SELECT COUNT(DISTINCT COALESCE(scanned_barcode, serial_id::text)) AS fail_cnt
             FROM smt_inspections 
             WHERE (work_order_id = $1 OR serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1))
               AND process_step = 'Pre AOI' AND status IN ('FAIL', 'REJECTED', 'INVALID')
               AND COALESCE(scanned_barcode, serial_id::text) NOT IN (
                   SELECT COALESCE(scanned_barcode, serial_id::text)
                   FROM smt_inspections
                   WHERE (work_order_id = $1 OR serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1))
                     AND process_step = 'Pre AOI' AND status = 'PASS'
               )`;
        let preParams: any[] = [workOrderId];

        if (dateParam) {
            prePassQuery += ` AND TO_CHAR(scanned_at, 'YYYY-MM-DD') = $2`;
            preFailQuery += ` AND TO_CHAR(scanned_at, 'YYYY-MM-DD') = $2`;
            preParams.push(dateParam);
        }

        const preAoiPassRes = await pool.query(prePassQuery, preParams);
        const preAoiFailRes = await pool.query(preFailQuery, preParams);

        const preAoiPassed = safeNumber(preAoiPassRes.rows[0]?.pass_cnt);
        const preAoiFailed = safeNumber(preAoiFailRes.rows[0]?.fail_cnt);
        const preAoiPending = Math.max(0, (dateParam ? labelled : totalQuantity) - preAoiPassed - preAoiFailed);
        const preAoiPercentage = totalQuantity > 0 ? safeNumber(((preAoiPassed / totalQuantity) * 100).toFixed(1)) : 0;

        // Post-AOI
        const postAoiEligible = preAoiPassed;
        let postPassQuery = `SELECT COUNT(DISTINCT COALESCE(scanned_barcode, serial_id::text)) AS pass_cnt
             FROM smt_inspections 
             WHERE (work_order_id = $1 OR serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1))
               AND process_step = 'Post AOI' AND status = 'PASS'`;
        let postFailQuery = `SELECT COUNT(DISTINCT COALESCE(scanned_barcode, serial_id::text)) AS fail_cnt
             FROM smt_inspections 
             WHERE (work_order_id = $1 OR serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1))
               AND process_step = 'Post AOI' AND status IN ('FAIL', 'REJECTED', 'INVALID')
               AND COALESCE(scanned_barcode, serial_id::text) NOT IN (
                   SELECT COALESCE(scanned_barcode, serial_id::text)
                   FROM smt_inspections
                   WHERE (work_order_id = $1 OR serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1))
                     AND process_step = 'Post AOI' AND status = 'PASS'
               )`;
        let postParams: any[] = [workOrderId];

        if (dateParam) {
            postPassQuery += ` AND TO_CHAR(scanned_at, 'YYYY-MM-DD') = $2`;
            postFailQuery += ` AND TO_CHAR(scanned_at, 'YYYY-MM-DD') = $2`;
            postParams.push(dateParam);
        }

        const postAoiPassRes = await pool.query(postPassQuery, postParams);
        const postAoiFailRes = await pool.query(postFailQuery, postParams);

        const postAoiPassed = safeNumber(postAoiPassRes.rows[0]?.pass_cnt);
        const postAoiFailed = safeNumber(postAoiFailRes.rows[0]?.fail_cnt);
        const postAoiPending = Math.max(0, (dateParam ? preAoiPassed : totalQuantity) - postAoiPassed - postAoiFailed);
        const postAoiPercentage = totalQuantity > 0 ? safeNumber(((postAoiPassed / totalQuantity) * 100).toFixed(1)) : 0;

        // SMT FG
        const smtFgEligible = postAoiPassed;
        let fgPassQuery = `SELECT COUNT(DISTINCT COALESCE(scanned_barcode, serial_id::text)) AS pass_cnt
             FROM smt_inspections 
             WHERE (work_order_id = $1 OR serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1))
               AND process_step = 'SMT FG' AND status = 'PASS'`;
        let fgFailQuery = `SELECT COUNT(DISTINCT COALESCE(scanned_barcode, serial_id::text)) AS fail_cnt
             FROM smt_inspections 
             WHERE (work_order_id = $1 OR serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1))
               AND process_step = 'SMT FG' AND status IN ('FAIL', 'REJECTED', 'INVALID')
               AND COALESCE(scanned_barcode, serial_id::text) NOT IN (
                   SELECT COALESCE(scanned_barcode, serial_id::text)
                   FROM smt_inspections
                   WHERE (work_order_id = $1 OR serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1))
                     AND process_step = 'SMT FG' AND status = 'PASS'
               )`;
        let fgParams: any[] = [workOrderId];

        if (dateParam) {
            fgPassQuery += ` AND TO_CHAR(scanned_at, 'YYYY-MM-DD') = $2`;
            fgFailQuery += ` AND TO_CHAR(scanned_at, 'YYYY-MM-DD') = $2`;
            fgParams.push(dateParam);
        }

        const smtFgPassRes = await pool.query(fgPassQuery, fgParams);
        const smtFgFailRes = await pool.query(fgFailQuery, fgParams);

        const smtFgPassed = safeNumber(smtFgPassRes.rows[0]?.pass_cnt);
        const smtFgFailed = safeNumber(smtFgFailRes.rows[0]?.fail_cnt);
        const smtFgPending = Math.max(0, (dateParam ? postAoiPassed : totalQuantity) - smtFgPassed - smtFgFailed);
        const smtFgPercentage = totalQuantity > 0 ? safeNumber(((smtFgPassed / totalQuantity) * 100).toFixed(1)) : 0;

        // Overall status calculation
        const overallFgPassRes = await pool.query(
            `SELECT COUNT(DISTINCT COALESCE(scanned_barcode, serial_id::text)) AS pass_cnt
             FROM smt_inspections 
             WHERE (work_order_id = $1 OR serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1))
               AND process_step = 'SMT FG' AND status = 'PASS'`,
            [workOrderId]
        );
        const overallSmtFgPassed = safeNumber(overallFgPassRes.rows[0]?.pass_cnt);

        let overallStatus = 'NOT STARTED';
        if (totalQuantity > 0 && overallSmtFgPassed >= totalQuantity) {
            overallStatus = 'COMPLETED';
        } else if (labelled > 0 || overallSmtFgPassed > 0 || preAoiPassed > 0 || postAoiPassed > 0) {
            overallStatus = 'IN PROGRESS';
        }

        // Detailed Inspections Query for the selected date
        let logsQuery = `
            SELECT 
                i.id,
                COALESCE(i.scanned_barcode, sn.serial_number, 'N/A') AS barcode,
                i.process_step,
                i.status,
                i.scanned_by,
                i.scanned_at,
                i.rework_reason
            FROM smt_inspections i
            LEFT JOIN smt_serial_numbers sn ON i.serial_id = sn.id
            WHERE (i.work_order_id = $1 OR sn.work_order_id = $1)
        `;
        let logsParams: any[] = [workOrderId];

        if (dateParam) {
            logsQuery += ` AND TO_CHAR(i.scanned_at, 'YYYY-MM-DD') = $2`;
            logsParams.push(dateParam);
        }

        logsQuery += ` ORDER BY i.scanned_at DESC`;

        const logsRes = await pool.query(logsQuery, logsParams);

        // Build Excel Workbook using ExcelJS
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'SFCS Production System';
        workbook.created = new Date();

        const sheet = workbook.addWorksheet('WO Daily Report');

        // Fills & Borders
        const NAVY: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
        const BLUE: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
        const LIGHT_GRAY: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
        const WHITE_TEXT: Partial<ExcelJS.Font> = { color: { argb: 'FFFFFFFF' }, bold: true };

        // Title Header Row
        sheet.mergeCells('A1:G1');
        const titleCell = sheet.getCell('A1');
        titleCell.value = `SFCS PRODUCTION DASHBOARD REPORT - ${wo.id}`;
        titleCell.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
        titleCell.fill = NAVY;
        titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
        sheet.getRow(1).height = 32;

        // Meta Info Card
        sheet.addRow([]);
        sheet.addRow(['WORK ORDER OVERVIEW']);
        sheet.getCell('A3').font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF1E3A5F' } };

        sheet.addRow(['Work Order ID:', wo.id, 'Target Quantity:', totalQuantity, 'Selected Date:', dateParam || 'All Dates']);
        sheet.addRow(['Product Name:', wo.product_name || 'N/A', 'Labelled Quantity:', labelled, 'Overall Status:', overallStatus]);
        sheet.addRow(['Model Name:', wo.model_name || 'N/A', 'Report Date:', new Date().toLocaleDateString(), 'Report Time:', new Date().toLocaleTimeString()]);

        // Style overview rows
        for (let r = 4; r <= 6; r++) {
            const row = sheet.getRow(r);
            row.height = 20;
            [1, 3, 5].forEach(col => {
                row.getCell(col).font = { bold: true, size: 9 };
                row.getCell(col).fill = LIGHT_GRAY;
            });
        }

        sheet.addRow([]);
        sheet.addRow(['PRODUCTION MATRIX & STAGE BREAKDOWN']);
        sheet.getCell('A8').font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF1E3A5F' } };

        // Matrix Header
        const matrixHeaders = ['Stage Name', 'Passed Count', 'Failed Count', 'Pending Count', 'Yield / Progress %'];
        const matrixHeaderRow = sheet.addRow(matrixHeaders);
        matrixHeaderRow.height = 24;
        matrixHeaderRow.eachCell((cell: any) => {
            cell.font = WHITE_TEXT;
            cell.fill = BLUE;
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
        });

        // Matrix Rows
        const matrixData = [
            ['Printing (Labelled)', printingPassed, printingFailed, actualPending, `${actualPercentage}%`],
            ['Pre AOI', preAoiPassed, preAoiFailed, preAoiPending, `${preAoiPercentage}%`],
            ['Post AOI', postAoiPassed, postAoiFailed, postAoiPending, `${postAoiPercentage}%`],
            ['SMT FG', smtFgPassed, smtFgFailed, smtFgPending, `${smtFgPercentage}%`]
        ];

        matrixData.forEach(m => {
            const r = sheet.addRow(m);
            r.height = 20;
            r.getCell(1).font = { bold: true };
            r.getCell(2).alignment = { horizontal: 'center' };
            r.getCell(3).alignment = { horizontal: 'center' };
            r.getCell(4).alignment = { horizontal: 'center' };
            r.getCell(5).alignment = { horizontal: 'center' };
        });

        sheet.addRow([]);
        sheet.addRow(['INSPECTION & SCAN LOGS']);
        const logHeaderIdx = sheet.rowCount;
        sheet.getCell(`A${logHeaderIdx}`).font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF1E3A5F' } };

        const logHeaders = ['#', 'Barcode / Serial', 'Process Step', 'Status', 'Operator', 'Scanned Time', 'Defect / Remark'];
        const logHeaderRow = sheet.addRow(logHeaders);
        logHeaderRow.height = 24;
        logHeaderRow.eachCell((cell: any) => {
            cell.font = WHITE_TEXT;
            cell.fill = NAVY;
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
        });

        if (logsRes.rows.length === 0) {
            const emptyRow = sheet.addRow(['No inspection scans recorded for this selection.']);
            sheet.mergeCells(`A${sheet.rowCount}:G${sheet.rowCount}`);
            emptyRow.getCell(1).alignment = { horizontal: 'center' };
        } else {
            logsRes.rows.forEach((log, idx) => {
                const r = sheet.addRow([
                    idx + 1,
                    log.barcode,
                    log.process_step,
                    log.status,
                    log.scanned_by || 'System',
                    formatTimestamp(log.scanned_at),
                    log.rework_reason || '-'
                ]);
                r.height = 19;
                r.getCell(1).alignment = { horizontal: 'center' };
                r.getCell(4).alignment = { horizontal: 'center' };
                r.getCell(6).alignment = { horizontal: 'center' };
                if (log.status === 'FAIL' || log.status === 'REJECTED' || log.status === 'INVALID') {
                    r.getCell(4).font = { color: { argb: 'FFDC2626' }, bold: true };
                } else if (log.status === 'PASS') {
                    r.getCell(4).font = { color: { argb: 'FF166534' }, bold: true };
                }
            });
        }

        // Set column widths
        sheet.columns = [
            { width: 8 },  // A
            { width: 28 }, // B
            { width: 18 }, // C
            { width: 16 }, // D
            { width: 22 }, // E
            { width: 24 }, // F
            { width: 35 }  // G
        ];

        // Send Excel response
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="SFCS_WO_${wo.id}_${dateParam || 'all'}.xlsx"`);

        await workbook.xlsx.write(res);
        res.end();
    } catch (err: any) {
        logger.error('Error exporting Work Order day Excel:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to export Work Order day Excel report',
            details: err.message
        });
    }
};

/**
 * GET /api/smt/admin/work-orders/:workOrderId/export/pdf-data
 * Returns structured metadata for PDF report generation on frontend
 */
export const exportWorkOrderDayPdfData = async (req: Request, res: Response) => {
    try {
        const { workOrderId } = req.params;
        const requestedDate = req.query.date ? String(req.query.date).trim() : '';

        if (!workOrderId) {
            return res.status(400).json({ success: false, error: 'Work Order ID is required' });
        }

        const dateParam = (requestedDate && requestedDate !== 'all' && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) ? requestedDate : null;

        // Fetch Work Order Details
        const woRes = await pool.query(
            `SELECT id, quantity, created_at, status, product_name, model_name FROM smt_work_orders WHERE id = $1`,
            [workOrderId]
        );

        if (woRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Work Order not found' });
        }

        const wo = woRes.rows[0];
        const totalQuantity = safeNumber(wo.quantity);

        // Fetch Printing Stage Inspections (Passed, Failed, Pending)
        let printPassQuery = `SELECT COUNT(DISTINCT COALESCE(scanned_barcode, serial_id::text)) AS pass_cnt
             FROM smt_inspections 
             WHERE (work_order_id = $1 OR serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1))
               AND process_step = 'Printing' AND status = 'PASS'`;
        let printFailQuery = `SELECT COUNT(DISTINCT COALESCE(scanned_barcode, serial_id::text)) AS fail_cnt
             FROM smt_inspections 
             WHERE (work_order_id = $1 OR serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1))
               AND process_step = 'Printing' AND status IN ('FAIL', 'REJECTED', 'INVALID')
               AND COALESCE(scanned_barcode, serial_id::text) NOT IN (
                   SELECT COALESCE(scanned_barcode, serial_id::text)
                   FROM smt_inspections
                   WHERE (work_order_id = $1 OR serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1))
                     AND process_step = 'Printing' AND status = 'PASS'
               )`;
        let countParams: any[] = [workOrderId];

        if (dateParam) {
            printPassQuery += ` AND TO_CHAR(scanned_at, 'YYYY-MM-DD') = $2`;
            printFailQuery += ` AND TO_CHAR(scanned_at, 'YYYY-MM-DD') = $2`;
            countParams.push(dateParam);
        }

        const printPassRes = await pool.query(printPassQuery, countParams);
        const printFailRes = await pool.query(printFailQuery, countParams);

        const printingPassed = safeNumber(printPassRes.rows[0]?.pass_cnt);
        const printingFailed = safeNumber(printFailRes.rows[0]?.fail_cnt);
        const labelled = printingPassed;
        const actualPending = Math.max(0, totalQuantity - printingPassed - printingFailed);
        const actualPercentage = totalQuantity > 0 ? safeNumber(((printingPassed / totalQuantity) * 100).toFixed(1)) : 0;

        // Pre-AOI
        let prePassQuery = `SELECT COUNT(DISTINCT COALESCE(scanned_barcode, serial_id::text)) AS pass_cnt
             FROM smt_inspections 
             WHERE (work_order_id = $1 OR serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1))
               AND process_step = 'Pre AOI' AND status = 'PASS'`;
        let preFailQuery = `SELECT COUNT(DISTINCT COALESCE(scanned_barcode, serial_id::text)) AS fail_cnt
             FROM smt_inspections 
             WHERE (work_order_id = $1 OR serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1))
               AND process_step = 'Pre AOI' AND status IN ('FAIL', 'REJECTED', 'INVALID')
               AND COALESCE(scanned_barcode, serial_id::text) NOT IN (
                   SELECT COALESCE(scanned_barcode, serial_id::text)
                   FROM smt_inspections
                   WHERE (work_order_id = $1 OR serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1))
                     AND process_step = 'Pre AOI' AND status = 'PASS'
               )`;
        let preParams: any[] = [workOrderId];

        if (dateParam) {
            prePassQuery += ` AND TO_CHAR(scanned_at, 'YYYY-MM-DD') = $2`;
            preFailQuery += ` AND TO_CHAR(scanned_at, 'YYYY-MM-DD') = $2`;
            preParams.push(dateParam);
        }

        const preAoiPassRes = await pool.query(prePassQuery, preParams);
        const preAoiFailRes = await pool.query(preFailQuery, preParams);

        const preAoiPassed = safeNumber(preAoiPassRes.rows[0]?.pass_cnt);
        const preAoiFailed = safeNumber(preAoiFailRes.rows[0]?.fail_cnt);
        const preAoiPending = Math.max(0, (dateParam ? labelled : totalQuantity) - preAoiPassed - preAoiFailed);
        const preAoiPercentage = totalQuantity > 0 ? safeNumber(((preAoiPassed / totalQuantity) * 100).toFixed(1)) : 0;

        // Post-AOI
        const postAoiEligible = preAoiPassed;
        let postPassQuery = `SELECT COUNT(DISTINCT COALESCE(scanned_barcode, serial_id::text)) AS pass_cnt
             FROM smt_inspections 
             WHERE (work_order_id = $1 OR serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1))
               AND process_step = 'Post AOI' AND status = 'PASS'`;
        let postFailQuery = `SELECT COUNT(DISTINCT COALESCE(scanned_barcode, serial_id::text)) AS fail_cnt
             FROM smt_inspections 
             WHERE (work_order_id = $1 OR serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1))
               AND process_step = 'Post AOI' AND status IN ('FAIL', 'REJECTED', 'INVALID')
               AND COALESCE(scanned_barcode, serial_id::text) NOT IN (
                   SELECT COALESCE(scanned_barcode, serial_id::text)
                   FROM smt_inspections
                   WHERE (work_order_id = $1 OR serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1))
                     AND process_step = 'Post AOI' AND status = 'PASS'
               )`;
        let postParams: any[] = [workOrderId];

        if (dateParam) {
            postPassQuery += ` AND TO_CHAR(scanned_at, 'YYYY-MM-DD') = $2`;
            postFailQuery += ` AND TO_CHAR(scanned_at, 'YYYY-MM-DD') = $2`;
            postParams.push(dateParam);
        }

        const postAoiPassRes = await pool.query(postPassQuery, postParams);
        const postAoiFailRes = await pool.query(postFailQuery, postParams);

        const postAoiPassed = safeNumber(postAoiPassRes.rows[0]?.pass_cnt);
        const postAoiFailed = safeNumber(postAoiFailRes.rows[0]?.fail_cnt);
        const postAoiPending = Math.max(0, (dateParam ? preAoiPassed : totalQuantity) - postAoiPassed - postAoiFailed);
        const postAoiPercentage = totalQuantity > 0 ? safeNumber(((postAoiPassed / totalQuantity) * 100).toFixed(1)) : 0;

        // SMT FG
        const smtFgEligible = postAoiPassed;
        let fgPassQuery = `SELECT COUNT(DISTINCT COALESCE(scanned_barcode, serial_id::text)) AS pass_cnt
             FROM smt_inspections 
             WHERE (work_order_id = $1 OR serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1))
               AND process_step = 'SMT FG' AND status = 'PASS'`;
        let fgFailQuery = `SELECT COUNT(DISTINCT COALESCE(scanned_barcode, serial_id::text)) AS fail_cnt
             FROM smt_inspections 
             WHERE (work_order_id = $1 OR serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1))
               AND process_step = 'SMT FG' AND status IN ('FAIL', 'REJECTED', 'INVALID')
               AND COALESCE(scanned_barcode, serial_id::text) NOT IN (
                   SELECT COALESCE(scanned_barcode, serial_id::text)
                   FROM smt_inspections
                   WHERE (work_order_id = $1 OR serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1))
                     AND process_step = 'SMT FG' AND status = 'PASS'
               )`;
        let fgParams: any[] = [workOrderId];

        if (dateParam) {
            fgPassQuery += ` AND TO_CHAR(scanned_at, 'YYYY-MM-DD') = $2`;
            fgFailQuery += ` AND TO_CHAR(scanned_at, 'YYYY-MM-DD') = $2`;
            fgParams.push(dateParam);
        }

        const smtFgPassRes = await pool.query(fgPassQuery, fgParams);
        const smtFgFailRes = await pool.query(fgFailQuery, fgParams);

        const smtFgPassed = safeNumber(smtFgPassRes.rows[0]?.pass_cnt);
        const smtFgFailed = safeNumber(smtFgFailRes.rows[0]?.fail_cnt);
        const smtFgPending = Math.max(0, (dateParam ? postAoiPassed : totalQuantity) - smtFgPassed - smtFgFailed);
        const smtFgPercentage = totalQuantity > 0 ? safeNumber(((smtFgPassed / totalQuantity) * 100).toFixed(1)) : 0;

        // Overall status calculation
        const overallFgPassRes = await pool.query(
            `SELECT COUNT(DISTINCT COALESCE(scanned_barcode, serial_id::text)) AS pass_cnt
             FROM smt_inspections 
             WHERE (work_order_id = $1 OR serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1))
               AND process_step = 'SMT FG' AND status = 'PASS'`,
            [workOrderId]
        );
        const overallSmtFgPassed = safeNumber(overallFgPassRes.rows[0]?.pass_cnt);

        let overallStatus = 'NOT STARTED';
        if (totalQuantity > 0 && overallSmtFgPassed >= totalQuantity) {
            overallStatus = 'COMPLETED';
        } else if (labelled > 0 || overallSmtFgPassed > 0 || preAoiPassed > 0 || postAoiPassed > 0) {
            overallStatus = 'IN PROGRESS';
        }

        // Detailed Inspections Query for the selected date
        let logsQuery = `
            SELECT 
                i.id,
                COALESCE(i.scanned_barcode, sn.serial_number, 'N/A') AS barcode,
                i.process_step,
                i.status,
                i.scanned_by,
                i.scanned_at,
                i.rework_reason
            FROM smt_inspections i
            LEFT JOIN smt_serial_numbers sn ON i.serial_id = sn.id
            WHERE (i.work_order_id = $1 OR sn.work_order_id = $1)
        `;
        let logsParams: any[] = [workOrderId];

        if (dateParam) {
            logsQuery += ` AND TO_CHAR(i.scanned_at, 'YYYY-MM-DD') = $2`;
            logsParams.push(dateParam);
        }

        logsQuery += ` ORDER BY i.scanned_at DESC`;

        const logsRes = await pool.query(logsQuery, logsParams);

        res.status(200).json({
            success: true,
            summary: {
                workOrderId: wo.id,
                productName: wo.product_name || 'N/A',
                modelName: wo.model_name || 'N/A',
                totalQuantity,
                overallStatus,
                selectedDate: dateParam || 'all',
                generatedAt: formatTimestamp(new Date())
            },
            matrix: [
                { stage: 'Printing (Labelled)', passed: printingPassed, failed: printingFailed, pending: actualPending, percentage: actualPercentage },
                { stage: 'Pre AOI', passed: preAoiPassed, failed: preAoiFailed, pending: preAoiPending, percentage: preAoiPercentage },
                { stage: 'Post AOI', passed: postAoiPassed, failed: postAoiFailed, pending: postAoiPending, percentage: postAoiPercentage },
                { stage: 'SMT FG', passed: smtFgPassed, failed: smtFgFailed, pending: smtFgPending, percentage: smtFgPercentage }
            ],
            logs: logsRes.rows.map(r => ({
                id: r.id,
                barcode: r.barcode,
                process_step: r.process_step,
                status: r.status,
                scanned_by: r.scanned_by || 'System',
                scanned_at: formatTimestamp(r.scanned_at),
                rework_reason: r.rework_reason || null
            }))
        });
    } catch (err: any) {
        logger.error('Error fetching Work Order day PDF data:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch Work Order day PDF data',
            details: err.message
        });
    }
};
