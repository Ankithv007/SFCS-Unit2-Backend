import { Request, Response } from 'express';
import pool, { backendPool } from '../config/db';
import { createLogger } from '../utils/logger';

const logger = createLogger('SMT_TRACK_CONTROLLER');

export const trackSerialNumber = async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!id || id.trim() === '') {
        return res.status(400).json({ error: 'Serial Number is required.' });
    }

    const inputValue = id.trim().toUpperCase();

    try {
        // 1. Find the serial number record
        const serialResult = await pool.query(
            `SELECT sn.*, wo.product_name, wo.quantity, wo.line_id, wo.sides, wo.has_smt, wo.has_backend, wo.selected_stages, wo.created_by as wo_created_by, wo.created_at as wo_created_at
             FROM smt_serial_numbers sn
             LEFT JOIN smt_work_orders wo ON sn.work_order_id = wo.id
             WHERE sn.serial_number = $1`,
            [inputValue]
        );

        if ((serialResult.rowCount ?? 0) === 0) {
            return res.status(404).json({ error: `"${inputValue}" was not found in the system. Please check the Serial Number.` });
        }

        const serial = serialResult.rows[0];

        // 2. Fetch all inspection history for this serial across all process steps
        const historyResult = await pool.query(
            `SELECT 
                i.id,
                i.serial_id,
                i.process_step,
                i.scanned_by,
                i.scanned_at,
                i.status,
                i.rework_reason,
                COALESCE(
                    ps.side,
                    spis.side,
                    pas.side,
                    poas.side,
                    rs.side,
                    fgs.side
                ) AS side
            FROM smt_inspections i
            LEFT JOIN smt_printing_sessions ps ON i.printing_session_id = ps.id
            LEFT JOIN smt_spi_sessions spis ON i.spi_session_id = spis.id
            LEFT JOIN smt_pre_aoi_sessions pas ON i.pre_aoi_session_id = pas.id
            LEFT JOIN smt_post_aoi_sessions poas ON i.post_aoi_session_id = poas.id
            LEFT JOIN smt_rework_sessions rs ON i.rework_session_id = rs.id
            LEFT JOIN smt_fg_sessions fgs ON i.fg_session_id = fgs.id
            WHERE i.serial_id = $1
            ORDER BY i.scanned_at ASC`,
            [serial.id]
        );

        const history = historyResult.rows.map((row: any) => ({
            id: row.id,
            process_step: row.process_step || '-',
            status: (row.status || '').toUpperCase(),
            scanned_by: row.scanned_by || '-',
            scanned_at: row.scanned_at,
            rework_reason: row.rework_reason || null,
            side: row.side || null,
        }));

        // 3. Determine current stage (last stage in history)
        let currentStage = 'Pending';
        let currentStatus = 'PENDING';
        if (history.length > 0) {
            const lastRecord = history[history.length - 1];
            currentStage = lastRecord.process_step;
            currentStatus = lastRecord.status;
        }

        // 4. Compute statistics
        const totalFailures = history.filter(h => h.status === 'REWORK' || h.status === 'FAIL').length;
        const totalReworks = history.filter(h => h.process_step === 'Rework').length;
        const totalPassed = history.filter(h => h.status === 'PASS').length;

        // 5. Determine final status
        let finalStatusLabel = 'IN PRODUCTION';
        if (currentStatus === 'PASS' && currentStage === 'SMT FG') {
            finalStatusLabel = 'COMPLETED';
        } else if (currentStatus === 'REWORK') {
            finalStatusLabel = 'IN REWORK';
        } else if (currentStatus === 'FAIL') {
            finalStatusLabel = 'FAILED';
        } else if (currentStatus === 'PASS') {
            finalStatusLabel = 'IN PRODUCTION';
        }

        // Fetch Solder Paste details for the work order
        const spResult = await pool.query(
            `SELECT 
                solder_paste_barcode, 
                solder_paste_status,
                solder_paste_stage1_operator, 
                solder_paste_stage1_employee_code, 
                solder_paste_stage1_at, 
                solder_paste_stage1_status,
                solder_paste_stage2_start_at, 
                solder_paste_stage2_status,
                solder_paste_stage3_start_at, 
                solder_paste_stage3_completed_at, 
                solder_paste_stage3_operator, 
                solder_paste_stage3_employee_code, 
                solder_paste_stage3_status
             FROM smt_work_orders WHERE id = $1`,
            [serial.work_order_id]
        );
        const sp = spResult.rows[0] || {};
        
        const spLogsResult = await pool.query(
            `SELECT process_step, scanned_by, scanned_at, status, rework_reason
             FROM smt_inspections
             WHERE work_order_id = $1 AND serial_id IS NULL
             ORDER BY scanned_at ASC`,
            [serial.work_order_id]
        );
        const spLogs = spLogsResult.rows.map((row: any) => ({
            process_step: row.process_step || '-',
            status: (row.status || '').toUpperCase(),
            scanned_by: row.scanned_by || '-',
            scanned_at: row.scanned_at,
            rework_reason: row.rework_reason || null
        }));

        // Normalize backend status to production-display values
        const normalizeBackendStatus = (status: string): string => {
            switch ((status || '').toUpperCase()) {
                case 'ACCEPTED': return 'PASS';
                case 'PASS':     return 'PASS';
                case 'FAILED':   return 'FAIL';
                case 'FAIL':     return 'FAIL';
                case 'REWORK':   return 'REWORK';
                case 'RESOLVED': return 'RESOLVED';
                default: return (status || '').toUpperCase();
            }
        };

        // Fetch Backend process scan history if applicable
        let backendScanHistory: any[] = [];
        try {
            const backendRes = await backendPool.query(
                `SELECT 
                    ps.stage_code,
                    ps.stage_name AS station,
                    ps.stage_order,
                    s.scan_result AS status,
                    s.scanned_by,
                    s.scanned_at,
                    s.remarks
                FROM scans s
                JOIN production_stages ps ON s.stage_id = ps.id
                WHERE s.barcode = $1
                ORDER BY s.scanned_at ASC`,
                [serial.serial_number]
            );
            backendScanHistory = backendRes.rows.map((row: any) => ({
                stage_code: row.stage_code || null,
                station: row.station,
                stage_order: row.stage_order,
                status: normalizeBackendStatus(row.status),
                scanned_by: row.scanned_by || '-',
                scanned_at: row.scanned_at,
                remarks: row.remarks || null,
            }));
        } catch (bErr: any) {
            logger.warn('Failed to fetch backend scan history:', bErr.message);
        }

        return res.status(200).json({
            serial_number: serial.serial_number,
            serial_format: serial.serial_format,
            work_order_id: serial.work_order_id,
            product_name: serial.product_name || '-',
            quantity: serial.quantity || '-',
            line_id: serial.line_id || '-',
            sides: serial.sides || '-',
            has_smt: serial.has_smt ?? true,
            has_backend: serial.has_backend ?? true,
            selected_stages: serial.selected_stages || null,
            current_stage: currentStage,
            current_status: currentStatus,
            final_status_label: finalStatusLabel,
            created_at: serial.created_at,
            total_failures: totalFailures,
            total_reworks: totalReworks,
            total_passed: totalPassed,
            scan_history: history,
            backend_scan_history: backendScanHistory,
            solder_paste: {
                barcode: sp.solder_paste_barcode || '-',
                status: sp.solder_paste_status || 'Pending',
                stage1: {
                    operator: sp.solder_paste_stage1_operator || '-',
                    employee_code: sp.solder_paste_stage1_employee_code || '-',
                    completed_at: sp.solder_paste_stage1_at || null,
                    status: sp.solder_paste_stage1_status || 'Pending'
                },
                stage2: {
                    start_at: sp.solder_paste_stage2_start_at || null,
                    status: sp.solder_paste_stage2_status || 'Pending'
                },
                stage3: {
                    start_at: sp.solder_paste_stage3_start_at || null,
                    completed_at: sp.solder_paste_stage3_completed_at || null,
                    operator: sp.solder_paste_stage3_operator || '-',
                    employee_code: sp.solder_paste_stage3_employee_code || '-',
                    status: sp.solder_paste_stage3_status || 'Pending'
                },
                logs: spLogs
            }
        });

    } catch (err: any) {
        logger.error('❌ Error in trackSerialNumber:', err);
        return res.status(500).json({ error: 'Failed to retrieve traceability data: ' + err.message });
    }
};

export const trackWorkOrder = async (req: Request, res: Response) => {
    const { woId } = req.params;
    const { page = '1', limit = '50', search = '', filterDate = '', filterStatus = '' } = req.query;

    if (!woId || woId.trim() === '') {
        return res.status(400).json({ error: 'Work Order ID is required.' });
    }

    const inputValue = woId.trim().toUpperCase();
    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const offset = (pageNum - 1) * limitNum;
    
    const searchStr = (search as string).trim() ? `%${(search as string).trim()}%` : null;
    const dateStr = (filterDate as string).trim() || null;
    const statusStr = (filterStatus as string).trim() || null;

    try {
        // 1. Find the work order record
        const woResult = await pool.query(
            `SELECT * FROM smt_work_orders WHERE id = $1 OR po_id = $1 LIMIT 1`,
            [inputValue]
        );

        if ((woResult.rowCount ?? 0) === 0) {
            return res.status(404).json({ error: `Work Order "${inputValue}" was not found in the system.`, code: 'WORK_ORDER_NOT_FOUND' });
        }

        const wo = woResult.rows[0];

        // 2. Fetch all serials and aggregate their history using SQL
        const serialsResult = await pool.query(`
            WITH latest_overall AS (
                SELECT DISTINCT ON (serial_id) serial_id, process_step as current_stage, status as current_status
                FROM smt_inspections
                WHERE serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1)
                ORDER BY serial_id, scanned_at DESC, id DESC
            ),
            latest_steps AS (
                SELECT serial_id, process_step, status
                FROM (
                    SELECT serial_id, process_step, status,
                           row_number() over(partition by serial_id, process_step order by scanned_at desc, id desc) as rn
                    FROM smt_inspections
                    WHERE serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1)
                ) sub WHERE rn = 1
            ),
            stats AS (
                SELECT serial_id,
                       count(case when status IN ('REWORK', 'FAIL') then 1 end) as total_failures,
                       count(case when process_step = 'Rework' then 1 end) as total_reworks,
                       count(case when process_step = 'Debug' then 1 end) as total_debugs,
                       count(case when status = 'PASS' then 1 end) as total_passed
                FROM smt_inspections
                WHERE serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1)
                GROUP BY serial_id
            ),
            combined_serials AS (
                SELECT sn.id, sn.serial_number, sn.serial_format, sn.created_at,
                       lo.current_stage,
                       lo.current_status,
                       COALESCE(st.total_failures, 0) as total_failures,
                       COALESCE(st.total_reworks, 0) as total_reworks,
                       COALESCE(st.total_debugs, 0) as total_debugs,
                       COALESCE(st.total_passed, 0) as total_passed,
                       (
                           SELECT json_object_agg(ls.process_step, ls.status)
                           FROM latest_steps ls WHERE ls.serial_id = sn.id
                       ) as step_statuses,
                       (
                           SELECT ls.status FROM latest_steps ls WHERE ls.serial_id = sn.id AND ls.process_step = 'SMT FG'
                       ) as smt_fg_status
                FROM smt_serial_numbers sn
                LEFT JOIN latest_overall lo ON sn.id = lo.serial_id
                LEFT JOIN stats st ON sn.id = st.serial_id
                WHERE sn.work_order_id = $1
            ),
            filtered_serials AS (
                SELECT * FROM combined_serials
                WHERE 
                    ($2::text IS NULL OR serial_number ILIKE $2)
                    AND ($3::date IS NULL OR DATE(created_at) = $3)
                    AND (
                        $4::text IS NULL 
                        OR ($4 = 'COMPLETED' AND smt_fg_status = 'PASS')
                        OR ($4 = 'PENDING' AND (smt_fg_status IS NULL OR smt_fg_status != 'PASS'))
                    )
            ),
            totals AS (
                SELECT 
                    COUNT(*) as total_filtered,
                    COUNT(CASE WHEN smt_fg_status = 'PASS' THEN 1 END) as total_completed,
                    COUNT(CASE WHEN smt_fg_status IS NULL OR smt_fg_status != 'PASS' THEN 1 END) as total_pending,
                    (SELECT COUNT(*) FROM combined_serials) as total_all
                FROM filtered_serials
            )
            SELECT f.*, t.total_filtered, t.total_completed, t.total_pending, t.total_all
            FROM filtered_serials f
            CROSS JOIN totals t
            ORDER BY f.id ASC
            LIMIT $5 OFFSET $6
        `, [wo.id, searchStr, dateStr, statusStr, limitNum, offset]);

        const stepNames = ['Serial Number', 'Printing', 'SPI', 'Pre AOI', 'Post AOI', 'Rework', 'SMT FG'];

        const mappedSerials = serialsResult.rows.map((s: any) => {
            const step_status: { [key: string]: string } = {};
            stepNames.forEach(step => {
                if (s.step_statuses && s.step_statuses[step]) {
                    step_status[step] = s.step_statuses[step];
                } else {
                    step_status[step] = '-';
                }
            });

            let finalStatusLabel = 'Pending';
            if (step_status['SMT FG'] === 'PASS') {
                finalStatusLabel = 'Completed';
            }

            return {
                serial_number: s.serial_number,
                current_stage: s.current_stage || 'Pending',
                current_status: s.current_status || 'PENDING',
                final_status_label: finalStatusLabel,
                total_failures: Number(s.total_failures) || 0,
                total_reworks: Number(s.total_reworks) || 0,
                total_debugs: Number(s.total_debugs) || 0,
                total_passed: Number(s.total_passed) || 0,
                step_status: step_status,
                created_at: s.created_at
            };
        });

        const totalFiltered = serialsResult.rows.length > 0 ? Number(serialsResult.rows[0].total_filtered) : 0;
        const totalCompleted = serialsResult.rows.length > 0 ? Number(serialsResult.rows[0].total_completed) : 0;
        const totalPending = serialsResult.rows.length > 0 ? Number(serialsResult.rows[0].total_pending) : 0;
        const totalAll = serialsResult.rows.length > 0 ? Number(serialsResult.rows[0].total_all) : 0;

        const spLogsResult = await pool.query(
            `SELECT process_step, scanned_by, scanned_at, status, rework_reason
             FROM smt_inspections
             WHERE work_order_id = $1 AND serial_id IS NULL
             ORDER BY scanned_at ASC`,
            [wo.id]
        );
        const spLogs = spLogsResult.rows.map((row: any) => ({
            process_step: row.process_step || '-',
            status: (row.status || '').toUpperCase(),
            scanned_by: row.scanned_by || '-',
            scanned_at: row.scanned_at,
            rework_reason: row.rework_reason || null
        }));

        return res.status(200).json({
            work_order_id: wo.id || wo.work_order_id,
            product_name: wo.product_name,
            quantity: wo.quantity,
            line_id: wo.line_id,
            sides: wo.sides || '-',
            has_smt: wo.has_smt ?? true,
            has_backend: wo.has_backend ?? true,
            total_serials: totalAll,
            total_filtered: totalFiltered,
            completed_count: totalCompleted,
            pending_count: totalPending,
            page: pageNum,
            limit: limitNum,
            serials: mappedSerials,
            solder_paste: {
                barcode: wo.solder_paste_barcode || '-',
                status: wo.solder_paste_status || 'Pending',
                stage1: {
                    operator: wo.solder_paste_stage1_operator || '-',
                    employee_code: wo.solder_paste_stage1_employee_code || '-',
                    completed_at: wo.solder_paste_stage1_at || null,
                    status: wo.solder_paste_stage1_status || 'Pending'
                },
                stage2: {
                    start_at: wo.solder_paste_stage2_start_at || null,
                    status: wo.solder_paste_stage2_status || 'Pending'
                },
                stage3: {
                    start_at: wo.solder_paste_stage3_start_at || null,
                    completed_at: wo.solder_paste_stage3_completed_at || null,
                    operator: wo.solder_paste_stage3_operator || '-',
                    employee_code: wo.solder_paste_stage3_employee_code || '-',
                    status: wo.solder_paste_stage3_status || 'Pending'
                },
                logs: spLogs
            }
        });

    } catch (err: any) {
        logger.error('❌ Error in trackWorkOrder:', err);
        return res.status(500).json({ error: 'Failed to retrieve traceability data: ' + err.message });
    }
};

export const getCountDetails = async (req: Request, res: Response) => {
    const { workOrderId, stage, type, page = '1', limit = '10', search = '' } = req.query;

    if (!workOrderId) {
        return res.status(400).json({ error: 'workOrderId is required.' });
    }

    const woIdStr = (workOrderId as string).trim().toUpperCase();
    const stageStr = (stage as string || '').trim();
    const typeStr = (type as string || '').trim();
    const pageNum = parseInt(page as string || '1');
    const limitNum = parseInt(limit as string || '10');
    const searchStr = (search as string || '').trim().toUpperCase();

    try {
        // Get all serial numbers under this Work Order
        const serialsResult = await pool.query(
            `SELECT sn.id, sn.serial_number, sn.serial_format, sn.created_at, sn.created_by, sn.status as main_status
             FROM smt_serial_numbers sn
             WHERE sn.work_order_id = $1
             ORDER BY sn.id ASC`,
            [woIdStr]
        );

        // Get all inspections under this Work Order
        const inspectionsResult = await pool.query(
            `SELECT i.serial_id, i.process_step, i.scanned_by, i.scanned_at, i.status, i.rework_reason
             FROM smt_inspections i
             JOIN smt_serial_numbers sn ON i.serial_id = sn.id
             WHERE sn.work_order_id = $1
             ORDER BY i.scanned_at ASC`,
            [woIdStr]
        );

        const inspectionsBySerial: Record<number, any[]> = {};
        inspectionsResult.rows.forEach((row: any) => {
            if (!inspectionsBySerial[row.serial_id]) {
                inspectionsBySerial[row.serial_id] = [];
            }
            inspectionsBySerial[row.serial_id].push(row);
        });

        const mappedSerials = serialsResult.rows.map((sn: any) => {
            const history = inspectionsBySerial[sn.id] || [];
            const stepLatest: Record<string, any> = {};
            history.forEach((insp: any) => {
                stepLatest[insp.process_step] = insp;
            });
            return {
                id: sn.id,
                serial_number: sn.serial_number,
                serial_format: sn.serial_format,
                created_at: sn.created_at,
                created_by: sn.created_by,
                main_status: sn.main_status,
                history,
                stepLatest
            };
        });

        const normStage = stageStr.toLowerCase();
        const normType = typeStr.toLowerCase();

        // Dynamic Previous Stage Calculator for SMT
        const getSMTPreviousStage = (s: any, currentProcessStage: string) => {
            const stg = currentProcessStage.toLowerCase();
            if (stg === 'printing') {
                return 'Serial Number';
            }
            if (stg === 'spi') {
                return 'Printing';
            }
            if (stg === 'pre aoi' || stg === 'pre_aoi') {
                return 'SPI';
            }
            if (stg === 'post aoi' || stg === 'post_aoi') {
                return 'Pre AOI';
            }
            if (stg === 'rework') {
                return 'Post AOI';
            }
            if (stg === 'smt fg' || stg === 'smt_fg') {
                return (s && s.stepLatest && s.stepLatest['Rework']) ? 'Rework' : 'Post AOI';
            }
            if (stg === 'work order' || stg === 'work_order' || stg === 'work order history' || stg === 'work_order_history') {
                return (s && s.stepLatest && s.stepLatest['Rework']) ? 'Rework' : 'Post AOI';
            }
            return '-';
        };

        let filtered: any[] = [];

        switch (normStage) {
            case 'work order':
            case 'work_order':
            case 'work order history':
            case 'work_order_history': {
                if (normType === 'passed' || normType === 'completed') {
                    // SMT FG must be PASS
                    filtered = mappedSerials.filter(s => s.stepLatest['SMT FG']?.status === 'PASS').map(s => ({
                        serial_number: s.serial_number,
                        status: 'PASS',
                        scanned_by: s.stepLatest['SMT FG']?.scanned_by || 'System',
                        scanned_at: s.stepLatest['SMT FG']?.scanned_at || s.created_at,
                        previous_stage: getSMTPreviousStage(s, stageStr),
                        rework_reason: null
                    }));
                } else if (normType === 'pending' || normType === 'balance') {
                    // SMT FG is NOT PASS
                    filtered = mappedSerials.filter(s => s.stepLatest['SMT FG']?.status !== 'PASS').map(s => ({
                        serial_number: s.serial_number,
                        status: 'PENDING',
                        scanned_by: null,
                        scanned_at: null,
                        previous_stage: getSMTPreviousStage(s, stageStr),
                        rework_reason: null
                    }));
                } else {
                    // total/scanned
                    filtered = mappedSerials.map(s => ({
                        serial_number: s.serial_number,
                        status: s.stepLatest['SMT FG']?.status || 'PENDING',
                        scanned_by: s.created_by || 'System',
                        scanned_at: s.created_at,
                        previous_stage: getSMTPreviousStage(s, stageStr),
                        rework_reason: null
                    }));
                }
                break;
            }

            case 'serial number':
            case 'serial_number': {
                filtered = mappedSerials.map(s => ({
                    serial_number: s.serial_number,
                    status: 'GENERATED',
                    scanned_by: s.created_by || 'System',
                    scanned_at: s.created_at,
                    previous_stage: getSMTPreviousStage(s, stageStr),
                    rework_reason: null
                }));
                break;
            }


            case 'printing': {
                if (normType === 'passed' || normType === 'scanned') {
                    filtered = mappedSerials.filter(s => s.stepLatest['Printing']?.status === 'PASS').map(s => ({
                        serial_number: s.serial_number,
                        status: 'PASS',
                        scanned_by: s.stepLatest['Printing']?.scanned_by,
                        scanned_at: s.stepLatest['Printing']?.scanned_at,
                        previous_stage: getSMTPreviousStage(s, stageStr),
                        rework_reason: null
                    }));
                } else if (normType === 'failed') {
                    filtered = mappedSerials.filter(s => s.history.some((h: any) => h.process_step === 'Printing' && h.status === 'FAIL')).map(s => {
                        const failInsp = s.history.find((h: any) => h.process_step === 'Printing' && h.status === 'FAIL');
                        return {
                            serial_number: s.serial_number,
                            status: s.stepLatest['Printing']?.status || 'FAIL',
                            scanned_by: failInsp?.scanned_by || s.stepLatest['Printing']?.scanned_by,
                            scanned_at: failInsp?.scanned_at || s.stepLatest['Printing']?.scanned_at,
                            previous_stage: getSMTPreviousStage(s, stageStr),
                            rework_reason: failInsp?.rework_reason || s.stepLatest['Printing']?.rework_reason
                        };
                    });
                } else if (normType === 'pending') {
                    filtered = mappedSerials.filter(s => s.stepLatest['Printing']?.status !== 'PASS').map(s => ({
                        serial_number: s.serial_number,
                        status: 'PENDING',
                        scanned_by: null,
                        scanned_at: null,
                        previous_stage: getSMTPreviousStage(s, stageStr),
                        rework_reason: null
                    }));
                } else {
                    filtered = mappedSerials.map(s => ({
                        serial_number: s.serial_number,
                        status: s.stepLatest['Printing']?.status || 'PENDING',
                        scanned_by: s.stepLatest['Printing']?.scanned_by,
                        scanned_at: s.stepLatest['Printing']?.scanned_at,
                        previous_stage: getSMTPreviousStage(s, stageStr),
                        rework_reason: s.stepLatest['Printing']?.rework_reason
                    }));
                }
                break;
            }

            case 'spi': {
                if (normType === 'passed' || normType === 'scanned') {
                    filtered = mappedSerials.filter(s => s.stepLatest['SPI']?.status === 'PASS').map(s => ({
                        serial_number: s.serial_number,
                        status: 'PASS',
                        scanned_by: s.stepLatest['SPI']?.scanned_by,
                        scanned_at: s.stepLatest['SPI']?.scanned_at,
                        previous_stage: getSMTPreviousStage(s, stageStr),
                        rework_reason: null
                    }));
                } else if (normType === 'failed') {
                    filtered = mappedSerials.filter(s => s.history.some((h: any) => h.process_step === 'SPI' && h.status === 'FAIL')).map(s => {
                        const failInsp = s.history.find((h: any) => h.process_step === 'SPI' && h.status === 'FAIL');
                        return {
                            serial_number: s.serial_number,
                            status: s.stepLatest['SPI']?.status || 'FAIL',
                            scanned_by: failInsp?.scanned_by || s.stepLatest['SPI']?.scanned_by,
                            scanned_at: failInsp?.scanned_at || s.stepLatest['SPI']?.scanned_at,
                            previous_stage: getSMTPreviousStage(s, stageStr),
                            rework_reason: failInsp?.rework_reason || s.stepLatest['SPI']?.rework_reason
                        };
                    });
                } else if (normType === 'printing_passed' || normType === 'previous_passed') {
                    filtered = mappedSerials.filter(s => s.stepLatest['Printing']?.status === 'PASS').map(s => ({
                        serial_number: s.serial_number,
                        status: 'PASS',
                        scanned_by: s.stepLatest['Printing']?.scanned_by,
                        scanned_at: s.stepLatest['Printing']?.scanned_at,
                        previous_stage: getSMTPreviousStage(s, stageStr),
                        rework_reason: null
                    }));
                } else if (normType === 'pending') {
                    filtered = mappedSerials.filter(s => s.stepLatest['SPI']?.status !== 'PASS').map(s => ({
                        serial_number: s.serial_number,
                        status: 'PENDING',
                        scanned_by: null,
                        scanned_at: null,
                        previous_stage: getSMTPreviousStage(s, stageStr),
                        rework_reason: null
                    }));
                } else {
                    filtered = mappedSerials.map(s => ({
                        serial_number: s.serial_number,
                        status: s.stepLatest['SPI']?.status || 'PENDING',
                        scanned_by: s.stepLatest['SPI']?.scanned_by,
                        scanned_at: s.stepLatest['SPI']?.scanned_at,
                        previous_stage: getSMTPreviousStage(s, stageStr),
                        rework_reason: s.stepLatest['SPI']?.rework_reason
                    }));
                }
                break;
            }

            case 'pre aoi':
            case 'pre_aoi': {
                if (normType === 'passed') {
                    filtered = mappedSerials.filter(s => s.stepLatest['Pre AOI']?.status === 'PASS').map(s => ({
                        serial_number: s.serial_number,
                        status: 'PASS',
                        scanned_by: s.stepLatest['Pre AOI']?.scanned_by,
                        scanned_at: s.stepLatest['Pre AOI']?.scanned_at,
                        previous_stage: getSMTPreviousStage(s, stageStr),
                        rework_reason: null
                    }));
                } else if (normType === 'failed') {
                    filtered = mappedSerials.filter(s => s.history.some((h: any) => (h.process_step === 'Pre AOI' || h.process_step === 'Pre_AOI') && h.status === 'FAIL')).map(s => {
                        const failInsp = s.history.find((h: any) => (h.process_step === 'Pre AOI' || h.process_step === 'Pre_AOI') && h.status === 'FAIL');
                        return {
                            serial_number: s.serial_number,
                            status: s.stepLatest['Pre AOI']?.status || 'FAIL',
                            scanned_by: failInsp?.scanned_by || s.stepLatest['Pre AOI']?.scanned_by,
                            scanned_at: failInsp?.scanned_at || s.stepLatest['Pre AOI']?.scanned_at,
                            previous_stage: getSMTPreviousStage(s, stageStr),
                            rework_reason: failInsp?.rework_reason || s.stepLatest['Pre AOI']?.rework_reason
                        };
                    });
                } else if (normType === 'spi_passed' || normType === 'previous_passed') {
                    filtered = mappedSerials.filter(s => s.stepLatest['SPI']?.status === 'PASS').map(s => ({
                        serial_number: s.serial_number,
                        status: 'PASS',
                        scanned_by: s.stepLatest['SPI']?.scanned_by,
                        scanned_at: s.stepLatest['SPI']?.scanned_at,
                        previous_stage: getSMTPreviousStage(s, stageStr),
                        rework_reason: null
                    }));
                } else if (normType === 'pending') {
                    filtered = mappedSerials.filter(s => s.stepLatest['Pre AOI']?.status !== 'PASS').map(s => ({
                        serial_number: s.serial_number,
                        status: 'PENDING',
                        scanned_by: null,
                        scanned_at: null,
                        previous_stage: getSMTPreviousStage(s, stageStr),
                        rework_reason: null
                    }));
                } else if (normType === 'scanned') {
                    filtered = mappedSerials.filter(s => s.stepLatest['Pre AOI'] !== undefined).map(s => ({
                        serial_number: s.serial_number,
                        status: s.stepLatest['Pre AOI']?.status,
                        scanned_by: s.stepLatest['Pre AOI']?.scanned_by,
                        scanned_at: s.stepLatest['Pre AOI']?.scanned_at,
                        previous_stage: getSMTPreviousStage(s, stageStr),
                        rework_reason: s.stepLatest['Pre AOI']?.rework_reason
                    }));
                } else {
                    filtered = mappedSerials.map(s => ({
                        serial_number: s.serial_number,
                        status: s.stepLatest['Pre AOI']?.status || 'PENDING',
                        scanned_by: s.stepLatest['Pre AOI']?.scanned_by,
                        scanned_at: s.stepLatest['Pre AOI']?.scanned_at,
                        previous_stage: getSMTPreviousStage(s, stageStr),
                        rework_reason: s.stepLatest['Pre AOI']?.rework_reason
                    }));
                }
                break;
            }

            case 'post aoi':
            case 'post_aoi': {
                if (normType === 'passed') {
                    filtered = mappedSerials.filter(s => s.stepLatest['Post AOI']?.status === 'PASS').map(s => ({
                        serial_number: s.serial_number,
                        status: 'PASS',
                        scanned_by: s.stepLatest['Post AOI']?.scanned_by,
                        scanned_at: s.stepLatest['Post AOI']?.scanned_at,
                        previous_stage: getSMTPreviousStage(s, stageStr),
                        rework_reason: null
                    }));
                } else if (normType === 'failed') {
                    filtered = mappedSerials.filter(s => s.history.some((h: any) => (h.process_step === 'Post AOI' || h.process_step === 'Post_AOI') && h.status === 'FAIL')).map(s => {
                        const failInsp = s.history.find((h: any) => (h.process_step === 'Post AOI' || h.process_step === 'Post_AOI') && h.status === 'FAIL');
                        return {
                            serial_number: s.serial_number,
                            status: s.stepLatest['Post AOI']?.status || 'FAIL',
                            scanned_by: failInsp?.scanned_by || s.stepLatest['Post AOI']?.scanned_by,
                            scanned_at: failInsp?.scanned_at || s.stepLatest['Post AOI']?.scanned_at,
                            previous_stage: getSMTPreviousStage(s, stageStr),
                            rework_reason: failInsp?.rework_reason || s.stepLatest['Post AOI']?.rework_reason
                        };
                    });
                } else if (normType === 'pre_aoi_passed' || normType === 'previous_passed') {
                    filtered = mappedSerials.filter(s => s.stepLatest['Pre AOI']?.status === 'PASS').map(s => ({
                        serial_number: s.serial_number,
                        status: 'PASS',
                        scanned_by: s.stepLatest['Pre AOI']?.scanned_by,
                        scanned_at: s.stepLatest['Pre AOI']?.scanned_at,
                        previous_stage: getSMTPreviousStage(s, stageStr),
                        rework_reason: null
                    }));
                } else if (normType === 'pending') {
                    filtered = mappedSerials.filter(s => s.stepLatest['Post AOI']?.status !== 'PASS').map(s => ({
                        serial_number: s.serial_number,
                        status: 'PENDING',
                        scanned_by: null,
                        scanned_at: null,
                        previous_stage: getSMTPreviousStage(s, stageStr),
                        rework_reason: null
                    }));
                } else if (normType === 'scanned') {
                    filtered = mappedSerials.filter(s => s.stepLatest['Post AOI'] !== undefined).map(s => ({
                        serial_number: s.serial_number,
                        status: s.stepLatest['Post AOI']?.status,
                        scanned_by: s.stepLatest['Post AOI']?.scanned_by,
                        scanned_at: s.stepLatest['Post AOI']?.scanned_at,
                        previous_stage: getSMTPreviousStage(s, stageStr),
                        rework_reason: s.stepLatest['Post AOI']?.rework_reason
                    }));
                } else {
                    filtered = mappedSerials.map(s => ({
                        serial_number: s.serial_number,
                        status: s.stepLatest['Post AOI']?.status || 'PENDING',
                        scanned_by: s.stepLatest['Post AOI']?.scanned_by,
                        scanned_at: s.stepLatest['Post AOI']?.scanned_at,
                        previous_stage: getSMTPreviousStage(s, stageStr),
                        rework_reason: s.stepLatest['Post AOI']?.rework_reason
                    }));
                }
                break;
            }

            case 'rework': {
                const processedReworks = mappedSerials.map((s: any) => {
                    const sorted = [...s.history].sort((a: any, b: any) => new Date(a.scanned_at).getTime() - new Date(b.scanned_at).getTime());
                    let latestFailure: any = null;
                    for (let i = sorted.length - 1; i >= 0; i--) {
                        if (sorted[i].process_step === 'Post AOI' && sorted[i].status === 'FAIL') {
                            latestFailure = sorted[i];
                            break;
                        }
                    }
                    if (!latestFailure) return null;

                    let latestRepair: any = null;
                    for (let i = sorted.length - 1; i >= 0; i--) {
                        if (sorted[i].process_step === 'Rework' && sorted[i].status === 'PASS' && new Date(sorted[i].scanned_at).getTime() > new Date(latestFailure.scanned_at).getTime()) {
                            latestRepair = sorted[i];
                            break;
                        }
                    }

                    let latestRevalidation: any = null;
                    if (latestRepair) {
                        for (let i = sorted.length - 1; i >= 0; i--) {
                            if (sorted[i].process_step === 'Post AOI' && new Date(sorted[i].scanned_at).getTime() > new Date(latestRepair.scanned_at).getTime()) {
                                latestRevalidation = sorted[i];
                                break;
                            }
                        }
                    }

                    let currentStatus = 'FAILED';
                    if (latestRevalidation) {
                        currentStatus = latestRevalidation.status === 'PASS' ? 'REVALIDATED_PASS' : 'FAILED_AGAIN';
                    } else if (latestRepair) {
                        currentStatus = 'READY_FOR_RECHECK';
                    }

                    return {
                        serial_number: s.serial_number,
                        status: currentStatus,
                        failure_remark: latestFailure.rework_reason || 'Defect Registered',
                        failed_time: latestFailure.scanned_at,
                        failed_by: latestFailure.scanned_by,
                        repair_remark: latestRepair ? latestRepair.rework_reason : null,
                        repair_time: latestRepair ? latestRepair.scanned_at : null,
                        repaired_by: latestRepair ? latestRepair.scanned_by : null,
                        previous_stage: 'Post AOI'
                    };
                }).filter((item: any) => item !== null);

                if (normType === 'pending') {
                    filtered = processedReworks.filter((s: any) => s.status === 'FAILED' || s.status === 'FAILED_AGAIN').map((s: any) => ({
                        serial_number: s.serial_number,
                        status: s.status === 'FAILED_AGAIN' ? 'FAILED AGAIN' : 'PENDING REPAIR',
                        scanned_by: s.failed_by,
                        scanned_at: s.failed_time,
                        previous_stage: s.previous_stage,
                        rework_reason: s.failure_remark
                    }));
                } else if (normType === 'passed' || normType === 'repaired') {
                    filtered = processedReworks.filter((s: any) => s.status === 'READY_FOR_RECHECK' || s.status === 'REVALIDATED_PASS').map((s: any) => ({
                        serial_number: s.serial_number,
                        status: s.status === 'REVALIDATED_PASS' ? 'PASSED RECHECK' : 'READY FOR RECHECK',
                        scanned_by: s.repaired_by,
                        scanned_at: s.repair_time,
                        previous_stage: s.previous_stage,
                        rework_reason: s.repair_remark
                    }));
                } else {
                    filtered = processedReworks.map((s: any) => ({
                        serial_number: s.serial_number,
                        status: s.status,
                        scanned_by: s.failed_by,
                        scanned_at: s.failed_time,
                        previous_stage: s.previous_stage,
                        rework_reason: s.failure_remark
                    }));
                }
                break;
            }

            case 'smt fg':
            case 'smt_fg': {
                if (normType === 'passed' || normType === 'scanned') {
                    filtered = mappedSerials.filter(s => s.stepLatest['SMT FG']?.status === 'PASS').map(s => ({
                        serial_number: s.serial_number,
                        status: 'PASS',
                        scanned_by: s.stepLatest['SMT FG']?.scanned_by,
                        scanned_at: s.stepLatest['SMT FG']?.scanned_at,
                        previous_stage: getSMTPreviousStage(s, stageStr),
                        rework_reason: null
                    }));
                } else if (normType === 'failed') {
                    filtered = mappedSerials.filter(s => s.history.some((h: any) => (h.process_step === 'SMT FG' || h.process_step === 'SMT_FG') && h.status === 'FAIL')).map(s => {
                        const failInsp = s.history.find((h: any) => (h.process_step === 'SMT FG' || h.process_step === 'SMT_FG') && h.status === 'FAIL');
                        return {
                            serial_number: s.serial_number,
                            status: s.stepLatest['SMT FG']?.status || 'FAIL',
                            scanned_by: failInsp?.scanned_by || s.stepLatest['SMT FG']?.scanned_by,
                            scanned_at: failInsp?.scanned_at || s.stepLatest['SMT FG']?.scanned_at,
                            previous_stage: getSMTPreviousStage(s, stageStr),
                            rework_reason: failInsp?.rework_reason || s.stepLatest['SMT FG']?.rework_reason
                        };
                    });
                } else if (normType === 'post_aoi_passed' || normType === 'previous_passed') {
                    filtered = mappedSerials.filter(s => s.stepLatest['Post AOI']?.status === 'PASS').map(s => ({
                        serial_number: s.serial_number,
                        status: 'PASS',
                        scanned_by: s.stepLatest['Post AOI']?.scanned_by,
                        scanned_at: s.stepLatest['Post AOI']?.scanned_at,
                        previous_stage: getSMTPreviousStage(s, stageStr),
                        rework_reason: null
                    }));
                } else if (normType === 'pending') {
                    filtered = mappedSerials.filter(s => s.stepLatest['SMT FG']?.status !== 'PASS').map(s => ({
                        serial_number: s.serial_number,
                        status: 'PENDING',
                        scanned_by: null,
                        scanned_at: null,
                        previous_stage: getSMTPreviousStage(s, stageStr),
                        rework_reason: null
                    }));
                } else {
                    filtered = mappedSerials.map(s => ({
                        serial_number: s.serial_number,
                        status: s.stepLatest['SMT FG']?.status || 'PENDING',
                        scanned_by: s.stepLatest['SMT FG']?.scanned_by,
                        scanned_at: s.stepLatest['SMT FG']?.scanned_at,
                        previous_stage: getSMTPreviousStage(s, stageStr),
                        rework_reason: s.stepLatest['SMT FG']?.rework_reason
                    }));
                }
                break;
            }

            default:
                filtered = mappedSerials.map(s => ({
                    serial_number: s.serial_number,
                    status: s.main_status || 'PENDING',
                    scanned_by: s.created_by,
                    scanned_at: s.created_at,
                    previous_stage: getSMTPreviousStage(s, stageStr),
                    rework_reason: null
                }));
                break;
        }

        if (searchStr) {
            filtered = filtered.filter(item => (item.serial_number || '').toUpperCase().includes(searchStr));
        }

        const total = filtered.length;
        const startIndex = (pageNum - 1) * limitNum;
        const paginated = filtered.slice(startIndex, startIndex + limitNum);

        return res.status(200).json({
            total,
            page: pageNum,
            limit: limitNum,
            data: paginated
        });

    } catch (err: any) {
        logger.error('❌ Error in getCountDetails:', err);
        return res.status(500).json({ error: 'Failed to retrieve count details: ' + err.message });
    }
};

export const downloadWorkOrderExcel = async (req: Request, res: Response) => {
    const { woId } = req.params;

    if (!woId || woId.trim() === '') {
        return res.status(400).json({ error: 'Work Order ID is required.' });
    }

    const inputValue = woId.trim().toUpperCase();

    try {
        // 1. Fetch Work Order Details
        const woResult = await pool.query(
            `SELECT * FROM smt_work_orders WHERE id = $1 OR po_id = $1 LIMIT 1`,
            [inputValue]
        );

        if ((woResult.rowCount ?? 0) === 0) {
            return res.status(404).json({ error: `Work Order "${inputValue}" was not found in the system.`, code: 'WORK_ORDER_NOT_FOUND' });
        }

        const wo = woResult.rows[0];

        // 2. Fetch all serials and aggregate their history using SQL
        const serialsResult = await pool.query(`
            WITH latest_overall AS (
                SELECT DISTINCT ON (serial_id) serial_id, process_step as current_stage, status as current_status
                FROM smt_inspections
                WHERE serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1)
                ORDER BY serial_id, scanned_at DESC, id DESC
            ),
            latest_steps AS (
                SELECT serial_id, process_step, status
                FROM (
                    SELECT serial_id, process_step, status,
                           row_number() over(partition by serial_id, process_step order by scanned_at desc, id desc) as rn
                    FROM smt_inspections
                    WHERE serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1)
                ) sub WHERE rn = 1
            ),
            stats AS (
                SELECT serial_id,
                       count(case when status IN ('REWORK', 'FAIL') then 1 end) as total_failures,
                       count(case when process_step = 'Rework' then 1 end) as total_reworks,
                       count(case when process_step = 'Debug' then 1 end) as total_debugs,
                       count(case when status = 'PASS' then 1 end) as total_passed
                FROM smt_inspections
                WHERE serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1)
                GROUP BY serial_id
            )
            SELECT sn.id, sn.serial_number, sn.serial_format, sn.created_at,
                   lo.current_stage,
                   lo.current_status,
                   COALESCE(st.total_failures, 0) as total_failures,
                   COALESCE(st.total_reworks, 0) as total_reworks,
                   COALESCE(st.total_debugs, 0) as total_debugs,
                   COALESCE(st.total_passed, 0) as total_passed,
                   (
                       SELECT json_object_agg(ls.process_step, ls.status)
                       FROM latest_steps ls WHERE ls.serial_id = sn.id
                   ) as step_statuses
            FROM smt_serial_numbers sn
            LEFT JOIN latest_overall lo ON sn.id = lo.serial_id
            LEFT JOIN stats st ON sn.id = st.serial_id
            WHERE sn.work_order_id = $1
            ORDER BY sn.id ASC
        `, [wo.id]);

        const serials = serialsResult.rows;

        const normalizeStatus = (status: string): string => {
            switch ((status || '').toUpperCase()) {
                case 'ACCEPTED': return 'PASS';
                case 'PASS':     return 'PASS';
                case 'FAILED':   return 'FAIL';
                case 'FAIL':     return 'FAIL';
                case 'REWORK':   return 'REWORK';
                case 'RESOLVED': return 'RESOLVED';
                default: return (status || '').toUpperCase();
            }
        };

        // Fetch Backend Stages & History
        let backendStagesList: any[] = [];
        let selectedBackendStages: any[] = [];
        if (wo.has_backend) {
            try {
                const bStagesRes = await backendPool.query('SELECT id, stage_code, stage_name, stage_label FROM production_stages ORDER BY stage_order ASC');
                backendStagesList = bStagesRes.rows;
                if (wo.selected_stages) {
                    try {
                        selectedBackendStages = typeof wo.selected_stages === 'string' ? JSON.parse(wo.selected_stages) : wo.selected_stages;
                    } catch (e) {}
                } else {
                    selectedBackendStages = backendStagesList;
                }
            } catch (err: any) {
                logger.warn('Failed to fetch backend stages for excel:', err.message);
            }
        }

        const normalizeStageId = (s: string) => (s || '').toUpperCase().replace(/[\s\-_]/g, '');
        const isBackendStageSelected = (stage: any): boolean => {
            if (!selectedBackendStages || selectedBackendStages.length === 0) return true;
            const codeNorm = normalizeStageId(stage.stage_code);
            const nameNorm = normalizeStageId(stage.stage_name);
            const labelNorm = normalizeStageId(stage.stage_label);
            return selectedBackendStages.some((item: any) => {
                const s = typeof item === 'string' ? item : (item?.stage_code || item?.stage_name || '');
                const sNorm = normalizeStageId(s);
                return sNorm === codeNorm || sNorm === nameNorm || sNorm === labelNorm;
            });
        };

        const activeBackendStages = backendStagesList.filter(isBackendStageSelected);

        const backendHistoryBySerial: { [key: string]: any } = {};
        if (wo.has_backend && serials.length > 0) {
            const serialNumbers = serials.map((s: any) => s.serial_number);
            try {
                const bHistoryRes = await backendPool.query(`
                    WITH latest_backend_steps AS (
                        SELECT barcode, stage_code, station, status
                        FROM (
                            SELECT s.barcode, ps.stage_code, ps.stage_name as station, s.scan_result as status,
                                   row_number() over(partition by s.barcode, ps.stage_code order by s.scanned_at desc, s.id desc) as rn
                            FROM scans s
                            JOIN production_stages ps ON s.stage_id = ps.id
                            WHERE s.barcode = ANY($1)
                        ) sub WHERE rn = 1
                    )
                    SELECT barcode, json_object_agg(stage_code, status) as step_statuses, json_object_agg(station, status) as station_statuses
                    FROM latest_backend_steps
                    GROUP BY barcode
                `, [serialNumbers]);
                
                bHistoryRes.rows.forEach((row: any) => {
                    backendHistoryBySerial[row.barcode] = row;
                });
            } catch (err: any) {
                logger.warn('Failed to fetch backend history for excel:', err.message);
            }
        }

        const smtStepNames = ['Printing', 'SPI', 'Pre AOI', 'Post AOI', 'Rework', 'SMT FG'];

        const mappedSerials = serials.map((s: any) => {
            const step_status: { [key: string]: string } = {};
            smtStepNames.forEach(step => {
                if (s.step_statuses && s.step_statuses[step]) {
                    step_status[step] = normalizeStatus(s.step_statuses[step]);
                } else {
                    step_status[step] = '-';
                }
            });

            const bHistory = backendHistoryBySerial[s.serial_number] || {};
            activeBackendStages.forEach(st => {
                const stepKey = st.stage_code;
                let status = '-';
                if (bHistory.step_statuses && bHistory.step_statuses[stepKey]) {
                    status = bHistory.step_statuses[stepKey];
                } else if (bHistory.station_statuses && bHistory.station_statuses[st.stage_name]) {
                    status = bHistory.station_statuses[st.stage_name];
                }
                step_status[stepKey] = normalizeStatus(status);
            });

            let finalStatusLabel = 'Pending';
            if (step_status['SMT FG'] === 'PASS') {
                finalStatusLabel = 'Completed';
            }

            return {
                serial_number: s.serial_number,
                current_stage: s.current_stage || 'Pending',
                current_status: normalizeStatus(s.current_status || 'PENDING'),
                final_status_label: finalStatusLabel,
                total_failures: Number(s.total_failures) || 0,
                total_reworks: Number(s.total_reworks) || 0,
                total_debugs: Number(s.total_debugs) || 0,
                total_passed: Number(s.total_passed) || 0,
                step_status: step_status,
                created_at: s.created_at
            };
        });

        // 4. Generate Excel Workbook using ExcelJS
        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('SMT WO Report');

        // Common Styles
        const labelStyle = {
            font: { bold: true, color: { argb: 'FF595959' }, name: 'Segoe UI', size: 10 },
            alignment: { horizontal: 'left' }
        };
        const valueStyle = {
            font: { bold: true, name: 'Segoe UI', size: 10 },
            alignment: { horizontal: 'left' }
        };
        const borderStyle = {
            top: { style: 'thin', color: { argb: 'FFE0E0E0' } },
            left: { style: 'thin', color: { argb: 'FFE0E0E0' } },
            bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
            right: { style: 'thin', color: { argb: 'FFE0E0E0' } }
        };

        // Write Metadata Info Cards
        const metadata = [
            { label: 'Work Order ID:', val: wo.id || wo.work_order_id },
            { label: 'Product Name:', val: wo.product_name || '-' },
            { label: 'Total Quantity:', val: `${serials.length} / ${wo.quantity || '-'}` },
            { label: 'Line ID:', val: wo.line_id || '-' },
            { label: 'Report Generated:', val: new Date().toLocaleString() }
        ];

        metadata.forEach((item, index) => {
            const rowNumber = index + 1;
            worksheet.getCell(`A${rowNumber}`).value = item.label;
            worksheet.getCell(`A${rowNumber}`).style = labelStyle;
            worksheet.getCell(`B${rowNumber}`).value = item.val;
            worksheet.getCell(`B${rowNumber}`).style = valueStyle;
        });

        worksheet.addRow([]); // Blank spacer row

        const tableHeaders = [
            'SERIAL NUMBER',
            'CURRENT STAGE',
            'OVERALL STATUS',
            ...smtStepNames.map(s => s.toUpperCase()),
            ...activeBackendStages.map((st: any) => (st.stage_label || st.stage_name).toUpperCase()),
            'TOTAL FAILURES',
            'TOTAL REWORKS'
        ];

        const headerRow = worksheet.addRow(tableHeaders);
        headerRow.height = 26;

        const headerFill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF1E3A8A' } // SMT Navy Blue
        };

        headerRow.eachCell((cell: any) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Segoe UI', size: 10 };
            cell.fill = headerFill;
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = borderStyle;
        });

        // Add Data Rows
        mappedSerials.forEach((s: any) => {
            const rowData = [
                s.serial_number,
                s.current_stage || 'Pending',
                s.final_status_label || 'Pending',
                ...smtStepNames.map(step => s.step_status[step] || '-'),
                ...activeBackendStages.map((st: any) => s.step_status[st.stage_code] || '-'),
                s.total_failures || 0,
                s.total_reworks || 0
            ];
            const dataRow = worksheet.addRow(rowData);
            dataRow.height = 20;

            const isCompleted = s.final_status_label === 'Completed';

            dataRow.eachCell((cell: any, colNumber: number) => {
                cell.font = { name: 'Segoe UI', size: 10 };
                cell.border = borderStyle;

                // Center align stages & stats
                if (colNumber > 1) {
                    cell.alignment = { horizontal: 'center', vertical: 'middle' };
                } else {
                    cell.alignment = { horizontal: 'left', vertical: 'middle' };
                }

                // Overall status cell color
                if (colNumber === 3) {
                    if (isCompleted) {
                        cell.font = { color: { argb: 'FF00B050' }, bold: true, name: 'Segoe UI', size: 10 };
                    } else {
                        cell.font = { color: { argb: 'FFFF8C00' }, bold: true, name: 'Segoe UI', size: 10 }; // Dark Orange
                    }
                }

                // Process Stage Statuses
                if (colNumber >= 4 && colNumber <= (3 + smtStepNames.length + activeBackendStages.length)) {
                    const statusText = cell.value?.toString().toUpperCase();
                    if (statusText === 'PASS') {
                        cell.font = { color: { argb: 'FF00B050' }, bold: true, name: 'Segoe UI', size: 10 };
                    } else if (statusText === 'FAIL' || statusText === 'REWORK') {
                        cell.font = { color: { argb: 'FFFF0000' }, bold: true, name: 'Segoe UI', size: 10 };
                    } else if (statusText === '-') {
                        cell.font = { color: { argb: 'FF94A3B8' }, name: 'Segoe UI', size: 10 };
                    }
                }
            });
        });

        // Set column widths
        worksheet.columns.forEach((column: any) => {
            let maxLen = 0;
            column.eachCell!({ includeEmpty: true }, (cell: any) => {
                if (cell.row && (cell.row as any).number <= 6) return; // Skip metadata
                const len = cell.value ? cell.value.toString().length : 0;
                if (len > maxLen) maxLen = len;
            });
            column.width = maxLen < 15 ? 15 : maxLen + 5;
        });

        worksheet.getColumn(1).width = 25;
        worksheet.getColumn(2).width = 20;
        worksheet.getColumn(3).width = 20;

        // Freeze top 7 rows
        worksheet.views = [{ state: 'frozen', ySplit: 7 }];

        const safeWoId = inputValue.replace(/[^a-zA-Z0-9_-]/g, '_');
        const nowStr = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        const filename = `SMT_WorkOrder_Report_${safeWoId}_${nowStr}.xlsx`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');

        await workbook.xlsx.write(res);
        res.end();

    } catch (err: any) {
        logger.error('❌ Error in downloadWorkOrderExcel:', err);
        return res.status(500).json({ error: 'Failed to download Work Order Excel report: ' + err.message });
    }
};

