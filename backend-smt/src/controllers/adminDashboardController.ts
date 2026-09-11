import { Request, Response } from 'express';
import pool from '../config/db';
import { createLogger } from '../utils/logger';
import * as ExcelJS from 'exceljs';
import { dashboardEvents } from '../utils/dashboardEmitter';

const logger = createLogger('ADMIN_DASHBOARD_CONTROLLER');

/**
 * Helper to safely format numbers and prevent NaN/null/Infinity
 */
const safeNumber = (val: any): number => {
    const num = Number(val);
    return isNaN(num) || !isFinite(num) ? 0 : num;
};

export interface SmtStageMetrics {
    stage: string;
    pass: number;
    fail: number;
    pending: number;
    yield: number;
    // Backward compatibility aliases
    passed: number;
    failed: number;
    percentage: number;
}

export interface SmtSideMetrics {
    printing: SmtStageMetrics & { labelled: number };
    spi: SmtStageMetrics;
    preAOI: SmtStageMetrics;
    postAOI: SmtStageMetrics;
    yieldSPI: number;
}

export interface SmtMetricsSummary {
    isDoubleSided: boolean;
    sides: string;
    printing: SmtStageMetrics & { labelled: number };
    spi: SmtStageMetrics;
    preAOI: SmtStageMetrics;
    postAOI: SmtStageMetrics;
    smtFG: SmtStageMetrics;
    yieldSPI: number;
    overallStatus: string;
    top?: SmtSideMetrics;
    bottom?: SmtSideMetrics;
}

/**
 * Authoritative SMT stage metrics calculation:
 * - Genuine Failures only: status = 'FAIL' (excludes INVALID, REJECTED, and system errors).
 * - Latest Valid State: Uses DISTINCT ON per physical unit to ensure each unit is counted exactly once per side.
 * - Handles FAIL -> PASS: When a unit is repaired or passes rework, it is counted as PASS and not FAIL.
 * - Double-Sided Support: Computes independent metrics for TOP and BOTTOM flows, with a single shared SMT FG final release stage.
 * - Pending: Math.max(0, stageTotal - passed - failed).
 * - Yield: (passed / totalQuantity) * 100 adhering to existing application formula.
 */
export const calculateSmtStageMetrics = async (
    dbPool: any,
    workOrderId: string,
    totalQuantity: number,
    dateParam: string | null,
    isDoubleSided: boolean = false,
    sides: string = 'Top'
): Promise<SmtMetricsSummary> => {
    let detectedSides = sides;
    let detectedDoubleSided = isDoubleSided;

    if (!detectedDoubleSided && detectedSides === 'Top') {
        try {
            const woSideRes = await dbPool.query(`SELECT sides FROM smt_work_orders WHERE id = $1`, [workOrderId]);
            if (woSideRes.rows.length > 0 && woSideRes.rows[0].sides) {
                detectedSides = woSideRes.rows[0].sides.trim();
                detectedDoubleSided = detectedSides.toLowerCase() === 'top / bottom' || detectedSides.includes('/');
            }
        } catch {
            // fallback to default
        }
    }

    let query = `
        WITH stage_latest AS (
            SELECT DISTINCT ON (
                i.process_step,
                CASE 
                    WHEN i.process_step = 'SMT FG' THEN 'SHARED'
                    WHEN ps.side IS NOT NULL THEN UPPER(TRIM(ps.side))
                    WHEN spis.side IS NOT NULL THEN UPPER(TRIM(spis.side))
                    WHEN pas.side IS NOT NULL THEN UPPER(TRIM(pas.side))
                    WHEN poas.side IS NOT NULL THEN UPPER(TRIM(poas.side))
                    WHEN rs.side IS NOT NULL THEN UPPER(TRIM(rs.side))
                    WHEN fgs.side IS NOT NULL THEN UPPER(TRIM(fgs.side))
                    WHEN wo.sides IS NOT NULL AND LOWER(wo.sides) = 'bottom' THEN 'BOTTOM'
                    ELSE 'TOP'
                END,
                UPPER(TRIM(COALESCE(sn.serial_number, i.scanned_barcode, i.serial_id::text)))
            )
                i.process_step,
                CASE 
                    WHEN i.process_step = 'SMT FG' THEN 'SHARED'
                    WHEN ps.side IS NOT NULL THEN UPPER(TRIM(ps.side))
                    WHEN spis.side IS NOT NULL THEN UPPER(TRIM(spis.side))
                    WHEN pas.side IS NOT NULL THEN UPPER(TRIM(pas.side))
                    WHEN poas.side IS NOT NULL THEN UPPER(TRIM(poas.side))
                    WHEN rs.side IS NOT NULL THEN UPPER(TRIM(rs.side))
                    WHEN fgs.side IS NOT NULL THEN UPPER(TRIM(fgs.side))
                    WHEN wo.sides IS NOT NULL AND LOWER(wo.sides) = 'bottom' THEN 'BOTTOM'
                    ELSE 'TOP'
                END AS production_side,
                UPPER(TRIM(COALESCE(sn.serial_number, i.scanned_barcode, i.serial_id::text))) AS unit_key,
                i.status
            FROM smt_inspections i
            LEFT JOIN smt_work_orders wo ON i.work_order_id = wo.id
            LEFT JOIN smt_serial_numbers sn ON i.serial_id = sn.id
            LEFT JOIN smt_printing_sessions ps ON i.printing_session_id = ps.id
            LEFT JOIN smt_spi_sessions spis ON i.spi_session_id = spis.id
            LEFT JOIN smt_pre_aoi_sessions pas ON i.pre_aoi_session_id = pas.id
            LEFT JOIN smt_post_aoi_sessions poas ON i.post_aoi_session_id = poas.id
            LEFT JOIN smt_fg_sessions fgs ON i.fg_session_id = fgs.id
            LEFT JOIN smt_rework_sessions rs ON i.rework_session_id = rs.id
            WHERE (i.work_order_id = $1 OR sn.work_order_id = $1)
              AND i.process_step IN ('Printing', 'SPI', 'Pre AOI', 'Post AOI', 'SMT FG')
              AND i.status IN ('PASS', 'FAIL')
    `;
    const params: any[] = [workOrderId];

    if (dateParam) {
        query += ` AND TO_CHAR(i.scanned_at, 'YYYY-MM-DD') = $2`;
        params.push(dateParam);
    }

    query += `
            ORDER BY 
                i.process_step,
                CASE 
                    WHEN i.process_step = 'SMT FG' THEN 'SHARED'
                    WHEN ps.side IS NOT NULL THEN UPPER(TRIM(ps.side))
                    WHEN spis.side IS NOT NULL THEN UPPER(TRIM(spis.side))
                    WHEN pas.side IS NOT NULL THEN UPPER(TRIM(pas.side))
                    WHEN poas.side IS NOT NULL THEN UPPER(TRIM(poas.side))
                    WHEN rs.side IS NOT NULL THEN UPPER(TRIM(rs.side))
                    WHEN fgs.side IS NOT NULL THEN UPPER(TRIM(fgs.side))
                    WHEN wo.sides IS NOT NULL AND LOWER(wo.sides) = 'bottom' THEN 'BOTTOM'
                    ELSE 'TOP'
                END,
                UPPER(TRIM(COALESCE(sn.serial_number, i.scanned_barcode, i.serial_id::text))),
                i.scanned_at DESC,
                i.id DESC
        )
        SELECT 
            process_step,
            production_side,
            COUNT(*) FILTER (WHERE status = 'PASS') AS pass_cnt,
            COUNT(*) FILTER (WHERE status = 'FAIL') AS fail_cnt
        FROM stage_latest
        GROUP BY process_step, production_side
    `;

    const res = await dbPool.query(query, params);

    const sideCounts: Record<string, Record<string, { passed: number; failed: number }>> = {
        'Printing': { 'TOP': { passed: 0, failed: 0 }, 'BOTTOM': { passed: 0, failed: 0 } },
        'SPI': { 'TOP': { passed: 0, failed: 0 }, 'BOTTOM': { passed: 0, failed: 0 } },
        'Pre AOI': { 'TOP': { passed: 0, failed: 0 }, 'BOTTOM': { passed: 0, failed: 0 } },
        'Post AOI': { 'TOP': { passed: 0, failed: 0 }, 'BOTTOM': { passed: 0, failed: 0 } },
        'SMT FG': { 'TOP': { passed: 0, failed: 0 }, 'BOTTOM': { passed: 0, failed: 0 } }
    };
    let smtFgPassed = 0;
    let smtFgFailed = 0;

    for (const r of res.rows) {
        const step = r.process_step;
        if (step === 'SMT FG') {
            smtFgPassed = safeNumber(r.pass_cnt);
            smtFgFailed = safeNumber(r.fail_cnt);
            sideCounts['SMT FG']['TOP'] = { passed: smtFgPassed, failed: smtFgFailed };
        } else if (sideCounts[step]) {
            const side = r.production_side === 'BOTTOM' ? 'BOTTOM' : 'TOP';
            sideCounts[step][side] = {
                passed: safeNumber(r.pass_cnt),
                failed: safeNumber(r.fail_cnt)
            };
        }
    }

    const buildSideMetrics = (sideKey: 'TOP' | 'BOTTOM'): SmtSideMetrics => {
        const printPassed = sideCounts['Printing'][sideKey].passed;
        const printFailed = sideCounts['Printing'][sideKey].failed;
        const printPending = Math.max(0, totalQuantity - printPassed - printFailed);
        const printYield = totalQuantity > 0 ? safeNumber(((printPassed / totalQuantity) * 100).toFixed(1)) : 0;

        const spiPassed = sideCounts['SPI'][sideKey].passed;
        const spiFailed = sideCounts['SPI'][sideKey].failed;
        const spiPending = Math.max(0, (dateParam ? printPassed : totalQuantity) - spiPassed - spiFailed);
        const spiYield = totalQuantity > 0 ? safeNumber(((spiPassed / totalQuantity) * 100).toFixed(1)) : 0;

        const preAoiPassed = sideCounts['Pre AOI'][sideKey].passed;
        const preAoiFailed = sideCounts['Pre AOI'][sideKey].failed;
        const preAoiPending = Math.max(0, (dateParam ? spiPassed : totalQuantity) - preAoiPassed - preAoiFailed);
        const preAoiYield = totalQuantity > 0 ? safeNumber(((preAoiPassed / totalQuantity) * 100).toFixed(1)) : 0;

        const postAoiPassed = sideCounts['Post AOI'][sideKey].passed;
        const postAoiFailed = sideCounts['Post AOI'][sideKey].failed;
        const postAoiPending = Math.max(0, (dateParam ? preAoiPassed : totalQuantity) - postAoiPassed - postAoiFailed);
        const postAoiYield = totalQuantity > 0 ? safeNumber(((postAoiPassed / totalQuantity) * 100).toFixed(1)) : 0;

        return {
            printing: {
                stage: 'Printing',
                pass: printPassed,
                fail: printFailed,
                pending: printPending,
                yield: printYield,
                labelled: printPassed,
                passed: printPassed,
                failed: printFailed,
                percentage: printYield
            },
            spi: {
                stage: 'SPI',
                pass: spiPassed,
                fail: spiFailed,
                pending: spiPending,
                yield: spiYield,
                passed: spiPassed,
                failed: spiFailed,
                percentage: spiYield
            },
            preAOI: {
                stage: 'Pre AOI',
                pass: preAoiPassed,
                fail: preAoiFailed,
                pending: preAoiPending,
                yield: preAoiYield,
                passed: preAoiPassed,
                failed: preAoiFailed,
                percentage: preAoiYield
            },
            postAOI: {
                stage: 'Post AOI',
                pass: postAoiPassed,
                fail: postAoiFailed,
                pending: postAoiPending,
                yield: postAoiYield,
                passed: postAoiPassed,
                failed: postAoiFailed,
                percentage: postAoiYield
            },
            yieldSPI: spiYield
        };
    };

    const topMetrics = buildSideMetrics('TOP');
    const bottomMetrics = buildSideMetrics('BOTTOM');

    // SMT FG is the single shared final release stage
    const priorStagePassed = detectedDoubleSided
        ? Math.min(topMetrics.postAOI.passed, bottomMetrics.postAOI.passed)
        : (detectedSides.toLowerCase() === 'bottom' ? bottomMetrics.postAOI.passed : topMetrics.postAOI.passed);
    const smtFgPending = Math.max(0, (dateParam ? priorStagePassed : totalQuantity) - smtFgPassed - smtFgFailed);
    const smtFgPercentage = totalQuantity > 0 ? safeNumber(((smtFgPassed / totalQuantity) * 100).toFixed(1)) : 0;

    const smtFgMetrics: SmtStageMetrics = {
        stage: 'SMT FG',
        pass: smtFgPassed,
        fail: smtFgFailed,
        pending: smtFgPending,
        yield: smtFgPercentage,
        passed: smtFgPassed,
        failed: smtFgFailed,
        percentage: smtFgPercentage
    };

    // Overall Status calculation (all-time SMT FG pass vs totalQuantity)
    const overallFgPassRes = await dbPool.query(
        `SELECT COUNT(DISTINCT UPPER(TRIM(COALESCE(sn.serial_number, i.scanned_barcode, i.serial_id::text)))) AS pass_cnt
         FROM smt_inspections i
         LEFT JOIN smt_serial_numbers sn ON i.serial_id = sn.id
         WHERE (i.work_order_id = $1 OR sn.work_order_id = $1)
           AND i.process_step = 'SMT FG' AND i.status = 'PASS'`,
        [workOrderId]
    );
    const overallSmtFgPassed = safeNumber(overallFgPassRes.rows[0]?.pass_cnt);

    let overallStatus = 'NOT STARTED';
    if (totalQuantity > 0 && overallSmtFgPassed >= totalQuantity) {
        overallStatus = 'COMPLETED';
    } else if (
        topMetrics.printing.passed > 0 || bottomMetrics.printing.passed > 0 ||
        topMetrics.spi.passed > 0 || bottomMetrics.spi.passed > 0 ||
        overallSmtFgPassed > 0 ||
        topMetrics.preAOI.passed > 0 || bottomMetrics.preAOI.passed > 0 ||
        topMetrics.postAOI.passed > 0 || bottomMetrics.postAOI.passed > 0
    ) {
        overallStatus = 'IN PROGRESS';
    }

    const primaryMetrics = (detectedSides.toLowerCase() === 'bottom') ? bottomMetrics : topMetrics;

    return {
        isDoubleSided: detectedDoubleSided,
        sides: detectedSides,
        printing: primaryMetrics.printing,
        spi: primaryMetrics.spi,
        preAOI: primaryMetrics.preAOI,
        postAOI: primaryMetrics.postAOI,
        smtFG: smtFgMetrics,
        yieldSPI: primaryMetrics.yieldSPI,
        overallStatus,
        top: topMetrics,
        bottom: bottomMetrics
    };
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

const STARTED_WO_CONDITION = `(
    wo.is_registered = true OR
    COALESCE(wo.smt_production_status, '') != '' OR
    EXISTS (SELECT 1 FROM smt_serial_numbers sn WHERE UPPER(TRIM(sn.work_order_id)) = UPPER(TRIM(wo.id))) OR
    EXISTS (SELECT 1 FROM smt_serial_batches sb WHERE UPPER(TRIM(sb.work_order_id)) = UPPER(TRIM(wo.id)) AND sb.is_deleted = false) OR
    EXISTS (SELECT 1 FROM smt_process_setups ps WHERE UPPER(TRIM(ps.work_order_id)) = UPPER(TRIM(wo.id))) OR
    EXISTS (SELECT 1 FROM smt_printing_sessions sess WHERE UPPER(TRIM(sess.work_order_id)) = UPPER(TRIM(wo.id))) OR
    EXISTS (SELECT 1 FROM smt_spi_sessions spisess WHERE UPPER(TRIM(spisess.work_order_id)) = UPPER(TRIM(wo.id))) OR
    EXISTS (SELECT 1 FROM smt_inspections insp WHERE UPPER(TRIM(insp.work_order_id)) = UPPER(TRIM(wo.id))) OR
    EXISTS (SELECT 1 FROM material_management mm WHERE UPPER(TRIM(mm.work_order_id)) = UPPER(TRIM(wo.id)))
)`;

/**
 * GET /api/smt/admin/dashboard/live-work-orders
 * Returns active/in-progress/completed Work Orders where printing or serial generation has started
 */
export const getLiveWorkOrders = async (req: Request, res: Response) => {
    try {
        const query = `
            SELECT wo.id, wo.product_name, wo.quantity, wo.created_at, wo.status, wo.model_name
            FROM smt_work_orders wo
            WHERE LOWER(COALESCE(wo.status, '')) NOT IN ('cancelled', 'deleted')
              AND ${STARTED_WO_CONDITION}
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
 * Server-side debounced search for active & historical Work Orders where printing or serial generation has started
 */
export const searchWorkOrders = async (req: Request, res: Response) => {
    try {
        const q = req.query.q ? String(req.query.q).trim() : '';

        let query = `
            SELECT wo.id, wo.product_name, wo.quantity, wo.created_at, wo.status, wo.model_name, wo.po_id
            FROM smt_work_orders wo
            WHERE ${STARTED_WO_CONDITION}
        `;
        const params: any[] = [];

        if (q) {
            query += ` AND (wo.id ILIKE $1 OR wo.product_name ILIKE $1 OR wo.po_id ILIKE $1 OR wo.model_name ILIKE $1)`;
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
            `SELECT id, quantity, created_at, status, product_name, model_name, sides FROM smt_work_orders WHERE id = $1`,
            [workOrderId]
        );

        if (woRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Work Order not found' });
        }

        const wo = woRes.rows[0];
        const totalQuantity = safeNumber(wo.quantity);
        const sides = (wo.sides || 'Top').trim();
        const isDoubleSided = sides.toLowerCase() === 'top / bottom' || sides.includes('/');

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

        // 3. Compute Authoritative Stage Metrics (Pass, Fail, Pending, Yield)
        const metrics = await calculateSmtStageMetrics(pool, workOrderId, totalQuantity, dateParam, isDoubleSided, sides);

        res.status(200).json({
            success: true,
            workOrderId: wo.id,
            totalQuantity,
            sides,
            isDoubleSided,
            startDate,
            overallStatus: metrics.overallStatus,
            productName: wo.product_name,
            modelName: wo.model_name,
            selectedDate: dateParam || 'all',
            availableDates,
            actualStatus: metrics.printing,
            spi: metrics.spi,
            yieldSPI: metrics.yieldSPI,
            preAOI: metrics.preAOI,
            postAOI: metrics.postAOI,
            smtFG: metrics.smtFG,
            top: metrics.top,
            bottom: metrics.bottom
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
            `SELECT id, quantity, created_at, status, product_name, model_name, smt_production_status, sides FROM smt_work_orders WHERE id = $1`,
            [workOrderId]
        );

        if (woRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Work Order not found' });
        }

        const wo = woRes.rows[0];
        const totalQuantity = safeNumber(wo.quantity);
        const overallStatus = wo.smt_production_status || wo.status || 'Pending';
        const sides = (wo.sides || 'Top').trim();
        const isDoubleSided = sides.toLowerCase() === 'top / bottom' || sides.includes('/');

        // Compute Authoritative Stage Metrics (Pass, Fail, Pending, Yield)
        const metrics = await calculateSmtStageMetrics(pool, workOrderId, totalQuantity, dateParam, isDoubleSided, sides);
        const labelled = metrics.printing.labelled;
        const printingPassed = metrics.printing.passed;
        const printingFailed = metrics.printing.failed;
        const actualPending = metrics.printing.pending;
        const actualPercentage = metrics.printing.percentage;

        const preAoiPassed = metrics.preAOI.passed;
        const preAoiFailed = metrics.preAOI.failed;
        const preAoiPending = metrics.preAOI.pending;
        const preAoiPercentage = metrics.preAOI.percentage;

        const postAoiPassed = metrics.postAOI.passed;
        const postAoiFailed = metrics.postAOI.failed;
        const postAoiPending = metrics.postAOI.pending;
        const postAoiPercentage = metrics.postAOI.percentage;

        const smtFgPassed = metrics.smtFG.passed;
        const smtFgFailed = metrics.smtFG.failed;
        const smtFgPending = metrics.smtFG.pending;
        const smtFgPercentage = metrics.smtFG.percentage;

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
        sheet.addRow(['Product Name:', wo.product_name || 'N/A', 'Sides:', sides, 'Overall Status:', overallStatus]);
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
        if (metrics.isDoubleSided && metrics.top && metrics.bottom) {
            sheet.addRow(['--- TOP SIDE ---']);
            const topRows = [
                ['Printing (Top)', metrics.top.printing.passed, metrics.top.printing.failed, metrics.top.printing.pending, `${metrics.top.printing.percentage}%`],
                ['SPI (Top)', metrics.top.spi.passed, metrics.top.spi.failed, metrics.top.spi.pending, `${metrics.top.spi.percentage}%`],
                ['Pre AOI (Top)', metrics.top.preAOI.passed, metrics.top.preAOI.failed, metrics.top.preAOI.pending, `${metrics.top.preAOI.percentage}%`],
                ['Post AOI (Top)', metrics.top.postAOI.passed, metrics.top.postAOI.failed, metrics.top.postAOI.pending, `${metrics.top.postAOI.percentage}%`]
            ];
            topRows.forEach(m => {
                const r = sheet.addRow(m);
                r.height = 20;
                r.getCell(1).font = { bold: true };
                r.getCell(2).alignment = { horizontal: 'center' };
                r.getCell(3).alignment = { horizontal: 'center' };
                r.getCell(4).alignment = { horizontal: 'center' };
                r.getCell(5).alignment = { horizontal: 'center' };
            });

            sheet.addRow(['--- BOTTOM SIDE ---']);
            const bottomRows = [
                ['Printing (Bottom)', metrics.bottom.printing.passed, metrics.bottom.printing.failed, metrics.bottom.printing.pending, `${metrics.bottom.printing.percentage}%`],
                ['SPI (Bottom)', metrics.bottom.spi.passed, metrics.bottom.spi.failed, metrics.bottom.spi.pending, `${metrics.bottom.spi.percentage}%`],
                ['Pre AOI (Bottom)', metrics.bottom.preAOI.passed, metrics.bottom.preAOI.failed, metrics.bottom.preAOI.pending, `${metrics.bottom.preAOI.percentage}%`],
                ['Post AOI (Bottom)', metrics.bottom.postAOI.passed, metrics.bottom.postAOI.failed, metrics.bottom.postAOI.pending, `${metrics.bottom.postAOI.percentage}%`]
            ];
            bottomRows.forEach(m => {
                const r = sheet.addRow(m);
                r.height = 20;
                r.getCell(1).font = { bold: true };
                r.getCell(2).alignment = { horizontal: 'center' };
                r.getCell(3).alignment = { horizontal: 'center' };
                r.getCell(4).alignment = { horizontal: 'center' };
                r.getCell(5).alignment = { horizontal: 'center' };
            });

            sheet.addRow(['--- SHARED FINAL RELEASE ---']);
            const fgR = sheet.addRow(['SMT FG (Release)', metrics.smtFG.passed, metrics.smtFG.failed, metrics.smtFG.pending, `${metrics.smtFG.percentage}%`]);
            fgR.height = 20;
            fgR.getCell(1).font = { bold: true };
            fgR.getCell(2).alignment = { horizontal: 'center' };
            fgR.getCell(3).alignment = { horizontal: 'center' };
            fgR.getCell(4).alignment = { horizontal: 'center' };
            fgR.getCell(5).alignment = { horizontal: 'center' };
        } else {
            const spiPassed = metrics.spi.passed;
            const spiFailed = metrics.spi.failed;
            const spiPending = metrics.spi.pending;
            const spiPercentage = metrics.spi.percentage;

            const matrixData = [
                ['Printing (Labelled)', printingPassed, printingFailed, actualPending, `${actualPercentage}%`],
                ['SPI', spiPassed, spiFailed, spiPending, `${spiPercentage}%`],
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
        }

        sheet.addRow([]);
        sheet.addRow(['INSPECTION & SCAN LOGS']);
        sheet.getCell(`A${sheet.rowCount}`).font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF1E3A5F' } };

        // Logs Header
        const logHeaders = ['Inspection ID', 'Barcode / Serial', 'Stage', 'Status', 'Operator', 'Timestamp', 'Rework Reason'];
        const logHeaderRow = sheet.addRow(logHeaders);
        logHeaderRow.height = 22;
        logHeaderRow.eachCell((cell: any) => {
            cell.font = WHITE_TEXT;
            cell.fill = NAVY;
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
        });

        // Logs Data
        logsRes.rows.forEach(l => {
            const r = sheet.addRow([
                l.id,
                l.barcode,
                l.process_step,
                l.status,
                l.scanned_by || 'System',
                formatTimestamp(l.scanned_at),
                l.rework_reason || '-'
            ]);
            r.height = 18;

            // Highlight PASS vs FAIL in status cell
            const statusCell = r.getCell(4);
            if (l.status === 'PASS') {
                statusCell.font = { color: { argb: 'FF16A34A' }, bold: true };
            } else if (l.status === 'FAIL') {
                statusCell.font = { color: { argb: 'FFDC2626' }, bold: true };
            }
        });

        // Column Widths
        sheet.columns = [
            { width: 22 },
            { width: 26 },
            { width: 18 },
            { width: 14 },
            { width: 20 },
            { width: 22 },
            { width: 28 }
        ];

        // Send Excel file as attachment
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
 * Returns formatted JSON data payload used by frontend jsPDF to render crisp client-side PDF reports.
 */
export const getWorkOrderDayPdfData = async (req: Request, res: Response) => {
    try {
        const { workOrderId } = req.params;
        const requestedDate = req.query.date ? String(req.query.date).trim() : '';

        if (!workOrderId) {
            return res.status(400).json({ success: false, error: 'Work Order ID is required' });
        }

        const dateParam = (requestedDate && requestedDate !== 'all' && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) ? requestedDate : null;

        // Fetch Work Order Details
        const woRes = await pool.query(
            `SELECT id, quantity, created_at, status, product_name, model_name, smt_production_status, sides FROM smt_work_orders WHERE id = $1`,
            [workOrderId]
        );

        if (woRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Work Order not found' });
        }

        const wo = woRes.rows[0];
        const totalQuantity = safeNumber(wo.quantity);
        const overallStatus = wo.smt_production_status || wo.status || 'Pending';
        const sides = (wo.sides || 'Top').trim();
        const isDoubleSided = sides.toLowerCase() === 'top / bottom' || sides.includes('/');

        // Compute Authoritative Stage Metrics (Pass, Fail, Pending, Yield)
        const metrics = await calculateSmtStageMetrics(pool, workOrderId, totalQuantity, dateParam, isDoubleSided, sides);
        const labelled = metrics.printing.labelled;
        const printingPassed = metrics.printing.passed;
        const printingFailed = metrics.printing.failed;
        const actualPending = metrics.printing.pending;
        const actualPercentage = metrics.printing.percentage;

        const preAoiPassed = metrics.preAOI.passed;
        const preAoiFailed = metrics.preAOI.failed;
        const preAoiPending = metrics.preAOI.pending;
        const preAoiPercentage = metrics.preAOI.percentage;

        const postAoiPassed = metrics.postAOI.passed;
        const postAoiFailed = metrics.postAOI.failed;
        const postAoiPending = metrics.postAOI.pending;
        const postAoiPercentage = metrics.postAOI.percentage;

        const smtFgPassed = metrics.smtFG.passed;
        const smtFgFailed = metrics.smtFG.failed;
        const smtFgPending = metrics.smtFG.pending;
        const smtFgPercentage = metrics.smtFG.percentage;

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

        const matrix = (metrics.isDoubleSided && metrics.top && metrics.bottom) ? [
            { stage: 'Printing (Top)', passed: metrics.top.printing.passed, failed: metrics.top.printing.failed, pending: metrics.top.printing.pending, percentage: metrics.top.printing.percentage },
            { stage: 'SPI (Top)', passed: metrics.top.spi.passed, failed: metrics.top.spi.failed, pending: metrics.top.spi.pending, percentage: metrics.top.spi.percentage },
            { stage: 'Pre AOI (Top)', passed: metrics.top.preAOI.passed, failed: metrics.top.preAOI.failed, pending: metrics.top.preAOI.pending, percentage: metrics.top.preAOI.percentage },
            { stage: 'Post AOI (Top)', passed: metrics.top.postAOI.passed, failed: metrics.top.postAOI.failed, pending: metrics.top.postAOI.pending, percentage: metrics.top.postAOI.percentage },
            { stage: 'Printing (Bottom)', passed: metrics.bottom.printing.passed, failed: metrics.bottom.printing.failed, pending: metrics.bottom.printing.pending, percentage: metrics.bottom.printing.percentage },
            { stage: 'SPI (Bottom)', passed: metrics.bottom.spi.passed, failed: metrics.bottom.spi.failed, pending: metrics.bottom.spi.pending, percentage: metrics.bottom.spi.percentage },
            { stage: 'Pre AOI (Bottom)', passed: metrics.bottom.preAOI.passed, failed: metrics.bottom.preAOI.failed, pending: metrics.bottom.preAOI.pending, percentage: metrics.bottom.preAOI.percentage },
            { stage: 'Post AOI (Bottom)', passed: metrics.bottom.postAOI.passed, failed: metrics.bottom.postAOI.failed, pending: metrics.bottom.postAOI.pending, percentage: metrics.bottom.postAOI.percentage },
            { stage: 'SMT FG (Release)', passed: metrics.smtFG.passed, failed: metrics.smtFG.failed, pending: metrics.smtFG.pending, percentage: metrics.smtFG.percentage }
        ] : [
            { stage: 'Printing (Labelled)', passed: printingPassed, failed: printingFailed, pending: actualPending, percentage: actualPercentage },
            { stage: 'SPI', passed: metrics.spi.passed, failed: metrics.spi.failed, pending: metrics.spi.pending, percentage: metrics.spi.percentage },
            { stage: 'Pre AOI', passed: preAoiPassed, failed: preAoiFailed, pending: preAoiPending, percentage: preAoiPercentage },
            { stage: 'Post AOI', passed: postAoiPassed, failed: postAoiFailed, pending: postAoiPending, percentage: postAoiPercentage },
            { stage: 'SMT FG', passed: smtFgPassed, failed: smtFgFailed, pending: smtFgPending, percentage: smtFgPercentage }
        ];

        res.status(200).json({
            success: true,
            summary: {
                workOrderId: wo.id,
                productName: wo.product_name || 'N/A',
                modelName: wo.model_name || 'N/A',
                totalQuantity,
                overallStatus,
                sides,
                isDoubleSided,
                selectedDate: dateParam || 'all',
                generatedAt: formatTimestamp(new Date())
            },
            isDoubleSided,
            sides,
            top: metrics.top,
            bottom: metrics.bottom,
            smtFG: metrics.smtFG,
            matrix,
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

/**
 * Backward-compatible export alias for smtRoutes.ts
 */
export const exportWorkOrderDayPdfData = getWorkOrderDayPdfData;

/**
 * GET /api/smt/admin/dashboard/events
 * Real-time Server-Sent Events (SSE) stream for SMT Dashboard updates.
 * Pushes events immediately when a genuine production state change occurs.
 */
export const streamDashboardEvents = async (req: Request, res: Response) => {
    try {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        if (typeof (res as any).flushHeaders === 'function') {
            (res as any).flushHeaders();
        }

        // Initial connection greeting
        res.write(': connected\n\n');

        const onUpdate = (eventData: any) => {
            try {
                res.write(`data: ${JSON.stringify(eventData)}\n\n`);
            } catch (err: any) {
                logger.error(`Error writing SSE data: ${err.message}`);
            }
        };

        dashboardEvents.on('smt-dashboard-update', onUpdate);

        // Keep-alive heartbeat every 20 seconds to prevent proxy timeouts
        const keepAliveInterval = setInterval(() => {
            try {
                res.write(': keepalive\n\n');
            } catch (err) {
                clearInterval(keepAliveInterval);
            }
        }, 20000);

        req.on('close', () => {
            clearInterval(keepAliveInterval);
            dashboardEvents.off('smt-dashboard-update', onUpdate);
            res.end();
        });
    } catch (err: any) {
        logger.error('Error establishing SSE stream:', err);
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: 'Failed to establish event stream' });
        }
    }
};

