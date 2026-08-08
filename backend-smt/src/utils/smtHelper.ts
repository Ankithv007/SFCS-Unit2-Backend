import pool from '../config/db';
import { createLogger } from './logger';

const logger = createLogger('SMT_HELPER');

/**
 * Checks if a specific barcode (by serialId or barcode string) has completed Bottom side processing.
 * Bottom side completion means having a PASS inspection in Post AOI or SMT FG for side = 'bottom'.
 */
export const isBarcodeBottomCompleted = async (
    woId: string,
    serialId: number | null,
    barcode: string,
    clientParam?: any
): Promise<boolean> => {
    const db = clientParam || pool;
    const postAoiPass = await db.query(
        `SELECT 1 FROM smt_inspections i
         JOIN smt_post_aoi_sessions s ON i.post_aoi_session_id = s.id
         WHERE i.work_order_id = $1
           AND (
             ($2::integer IS NOT NULL AND i.serial_id = $2::integer)
             OR (i.scanned_barcode = $3)
           )
           AND i.process_step = 'Post AOI'
           AND LOWER(s.side) = 'bottom'
           AND i.status = 'PASS'
           AND (s.is_deleted = false OR s.is_deleted IS NULL)
         LIMIT 1`,
        [woId, serialId, barcode]
    );
    if (postAoiPass.rows.length > 0) {
        return true;
    }

    const fgPass = await db.query(
        `SELECT 1 FROM smt_inspections i
         JOIN smt_fg_sessions s ON i.fg_session_id = s.id
         WHERE i.work_order_id = $1
           AND (
             ($2::integer IS NOT NULL AND i.serial_id = $2::integer)
             OR (i.scanned_barcode = $3)
           )
           AND i.process_step = 'SMT FG'
           AND LOWER(s.side) = 'bottom'
           AND i.status = 'PASS'
           AND (s.is_deleted = false OR s.is_deleted IS NULL)
         LIMIT 1`,
        [woId, serialId, barcode]
    );
    return fgPass.rows.length > 0;
};

/**
 * Checks if at least one barcode in a Work Order has completed Bottom side processing.
 */
export const hasAnyBarcodeBottomCompleted = async (woId: string, clientParam?: any): Promise<boolean> => {
    const db = clientParam || pool;
    const postAoiPass = await db.query(
        `SELECT 1 FROM smt_inspections i
         JOIN smt_post_aoi_sessions s ON i.post_aoi_session_id = s.id
         WHERE i.work_order_id = $1
           AND i.process_step = 'Post AOI'
           AND LOWER(s.side) = 'bottom'
           AND i.status = 'PASS'
           AND (s.is_deleted = false OR s.is_deleted IS NULL)
         LIMIT 1`,
        [woId]
    );
    if (postAoiPass.rows.length > 0) {
        return true;
    }

    const fgPass = await db.query(
        `SELECT 1 FROM smt_inspections i
         JOIN smt_fg_sessions s ON i.fg_session_id = s.id
         WHERE i.work_order_id = $1
           AND i.process_step = 'SMT FG'
           AND LOWER(s.side) = 'bottom'
           AND i.status = 'PASS'
           AND (s.is_deleted = false OR s.is_deleted IS NULL)
         LIMIT 1`,
        [woId]
    );
    return fgPass.rows.length > 0;
};

/**
 * Resolves the active side for a Work Order.
 * For double-sided (TOP/BOTTOM) Work Orders:
 * Resolves to Top if at least one barcode has completed Bottom side processing.
 * Otherwise resolves to Bottom.
 */
export const resolveWorkOrderSide = async (woId: string, sides: string): Promise<'Top' | 'Bottom'> => {
    const woSides = (sides || '').trim().toLowerCase();
    if (woSides === 'top') {
        return 'Top';
    }
    if (woSides === 'bottom') {
        return 'Bottom';
    }
    if (woSides === 'top / bottom' || woSides.includes('/')) {
        const completedAny = await hasAnyBarcodeBottomCompleted(woId);
        return completedAny ? 'Top' : 'Bottom';
    }
    return 'Top';
};

/**
 * Helper to fetch and validate all required auto-populate details for a work order and determined side.
 */
export const getAutoPopulateDetailsHelper = async (
    woId: string,
    sideOverride: string | undefined,
    sessionTable: string
) => {
    // 1. Fetch Work Order
    const woRes = await pool.query('SELECT * FROM smt_work_orders WHERE id = $1', [woId]);
    if (woRes.rows.length === 0) {
        throw { status: 404, message: `Work Order not found.` };
    }
    const wo = woRes.rows[0];

    // 2. Determine Side
    let side = sideOverride;
    if (!side) {
        if (sessionTable === 'smt_fg_sessions') {
            const woSides = (wo.sides || '').trim().toLowerCase();
            const isDoubleSided = woSides === 'top / bottom' || woSides.includes('/');
            if (isDoubleSided || woSides === 'top') {
                side = 'Top';
            } else {
                side = 'Bottom';
            }
        } else {
            side = await resolveWorkOrderSide(woId, wo.sides);
        }
    }

    // 3. Fetch SMT Printing Session for this side (latest setup, ignoring status)
    const printingRes = await pool.query(
        `SELECT * FROM smt_printing_sessions 
         WHERE work_order_id = $1 
           AND LOWER(side) = $2 
           AND is_deleted = false 
         ORDER BY created_at DESC LIMIT 1`,
        [woId, side.toLowerCase()]
    );
    if (printingRes.rows.length === 0) {
        throw { 
            status: 400, 
            message: `SMT Printing setup information not found for Work Order ${woId} on side ${side}. Please start the SMT Printing stage setup first.` 
        };
    }
    const printingSession = printingRes.rows[0];

    // 4. Fetch Stencil Life Cycle record
    const stencilLcRes = await pool.query(
        `SELECT * FROM smt_stencil_lifecycle 
         WHERE id = $1 
           AND is_deleted = false`,
        [printingSession.stencil_lifecycle_id]
    );
    if (stencilLcRes.rows.length === 0) {
        throw { 
            status: 400, 
            message: `Stencil Life Cycle record missing for this Work Order and Side.` 
        };
    }
    const stencilLc = stencilLcRes.rows[0];

    // 5. Fetch Stencil Location record
    const stencilRackLocationRes = await pool.query(
        `SELECT s.*, COALESCE(states.lifecycle_status, 'ACTIVE') AS lifecycle_status
         FROM stencil_rack_locations s
         LEFT JOIN smt_stencil_lifecycle_states states ON s.id = states.stencil_record_id
         WHERE s.id = $1`,
        [stencilLc.stencil_record_id]
    );
    if (stencilRackLocationRes.rows.length === 0) {
        throw { 
            status: 400, 
            message: `Stencil Rack Location record is missing for the associated stencil.` 
        };
    }
    const stencilRackLocation = stencilRackLocationRes.rows[0];

    // 6. Return response structure
    return {
        workOrderId: wo.id,
        poId: wo.po_id || '',
        productName: wo.product_name || '',
        productDescription: wo.product_description || '',
        numberOfSides: wo.sides || '',
        workOrderQuantity: parseInt(wo.quantity, 10) || 0,
        panelQuantity: parseInt(wo.panel_quantity, 10) || 0,
        stencilName: stencilLc.stencil_name || '',
        jobNumber: stencilRackLocation.job_number || '',
        revision: stencilRackLocation.revision || '',
        thickness: stencilRackLocation.thickness_mills || '',
        manufacturingDate: stencilRackLocation.manufacturing_date || '',
        side: side,
        currentLifeCycleCount: parseInt(stencilLc.current_used_life_cycle, 10) || 0,
        remainingLifeCycleCount: parseInt(stencilLc.balance_life_cycle, 10) || 0,
        lifeCycleStatus: stencilRackLocation.lifecycle_status || '',
        squeegeeFrontNumber: printingSession.squeegee_front_number || '',
        squeegeeRearNumber: printingSession.squeegee_rear_number || '',
        solderPasteBarcode: printingSession.solder_paste_barcode || '',
        stencilLifecycleId: stencilLc.id
    };
};

export const getEligibleWorkOrdersHelper = async (
    stage: 'Printing' | 'Pre AOI' | 'Post AOI' | 'Rework' | 'SMT FG'
): Promise<any[]> => {
    logger.info(`[Eligibility Debug] Starting eligibility check for stage: ${stage}`);
    
    const query = `
        SELECT 
            wo.id AS work_order_id,
            wo.id AS work_order_number,
            wo.po_id,
            wo.product_name,
            wo.product_description,
            wo.quantity AS work_order_quantity,
            wo.panel_quantity,
            wo.sides,
            wo.line_id,
            wo.remark AS work_order_remarks
        FROM smt_work_orders wo
        WHERE 
            EXISTS (
                SELECT 1 FROM smt_serial_numbers sn
                WHERE sn.work_order_id = wo.id
                  AND (sn.batch_id IS NULL OR EXISTS (
                      SELECT 1 FROM smt_serial_batches sb
                      WHERE sb.id = sn.batch_id AND sb.is_deleted = false
                  ))
            )
        ORDER BY wo.created_at DESC
    `;
    const result = await pool.query(query);
    const candidates = result.rows;
    logger.info(`[Eligibility Debug] Found ${candidates.length} candidate Work Orders with generated serial numbers.`);
    
    const eligibleList: any[] = [];

    for (const wo of candidates) {
        let side = await resolveWorkOrderSide(wo.work_order_id, wo.sides);
        if (stage === 'SMT FG') {
            const woSides = (wo.sides || '').trim().toLowerCase();
            const isDoubleSided = woSides === 'top / bottom' || woSides.includes('/');
            if (isDoubleSided || woSides === 'top') {
                side = 'Top';
            } else {
                side = 'Bottom';
            }
        }
        const lowerSide = side.toLowerCase();
        
        logger.info(`[Eligibility Debug] Processing WO: ${wo.work_order_id} | Sides in DB: ${wo.sides} | Resolved Active Side: ${side}`);

        // For Printing stage, exclude if a session in printing is completed for this side
        if (stage === 'Printing') {
            const sessionRes = await pool.query(
                `SELECT 1 FROM smt_printing_sessions 
                 WHERE work_order_id = $1 
                   AND LOWER(side) = $2 
                   AND status = 'Completed'
                   AND is_deleted = false
                 LIMIT 1`,
                [wo.work_order_id, lowerSide]
            );
            if (sessionRes.rows.length > 0) {
                logger.info(`[Eligibility Debug] WO ${wo.work_order_id} rejected because Printing is already Completed for side ${side}`);
            } else {
                logger.info(`[Eligibility Debug] WO ${wo.work_order_id} is ELIGIBLE for stage ${stage} on side ${side}`);
                eligibleList.push(wo);
            }
        } 
        else if (stage === 'Pre AOI') {
            // Include only if there is at least one PASS barcode in SMT Printing for this resolved side
            const printPassRes = await pool.query(
                `SELECT 1 FROM smt_inspections i
                 JOIN smt_printing_sessions ps ON i.printing_session_id = ps.id
                 WHERE i.work_order_id = $1 
                   AND LOWER(ps.side) = $2
                   AND i.process_step = 'Printing'
                   AND i.status = 'PASS'
                   AND ps.is_deleted = false
                 LIMIT 1`,
                [wo.work_order_id, lowerSide]
            );
            if (printPassRes.rows.length === 0) {
                logger.info(`[Eligibility Debug] WO ${wo.work_order_id} rejected because no PASS barcodes exist in Printing for side ${side}`);
                continue;
            }

            // Exclude if a completed session in Pre AOI exists for this side
            const sessionRes = await pool.query(
                `SELECT 1 FROM smt_pre_aoi_sessions 
                 WHERE work_order_id = $1 
                   AND LOWER(side) = $2 
                   AND status = 'Completed'
                   AND is_deleted = false
                 LIMIT 1`,
                [wo.work_order_id, lowerSide]
            );
            if (sessionRes.rows.length > 0) {
                logger.info(`[Eligibility Debug] WO ${wo.work_order_id} rejected because Pre AOI is already Completed for side ${side}`);
            } else {
                logger.info(`[Eligibility Debug] WO ${wo.work_order_id} is ELIGIBLE for stage ${stage} on side ${side}`);
                eligibleList.push(wo);
            }
        } 
        else if (stage === 'Post AOI') {
            // Include only if there is at least one PASS barcode in Pre AOI for this resolved side
            const preAoiPassRes = await pool.query(
                `SELECT 1 FROM smt_inspections i
                 JOIN smt_pre_aoi_sessions pas ON i.pre_aoi_session_id = pas.id
                 WHERE i.work_order_id = $1 
                   AND LOWER(pas.side) = $2
                   AND i.process_step = 'Pre AOI'
                   AND i.status = 'PASS'
                   AND pas.is_deleted = false
                 LIMIT 1`,
                [wo.work_order_id, lowerSide]
            );
            if (preAoiPassRes.rows.length === 0) {
                logger.info(`[Eligibility Debug] WO ${wo.work_order_id} rejected because no PASS barcodes exist in Pre AOI for side ${side}`);
                continue;
            }

            // Exclude if a completed session in Post AOI exists for this side
            const sessionRes = await pool.query(
                `SELECT 1 FROM smt_post_aoi_sessions 
                 WHERE work_order_id = $1 
                   AND LOWER(side) = $2 
                   AND status = 'Completed'
                   AND is_deleted = false
                 LIMIT 1`,
                [wo.work_order_id, lowerSide]
            );
            if (sessionRes.rows.length > 0) {
                logger.info(`[Eligibility Debug] WO ${wo.work_order_id} rejected because Post AOI is already Completed for side ${side}`);
            } else {
                logger.info(`[Eligibility Debug] WO ${wo.work_order_id} is ELIGIBLE for stage ${stage} on side ${side}`);
                eligibleList.push(wo);
            }
        } 
        else if (stage === 'Rework') {
            // Exclude if there is an active Rework session for this side
            const sessionRes = await pool.query(
                `SELECT 1 FROM smt_rework_sessions 
                 WHERE work_order_id = $1 
                   AND LOWER(side) = $2 
                   AND status IN ('Pending', 'In Progress', 'Paused')
                   AND is_deleted = false
                 LIMIT 1`,
                [wo.work_order_id, lowerSide]
            );
            if (sessionRes.rows.length > 0) {
                logger.info(`[Eligibility Debug] WO ${wo.work_order_id} rejected because an active Rework session already exists for side ${side}`);
                continue;
            }

            // Check if there are failed barcodes from Post AOI that have not been repaired yet
            const failCheck = await pool.query(
                `SELECT i.serial_id, i.scanned_barcode, i.scanned_at FROM smt_inspections i
                 JOIN smt_post_aoi_sessions ps ON i.post_aoi_session_id = ps.id
                 WHERE i.work_order_id = $1
                   AND LOWER(ps.side) = $2
                   AND i.process_step = 'Post AOI'
                   AND i.status = 'FAIL'
                   AND ps.is_deleted = false`,
                [wo.work_order_id, lowerSide]
            );

            let hasEligibleFail = false;
            for (const row of failCheck.rows) {
                const reworkCheck = await pool.query(
                    `SELECT ri.id FROM smt_inspections ri
                     JOIN smt_rework_sessions rs ON ri.rework_session_id = rs.id
                     WHERE ri.work_order_id = $1
                       AND LOWER(rs.side) = $2
                       AND (
                         (ri.serial_id IS NOT NULL AND ri.serial_id = $3)
                         OR (ri.scanned_barcode = $4)
                       )
                       AND ri.process_step = 'Rework'
                       AND ri.status = 'PASS'
                       AND ri.scanned_at > $5
                       AND rs.is_deleted = false
                     LIMIT 1`,
                    [wo.work_order_id, lowerSide, row.serial_id, row.scanned_barcode, row.scanned_at]
                );
                if (reworkCheck.rows.length === 0) {
                    hasEligibleFail = true;
                    break;
                }
            }

            if (!hasEligibleFail) {
                logger.info(`[Eligibility Debug] WO ${wo.work_order_id} rejected because no failed barcodes require rework for side ${side}`);
            } else {
                logger.info(`[Eligibility Debug] WO ${wo.work_order_id} is ELIGIBLE for stage ${stage} on side ${side}`);
                eligibleList.push(wo);
            }
        } 
        else if (stage === 'SMT FG') {
            // Exclude double-sided Bottom side
            const isDoubleSided = wo.sides.trim().toLowerCase() === 'top / bottom' || wo.sides.includes('/');
            if (isDoubleSided && lowerSide === 'bottom') {
                logger.info(`[Eligibility Debug] WO ${wo.work_order_id} rejected because it is double-sided and side resolved to Bottom`);
                continue;
            }

            // Include only if there is at least one PASS barcode in Post AOI for this resolved side
            const postAoiPassRes = await pool.query(
                `SELECT 1 FROM smt_inspections i
                 JOIN smt_post_aoi_sessions pas ON i.post_aoi_session_id = pas.id
                 WHERE i.work_order_id = $1 
                   AND LOWER(pas.side) = $2
                   AND i.process_step = 'Post AOI'
                   AND i.status = 'PASS'
                   AND pas.is_deleted = false
                 LIMIT 1`,
                [wo.work_order_id, lowerSide]
            );
            if (postAoiPassRes.rows.length === 0) {
                logger.info(`[Eligibility Debug] WO ${wo.work_order_id} rejected because no PASS barcodes exist in Post AOI for side ${side}`);
                continue;
            }

            // Exclude if a session in SMT FG exists for this side (active or completed)
            const sessionRes = await pool.query(
                `SELECT 1 FROM smt_fg_sessions 
                 WHERE work_order_id = $1 
                   AND LOWER(side) = $2 
                   AND status IN ('Pending', 'In Progress', 'Paused', 'Completed')
                   AND is_deleted = false
                 LIMIT 1`,
                [wo.work_order_id, lowerSide]
            );
            if (sessionRes.rows.length > 0) {
                logger.info(`[Eligibility Debug] WO ${wo.work_order_id} rejected because a SMT FG session already exists for side ${side}`);
            } else {
                logger.info(`[Eligibility Debug] WO ${wo.work_order_id} is ELIGIBLE for stage ${stage} on side ${side}`);
                eligibleList.push(wo);
            }
        }
    }

    logger.info(`[Eligibility Debug] Returning ${eligibleList.length} eligible Work Orders for stage ${stage}`);
    return eligibleList;
};;

