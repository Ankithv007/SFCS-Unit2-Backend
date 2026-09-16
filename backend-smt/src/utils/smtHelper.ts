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
 * Validates compatibility between Work Order side and Stencil side.
 * Compatibility Matrix:
 * - TOP WO: TOP stencil only
 * - BOTTOM WO: BOTTOM stencil only
 * - TOP/BOTTOM WO (or sides containing '/'): TOP, BOTTOM, or TOP/BOTTOM stencil
 */
export const isStencilSideCompatible = (woSideRaw: string | null | undefined, stencilSideRaw: string | null | undefined): boolean => {
    if (!woSideRaw || !stencilSideRaw) return false;

    const normWOSide = woSideRaw.trim().toUpperCase().replace(/\s*\/\s*/g, '/');
    const normStencilSide = stencilSideRaw.trim().toUpperCase().replace(/\s*\/\s*/g, '/');

    if (normWOSide === 'TOP') {
        return normStencilSide === 'TOP';
    }
    if (normWOSide === 'BOTTOM') {
        return normStencilSide === 'BOTTOM';
    }
    if (normWOSide === 'TOP/BOTTOM' || normWOSide.includes('/')) {
        return normStencilSide === 'TOP' || normStencilSide === 'BOTTOM' || normStencilSide === 'TOP/BOTTOM';
    }

    return normWOSide === normStencilSide;
};

/**
 * Calculates the required stencil lifecycle prints based on Work Order side, Stencil side, and Panel Quantity.
 * 
 * Rules:
 * - IF Work Order Side = TOP -> Required Prints = Panel Quantity
 * - IF Work Order Side = BOTTOM -> Required Prints = Panel Quantity
 * - IF Work Order Side = TOP/BOTTOM AND Stencil Side = TOP -> Required Prints = Panel Quantity
 * - IF Work Order Side = TOP/BOTTOM AND Stencil Side = BOTTOM -> Required Prints = Panel Quantity
 * - IF Work Order Side = TOP/BOTTOM AND Stencil Side = TOP/BOTTOM -> Required Prints = Panel Quantity × 2
 */
export const calculateRequiredLifecyclePrints = (
    woSideRaw: string | null | undefined,
    stencilSideRaw: string | null | undefined,
    panelQuantity: number
): number => {
    const pQty = Math.max(0, Number(panelQuantity) || 0);
    if (!woSideRaw || !stencilSideRaw) return pQty;

    const normWOSide = woSideRaw.trim().toUpperCase().replace(/\s*\/\s*/g, '/');
    const normStencilSide = stencilSideRaw.trim().toUpperCase().replace(/\s*\/\s*/g, '/');

    if (normWOSide === 'TOP/BOTTOM' || normWOSide.includes('/')) {
        if (normStencilSide === 'TOP/BOTTOM' || normStencilSide.includes('/')) {
            return pQty * 2;
        }
        return pQty;
    }

    return pQty;
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
 * Resolves the side for Rework.
 * Checks if there are any unrepaired Post AOI failures on Bottom or Top.
 * Optimized: uses a single NOT EXISTS SQL query per side instead of an O(n) application-level loop.
 */
export const resolveReworkSide = async (woId: string, sides: string): Promise<'Top' | 'Bottom'> => {
    const woSides = (sides || '').trim().toLowerCase();
    if (woSides === 'top') return 'Top';
    if (woSides === 'bottom') return 'Bottom';
    if (woSides === 'top / bottom' || woSides.includes('/')) {
        // Single query replaces the previous O(n) application-level loop.
        // Checks: does any Post AOI FAIL on the given side lack a subsequent Rework PASS?
        const unrepairedQuery = `
            SELECT EXISTS (
                SELECT 1
                FROM smt_inspections i
                JOIN smt_post_aoi_sessions ps ON i.post_aoi_session_id = ps.id
                WHERE i.work_order_id = $1
                  AND LOWER(ps.side) = $2
                  AND i.process_step = 'Post AOI'
                  AND i.status = 'FAIL'
                  AND ps.is_deleted = false
                  AND NOT EXISTS (
                      SELECT 1
                      FROM smt_inspections ri
                      JOIN smt_rework_sessions rs ON ri.rework_session_id = rs.id
                      WHERE ri.work_order_id = $1
                        AND LOWER(rs.side) = $2
                        AND (
                            (ri.serial_id IS NOT NULL AND ri.serial_id = i.serial_id)
                            OR (ri.scanned_barcode = i.scanned_barcode)
                        )
                        AND ri.process_step = 'Rework'
                        AND ri.status = 'PASS'
                        AND ri.scanned_at > i.scanned_at
                        AND rs.is_deleted = false
                  )
            ) AS has_unrepaired
        `;

        // Check Bottom side first (same priority order as the original implementation)
        const bottomRes = await pool.query(unrepairedQuery, [woId, 'bottom']);
        if (bottomRes.rows[0]?.has_unrepaired === true) {
            return 'Bottom';
        }

        // Check Top side
        const topRes = await pool.query(unrepairedQuery, [woId, 'top']);
        if (topRes.rows[0]?.has_unrepaired === true) {
            return 'Top';
        }
    }
    return await resolveWorkOrderSide(woId, sides);
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
        } else if (sessionTable === 'smt_rework_sessions') {
            side = await resolveReworkSide(woId, wo.sides);
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
    stage: 'Printing' | 'SPI' | 'Pre AOI' | 'Post AOI' | 'Rework' | 'SMT FG'
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
        let side: 'Top' | 'Bottom';
        if (stage === 'Rework') {
            side = await resolveReworkSide(wo.work_order_id, wo.sides);
        } else if (stage === 'SMT FG') {
            const woSides = (wo.sides || '').trim().toLowerCase();
            const isDoubleSided = woSides === 'top / bottom' || woSides.includes('/');
            if (isDoubleSided || woSides === 'top') {
                side = 'Top';
            } else {
                side = 'Bottom';
            }
        } else {
            side = await resolveWorkOrderSide(wo.work_order_id, wo.sides);
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
        else if (stage === 'SPI') {
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

            // Exclude if a completed session in SPI exists for this side
            const sessionRes = await pool.query(
                `SELECT 1 FROM smt_spi_sessions 
                 WHERE work_order_id = $1 
                   AND LOWER(side) = $2 
                   AND status = 'Completed'
                   AND is_deleted = false
                 LIMIT 1`,
                [wo.work_order_id, lowerSide]
            );
            if (sessionRes.rows.length > 0) {
                logger.info(`[Eligibility Debug] WO ${wo.work_order_id} rejected because SPI is already Completed for side ${side}`);
            } else {
                logger.info(`[Eligibility Debug] WO ${wo.work_order_id} is ELIGIBLE for stage ${stage} on side ${side}`);
                eligibleList.push(wo);
            }
        }
        else if (stage === 'Pre AOI') {
            // Include only if there is at least one PASS barcode in SPI for this resolved side
            const spiPassRes = await pool.query(
                `SELECT 1 FROM smt_inspections i
                 JOIN smt_spi_sessions spis ON i.spi_session_id = spis.id
                 WHERE i.work_order_id = $1 
                   AND LOWER(spis.side) = $2
                   AND i.process_step = 'SPI'
                   AND i.status = 'PASS'
                   AND spis.is_deleted = false
                 LIMIT 1`,
                [wo.work_order_id, lowerSide]
            );
            if (spiPassRes.rows.length === 0) {
                logger.info(`[Eligibility Debug] WO ${wo.work_order_id} rejected because no PASS barcodes exist in SPI for side ${side}`);
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

            // Check if there are failed barcodes from Post AOI that have not been repaired yet.
            // Uses NOT EXISTS instead of an O(n) application-level loop — same logic as resolveReworkSide.
            const unrepairedFailCheck = await pool.query(
                `SELECT EXISTS (
                    SELECT 1
                    FROM smt_inspections i
                    JOIN smt_post_aoi_sessions ps ON i.post_aoi_session_id = ps.id
                    WHERE i.work_order_id = $1
                      AND LOWER(ps.side) = $2
                      AND i.process_step = 'Post AOI'
                      AND i.status = 'FAIL'
                      AND ps.is_deleted = false
                      AND NOT EXISTS (
                          SELECT 1
                          FROM smt_inspections ri
                          JOIN smt_rework_sessions rs ON ri.rework_session_id = rs.id
                          WHERE ri.work_order_id = $1
                            AND LOWER(rs.side) = $2
                            AND (
                                (ri.serial_id IS NOT NULL AND ri.serial_id = i.serial_id)
                                OR (ri.scanned_barcode = i.scanned_barcode)
                            )
                            AND ri.process_step = 'Rework'
                            AND ri.status = 'PASS'
                            AND ri.scanned_at > i.scanned_at
                            AND rs.is_deleted = false
                      )
                ) AS has_unrepaired`,
                [wo.work_order_id, lowerSide]
            );

            const hasEligibleFail = unrepairedFailCheck.rows[0]?.has_unrepaired === true;
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
};

/**
 * Ensures that a valid smt_stencil_lifecycle ID exists for a given input ID, Work Order, and side.
 * If inputId is already a valid UUID in smt_stencil_lifecycle, returns inputId.
 * If inputId is a stencil_rack_locations ID (or missing in smt_stencil_lifecycle), auto-creates or finds the smt_stencil_lifecycle record.
 */
export const ensureStencilLifecycleId = async (
    client: any,
    inputId: string,
    workOrderId: string,
    side: string,
    operatorName = 'System'
): Promise<string> => {
    if (!inputId || !workOrderId) {
        throw new Error('Input stencil lifecycle ID and Work Order ID are required.');
    }

    // 1. Direct check in smt_stencil_lifecycle
    const directCheck = await client.query(
        `SELECT id FROM smt_stencil_lifecycle WHERE id = $1 AND is_deleted = false`,
        [inputId]
    );
    if (directCheck.rows.length > 0) {
        return directCheck.rows[0].id;
    }

    // 2. Check if a lifecycle record exists by stencil_record_id or work_order_id & side
    const secondaryCheck = await client.query(
        `SELECT id FROM smt_stencil_lifecycle 
         WHERE (stencil_record_id = $1 OR (work_order_id = $2 AND LOWER(sides) = LOWER($3)))
           AND is_deleted = false
         ORDER BY created_at DESC 
         LIMIT 1`,
        [inputId, workOrderId, side]
    );
    if (secondaryCheck.rows.length > 0) {
        return secondaryCheck.rows[0].id;
    }

    // 3. Fallback: Find stencil from stencil_rack_locations and work order from smt_work_orders
    const stencilRes = await client.query(
        `SELECT * FROM stencil_rack_locations WHERE id = $1 OR checked_out_work_order_id = $2 ORDER BY updated_at DESC LIMIT 1`,
        [inputId, workOrderId]
    );
    const woRes = await client.query(
        `SELECT * FROM smt_work_orders WHERE id = $1`,
        [workOrderId]
    );

    if (stencilRes.rows.length === 0 || woRes.rows.length === 0) {
        throw new Error(`Cannot resolve stencil lifecycle for ID ${inputId} and Work Order ${workOrderId}.`);
    }

    const stencil = stencilRes.rows[0];
    const wo = woRes.rows[0];

    const stencilName = stencil.stencil_name || stencil.job_number || 'Stencil';
    const stencilIdCode = stencil.stencil_rack_number || stencil.job_number || stencilName;
    const qty = wo.quantity || 0;

    const insertRes = await client.query(
        `INSERT INTO smt_stencil_lifecycle (
            stencil_record_id, stencil_id, stencil_name,
            work_order_id, work_order_number, product_name, product_description,
            sides, quantity, target_life_cycle, qty_life_cycle, balance_life_cycle,
            current_used_life_cycle, status, created_by, created_by_name
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        RETURNING id`,
        [
            stencil.id,
            stencilIdCode,
            stencilName,
            wo.id,
            wo.id,
            wo.product_name || 'N/A',
            wo.product_description || wo.product_name || 'N/A',
            side || 'Top',
            qty,
            100000,
            qty,
            100000,
            0,
            'Running',
            operatorName,
            operatorName
        ]
    );

    return insertRes.rows[0].id;
};

