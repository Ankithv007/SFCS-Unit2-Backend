import { PoolClient } from 'pg';
import { StationId, RouteType, STATION_REGISTRY } from './stationRegistry';
import { createLogger } from '../../utils/logger';

const logger = createLogger('TransitionValidator');

export interface EligibilityResult {
    eligible: boolean;
    reason?: string;
    predecessorRecord?: any;
    stationId: StationId;
    route: RouteType;
}

/**
 * Validates whether a unit (identified by serial and work order) is eligible
 * to enter the specified target station for the given route.
 */
export async function validateStationEligibility(
    client: PoolClient,
    targetStationId: StationId,
    workOrderId: string,
    serialNumber: string
): Promise<EligibilityResult> {
    const station = STATION_REGISTRY[targetStationId];
    if (!station) {
        return {
            eligible: false,
            reason: `Unknown station ID: ${targetStationId}`,
            stationId: targetStationId,
            route: 'ECN'
        };
    }

    const route = station.route === 'COMMON' ? 'ECN' : station.route;
    const cleanWo = workOrderId.trim();
    const cleanSerial = serialNumber.trim().toUpperCase();

    // If station has no predecessor (e.g. INWARD), it's the entry point
    if (!station.requiredPredecessorId) {
        return {
            eligible: true,
            stationId: targetStationId,
            route
        };
    }

    const predStation = STATION_REGISTRY[station.requiredPredecessorId];

    // Station-specific predecessor resolution with strict MES route isolation:
    switch (targetStationId) {
        case 'IVI': {
            // Predecessor is INWARD scan
            const res = await client.query(
                `SELECT s.* FROM rrh_inward_scans s
                 WHERE UPPER(TRIM(s.work_order_id)) = UPPER(TRIM($1))
                   AND UPPER(TRIM(s.serial_number)) = $2
                   AND s.is_deleted = false
                 ORDER BY s.id DESC LIMIT 1`,
                [cleanWo, cleanSerial]
            );
            if (res.rows.length === 0) {
                return {
                    eligible: false,
                    reason: `Unit ${cleanSerial} has not been received at Inward Scan for work order ${cleanWo}.`,
                    stationId: targetStationId,
                    route
                };
            }
            return { eligible: true, predecessorRecord: res.rows[0], stationId: targetStationId, route };
        }

        case 'ECN_IPQC': {
            // Predecessor is IVI with route = 'ECN'
            const res = await client.query(
                `SELECT ivi.* FROM rrh_ivi_inspections ivi
                 WHERE UPPER(TRIM(ivi.work_order_id)) = UPPER(TRIM($1))
                   AND (UPPER(TRIM(ivi.serial_number)) = $2 OR UPPER(TRIM(COALESCE(ivi.band_serial_no, ''))) = $2)
                   AND ivi.is_deleted = false
                   AND UPPER(TRIM(ivi.status)) IN ('PASS', 'COMPLETED')
                   AND COALESCE(ivi.route, 'ECN') = 'ECN'
                 ORDER BY ivi.id DESC LIMIT 1`,
                [cleanWo, cleanSerial]
            );
            if (res.rows.length === 0) {
                return {
                    eligible: false,
                    reason: `Unit ${cleanSerial} does not have a passed IVI inspection under the ECN route. Non-ECN units cannot enter IPQC.`,
                    stationId: targetStationId,
                    route
                };
            }
            return { eligible: true, predecessorRecord: res.rows[0], stationId: targetStationId, route };
        }

        case 'ECN_PROGRAMMING': {
            // Predecessor is ECN IPQC with status PASS/COMPLETED
            const res = await client.query(
                `SELECT ipqc.*, ivi.wo_date, ivi.tejas_dc_no, ivi.tejas_obd_no, ivi.bat_lot_no, ivi.duplexer_main, ivi.duplexer_part_no, ivi.rrh_unit
                 FROM rrh_ipqc_inspections ipqc
                 LEFT JOIN rrh_ivi_inspections ivi ON ivi.id = ipqc.ivi_inspection_id
                 WHERE UPPER(TRIM(ipqc.work_order_id)) = UPPER(TRIM($1))
                   AND (UPPER(TRIM(ipqc.serial_number)) = $2 OR UPPER(TRIM(COALESCE(ipqc.band_serial_no, ''))) = $2)
                   AND ipqc.is_deleted = false
                   AND UPPER(TRIM(ipqc.status)) IN ('PASS', 'COMPLETED')
                   AND COALESCE(ivi.route, 'ECN') = 'ECN'
                 ORDER BY ipqc.id DESC LIMIT 1`,
                [cleanWo, cleanSerial]
            );
            if (res.rows.length === 0) {
                return {
                    eligible: false,
                    reason: `Unit ${cleanSerial} has not passed ECN IPQC inspection for work order ${cleanWo}.`,
                    stationId: targetStationId,
                    route
                };
            }
            return { eligible: true, predecessorRecord: res.rows[0], stationId: targetStationId, route };
        }

        case 'ECN_PRE_BURN_IN': {
            // Predecessor is ECN Programming with status PASS/COMPLETED
            const res = await client.query(
                `SELECT prog.* FROM rrh_programming_inspections prog
                 WHERE UPPER(TRIM(prog.work_order_id)) = UPPER(TRIM($1))
                   AND (UPPER(TRIM(prog.serial_number)) = $2 OR UPPER(TRIM(COALESCE(prog.band_serial_no, ''))) = $2)
                   AND prog.is_deleted = false
                   AND UPPER(TRIM(prog.status)) IN ('PASS', 'COMPLETED')
                   AND COALESCE(prog.route, 'ECN') = 'ECN'
                 ORDER BY prog.id DESC LIMIT 1`,
                [cleanWo, cleanSerial]
            );
            if (res.rows.length === 0) {
                return {
                    eligible: false,
                    reason: `Unit ${cleanSerial} has not passed ECN Programming for work order ${cleanWo}.`,
                    stationId: targetStationId,
                    route
                };
            }
            return { eligible: true, predecessorRecord: res.rows[0], stationId: targetStationId, route };
        }

        case 'ECN_HIPOT': {
            // Predecessor is ECN Pre-Burn-In with status PASS/COMPLETED
            const res = await client.query(
                `SELECT pbi.* FROM rrh_pre_burn_in_inspections pbi
                 WHERE UPPER(TRIM(pbi.work_order_id)) = UPPER(TRIM($1))
                   AND (UPPER(TRIM(pbi.serial_number)) = $2 OR UPPER(TRIM(COALESCE(pbi.band_serial_no, ''))) = $2)
                   AND pbi.is_deleted = false
                   AND UPPER(TRIM(pbi.status)) IN ('PASS', 'COMPLETED')
                   AND COALESCE(pbi.route, 'ECN') = 'ECN'
                 ORDER BY pbi.id DESC LIMIT 1`,
                [cleanWo, cleanSerial]
            );
            if (res.rows.length === 0) {
                return {
                    eligible: false,
                    reason: `Unit ${cleanSerial} has not passed ECN Pre-Burn-In Test for work order ${cleanWo}.`,
                    stationId: targetStationId,
                    route
                };
            }
            return { eligible: true, predecessorRecord: res.rows[0], stationId: targetStationId, route };
        }

        case 'ECN_POST_BURN_IN': {
            // Predecessor is ECN Hipot with status PASS/COMPLETED
            const res = await client.query(
                `SELECT hipot.* FROM rrh_hipot_inspections hipot
                 WHERE UPPER(TRIM(hipot.work_order_id)) = UPPER(TRIM($1))
                   AND (UPPER(TRIM(hipot.serial_number)) = $2 OR UPPER(TRIM(COALESCE(hipot.band_serial_no, ''))) = $2)
                   AND hipot.is_deleted = false
                   AND UPPER(TRIM(hipot.status)) IN ('PASS', 'COMPLETED')
                   AND COALESCE(hipot.route, 'ECN') = 'ECN'
                 ORDER BY hipot.id DESC LIMIT 1`,
                [cleanWo, cleanSerial]
            );
            if (res.rows.length === 0) {
                return {
                    eligible: false,
                    reason: `Unit ${cleanSerial} has not passed ECN Hipot Test for work order ${cleanWo}.`,
                    stationId: targetStationId,
                    route
                };
            }
            return { eligible: true, predecessorRecord: res.rows[0], stationId: targetStationId, route };
        }

        // ─── Non-ECN Stations ─────────────────────────────────────────────────
        case 'NON_ECN_POST_BURN_IN_INITIAL': {
            // Predecessor is IVI with route = 'NON_ECN', bypasses IPQC!
            const res = await client.query(
                `SELECT ivi.*, ivi.id as ivi_id, ivi.id as ipqc_id, ivi.id as hipot_id,
                        ivi.status as ivi_status, ivi.status as hipot_status, ivi.status as ipqc_status,
                        ivi.scanned_by as ivi_inspected_by, ivi.scanned_by as hipot_inspected_by, ivi.scanned_by as ipqc_inspected_by,
                        ivi.remarks as ivi_remarks, ivi.remarks as hipot_remarks, ivi.remarks as ipqc_remarks
                 FROM rrh_ivi_inspections ivi
                 WHERE UPPER(TRIM(ivi.work_order_id)) = UPPER(TRIM($1))
                   AND (UPPER(TRIM(ivi.serial_number)) = $2 OR UPPER(TRIM(COALESCE(ivi.band_serial_no, ''))) = $2)
                   AND ivi.is_deleted = false
                   AND (UPPER(TRIM(ivi.status)) IN ('PASS', 'COMPLETED') OR (UPPER(TRIM(ivi.status)) = 'FAIL' AND ivi.passed_to_next_stage = true))
                   AND REPLACE(COALESCE(ivi.route, 'ECN'), '-', '_') = 'NON_ECN'
                 ORDER BY ivi.id DESC LIMIT 1`,
                [cleanWo, cleanSerial]
            );
            if (res.rows.length === 0) {
                return {
                    eligible: false,
                    reason: `Unit ${cleanSerial} does not have a passed IVI inspection under the Non-ECN route.`,
                    stationId: targetStationId,
                    route
                };
            }
            return { eligible: true, predecessorRecord: res.rows[0], stationId: targetStationId, route };
        }

        case 'NON_ECN_PROGRAMMING': {
            // Predecessor is Non-ECN Initial Post-Burn-In (post_burn_in_type = 'INITIAL', route = 'NON_ECN')
            const res = await client.query(
                `SELECT pbi.*, pbi.id as pbi_id, pbi.id as ipqc_id,
                        COALESCE(pbi.ivi_inspection_id, ivi.id) as ivi_id,
                        COALESCE(pbi.ivi_inspection_id, ivi.id) as ivi_inspection_id,
                        COALESCE(pbi.remarks, ivi.remarks) as ivi_remarks,
                        ivi.wo_date, ivi.tejas_dc_no, ivi.tejas_obd_no, ivi.bat_lot_no, ivi.bat_lot_no as lot, ivi.duplexer_main, ivi.duplexer_part_no, ivi.rrh_unit
                 FROM rrh_post_burn_in_inspections pbi
                 LEFT JOIN rrh_ivi_inspections ivi ON (ivi.id = pbi.ivi_inspection_id OR (UPPER(TRIM(ivi.work_order_id)) = UPPER(TRIM(pbi.work_order_id)) AND UPPER(TRIM(ivi.serial_number)) = UPPER(TRIM(pbi.serial_number)) AND ivi.is_deleted = false))
                 WHERE UPPER(TRIM(pbi.work_order_id)) = UPPER(TRIM($1))
                   AND (UPPER(TRIM(pbi.serial_number)) = $2 OR UPPER(TRIM(COALESCE(pbi.band_serial_no, ''))) = $2)
                   AND pbi.is_deleted = false
                   AND UPPER(TRIM(pbi.status)) IN ('PASS', 'COMPLETED')
                   AND REPLACE(COALESCE(pbi.route, 'ECN'), '-', '_') = 'NON_ECN'
                   AND pbi.post_burn_in_type = 'INITIAL'
                 ORDER BY pbi.id DESC LIMIT 1`,
                [cleanWo, cleanSerial]
            );
            if (res.rows.length === 0) {
                return {
                    eligible: false,
                    reason: `Unit ${cleanSerial} has not passed Non-ECN Initial Post-Burn-In for work order ${cleanWo}. Non-ECN Programming requires passed Initial Post-Burn-In rather than IPQC.`,
                    stationId: targetStationId,
                    route
                };
            }
            return { eligible: true, predecessorRecord: res.rows[0], stationId: targetStationId, route };
        }

        case 'NON_ECN_PRE_BURN_IN': {
            // Predecessor is Non-ECN Programming with status PASS/COMPLETED
            const res = await client.query(
                `SELECT prog.*, prog.id as programming_id, prog.id as ipqc_id,
                        COALESCE(prog.ivi_inspection_id, ivi.id) as ivi_id,
                        COALESCE(prog.ivi_inspection_id, ivi.id) as ivi_inspection_id,
                        COALESCE(prog.remarks, ivi.remarks) as ivi_remarks,
                        ivi.wo_date, ivi.tejas_dc_no, ivi.tejas_obd_no, ivi.bat_lot_no, ivi.bat_lot_no as lot, ivi.duplexer_main, ivi.duplexer_part_no, ivi.rrh_unit
                 FROM rrh_programming_inspections prog
                 LEFT JOIN rrh_ivi_inspections ivi ON (ivi.id = prog.ivi_inspection_id OR (UPPER(TRIM(ivi.work_order_id)) = UPPER(TRIM(prog.work_order_id)) AND UPPER(TRIM(ivi.serial_number)) = UPPER(TRIM(prog.serial_number)) AND ivi.is_deleted = false))
                 WHERE UPPER(TRIM(prog.work_order_id)) = UPPER(TRIM($1))
                   AND (UPPER(TRIM(prog.serial_number)) = $2 OR UPPER(TRIM(COALESCE(prog.band_serial_no, ''))) = $2)
                   AND prog.is_deleted = false
                   AND UPPER(TRIM(prog.status)) IN ('PASS', 'COMPLETED')
                   AND REPLACE(COALESCE(prog.route, 'ECN'), '-', '_') = 'NON_ECN'
                 ORDER BY prog.id DESC LIMIT 1`,
                [cleanWo, cleanSerial]
            );
            if (res.rows.length === 0) {
                return {
                    eligible: false,
                    reason: `Unit ${cleanSerial} has not passed Non-ECN Programming for work order ${cleanWo}.`,
                    stationId: targetStationId,
                    route
                };
            }
            return { eligible: true, predecessorRecord: res.rows[0], stationId: targetStationId, route };
        }

        case 'NON_ECN_HIPOT': {
            // Predecessor is Non-ECN Pre-Burn-In with status PASS/COMPLETED
            const res = await client.query(
                `SELECT pbi.*, pbi.id as pre_burn_in_id, pbi.id as ipqc_id,
                        COALESCE(pbi.ivi_inspection_id, ivi.id) as ivi_id,
                        COALESCE(pbi.ivi_inspection_id, ivi.id) as ivi_inspection_id,
                        COALESCE(pbi.remarks, ivi.remarks) as ivi_remarks,
                        ivi.wo_date, ivi.tejas_dc_no, ivi.tejas_obd_no, ivi.bat_lot_no, ivi.bat_lot_no as lot, ivi.duplexer_main, ivi.duplexer_part_no, ivi.rrh_unit
                 FROM rrh_pre_burn_in_inspections pbi
                 LEFT JOIN rrh_ivi_inspections ivi ON (ivi.id = pbi.ivi_inspection_id OR (UPPER(TRIM(ivi.work_order_id)) = UPPER(TRIM(pbi.work_order_id)) AND UPPER(TRIM(ivi.serial_number)) = UPPER(TRIM(pbi.serial_number)) AND ivi.is_deleted = false))
                 WHERE UPPER(TRIM(pbi.work_order_id)) = UPPER(TRIM($1))
                   AND (UPPER(TRIM(pbi.serial_number)) = $2 OR UPPER(TRIM(COALESCE(pbi.band_serial_no, ''))) = $2)
                   AND pbi.is_deleted = false
                   AND UPPER(TRIM(pbi.status)) IN ('PASS', 'COMPLETED')
                   AND REPLACE(COALESCE(pbi.route, 'ECN'), '-', '_') = 'NON_ECN'
                 ORDER BY pbi.id DESC LIMIT 1`,
                [cleanWo, cleanSerial]
            );
            if (res.rows.length === 0) {
                return {
                    eligible: false,
                    reason: `Unit ${cleanSerial} has not passed Non-ECN Pre-Burn-In Test for work order ${cleanWo}.`,
                    stationId: targetStationId,
                    route
                };
            }
            return { eligible: true, predecessorRecord: res.rows[0], stationId: targetStationId, route };
        }

        case 'NON_ECN_POST_BURN_IN_FINAL': {
            // Predecessor is Non-ECN Hipot with status PASS/COMPLETED
            const res = await client.query(
                `SELECT hipot.*, hipot.id as hipot_id, hipot.id as ipqc_id,
                        COALESCE(hipot.ivi_inspection_id, ivi.id) as ivi_id,
                        COALESCE(hipot.ivi_inspection_id, ivi.id) as ivi_inspection_id,
                        COALESCE(hipot.remarks, ivi.remarks) as ivi_remarks,
                        ivi.wo_date, ivi.tejas_dc_no, ivi.tejas_obd_no, ivi.bat_lot_no, ivi.bat_lot_no as lot, ivi.duplexer_main, ivi.duplexer_part_no, ivi.rrh_unit
                 FROM rrh_hipot_inspections hipot
                 LEFT JOIN rrh_ivi_inspections ivi ON (ivi.id = hipot.ivi_inspection_id OR (UPPER(TRIM(ivi.work_order_id)) = UPPER(TRIM(hipot.work_order_id)) AND UPPER(TRIM(ivi.serial_number)) = UPPER(TRIM(hipot.serial_number)) AND ivi.is_deleted = false))
                 WHERE UPPER(TRIM(hipot.work_order_id)) = UPPER(TRIM($1))
                   AND (UPPER(TRIM(hipot.serial_number)) = $2 OR UPPER(TRIM(COALESCE(hipot.band_serial_no, ''))) = $2)
                   AND hipot.is_deleted = false
                   AND UPPER(TRIM(hipot.status)) IN ('PASS', 'COMPLETED')
                   AND REPLACE(COALESCE(hipot.route, 'ECN'), '-', '_') = 'NON_ECN'
                 ORDER BY hipot.id DESC LIMIT 1`,
                [cleanWo, cleanSerial]
            );
            if (res.rows.length === 0) {
                return {
                    eligible: false,
                    reason: `Unit ${cleanSerial} has not passed Non-ECN Hipot Test for work order ${cleanWo}.`,
                    stationId: targetStationId,
                    route
                };
            }
            return { eligible: true, predecessorRecord: res.rows[0], stationId: targetStationId, route };
        }

        default:
            return {
                eligible: false,
                reason: `Unhandled station validation for ${targetStationId}`,
                stationId: targetStationId,
                route
            };
    }
}
