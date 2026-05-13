import { PoolClient } from 'pg';

export interface ScanContext {
    client: PoolClient;
    batch_id: number;
    barcode: string;
    scanned_by: string;
    status: string;
    remarks?: string;
    resolution_remarks?: string;
    failed_at?: Date;
    failed_remarks?: string;
    stage_id: number;
    prev_stage_id: number | null;
    batch_table: string;
    scans_table: string;
    work_order_id: number;
}

export const processMESScan = async (ctx: ScanContext) => {
    const { client, batch_id, barcode, scanned_by, status, remarks, resolution_remarks, failed_at, failed_remarks, stage_id, prev_stage_id, batch_table, scans_table, work_order_id } = ctx;

    // 1. Concurrency Protection: Lock barcode row
    let lockResult = await client.query(
        "SELECT * FROM barcode_tracking WHERE barcode = $1 FOR UPDATE",
        [barcode]
    );

    if (lockResult.rowCount === 0) {
        if (stage_id === 1) {
            // Create initial tracking for first stage
            await client.query(
                `INSERT INTO barcode_tracking (barcode, current_stage_id, current_status, last_updated_by)
                 VALUES ($1, 0, 'active', $2)`,
                [barcode, scanned_by]
            );
            lockResult = await client.query(
                "SELECT * FROM barcode_tracking WHERE barcode = $1 FOR UPDATE",
                [barcode]
            );
        } else {
            throw new Error("Barcode not found in system tracking. Ensure it has passed previous stages.");
        }
    }

    const tracking = lockResult.rows[0];

    // 2. Sequential Stage Check
    if (prev_stage_id !== null) {
        if (tracking.current_stage_id < prev_stage_id || !['accepted', 'passed'].includes(tracking.current_status.toLowerCase())) {
            throw new Error(`Previous stage not completed for this barcode. Current stage: ${tracking.current_stage_id}, Status: ${tracking.current_status}`);
        }
    }

    // 3. Batch Check
    const batchResult = await client.query(`SELECT status, work_order_id FROM ${batch_table} WHERE id = $1 AND is_deleted = FALSE`, [batch_id]);
    if (batchResult.rowCount === 0) throw new Error("Batch not found or already deleted");
    if (batchResult.rows[0].status === 'completed') throw new Error("Batch already completed");

    // 4. Duplicate Check
    const existingScan = await client.query(
        `SELECT status FROM ${scans_table} WHERE barcode = $1 AND batch_id = $2 ORDER BY scanned_at DESC LIMIT 1`,
        [barcode, batch_id]
    );

    if (existingScan.rows.length > 0) {
        const lastStatus = existingScan.rows[0].status.toLowerCase();
        if (lastStatus === 'accepted' || lastStatus === 'passed') {
            throw new Error("Barcode already processed and passed in this stage");
        }
    }

    // 5. Insert History (Traceability)
    const finalStatus = status || 'accepted';
    const final_failed_at = failed_at || ((finalStatus.toLowerCase() === 'rework' || finalStatus.toLowerCase() === 'debug') ? new Date() : null);
    const final_failed_remarks = failed_remarks || ((finalStatus.toLowerCase() === 'rework' || finalStatus.toLowerCase() === 'debug') ? remarks : null);

    // Note: Some tables have work_order_id, some don't. We should handle that or standardize.
    // For now, assume batch_id is enough for history.
    const historyResult = await client.query(
        `INSERT INTO ${scans_table} (batch_id, barcode, scanned_by, status, remarks, resolution_remarks, failed_at, failed_remarks) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [batch_id, barcode, scanned_by, finalStatus, remarks, resolution_remarks, final_failed_at, final_failed_remarks]
    );

    // 6. Update Tracking
    await client.query(
        `UPDATE barcode_tracking 
         SET current_stage_id = $1, current_status = $2, last_updated_at = CURRENT_TIMESTAMP, last_updated_by = $3 
         WHERE barcode = $4`,
        [stage_id, finalStatus, scanned_by, barcode]
    );

    // 7. Auto Completion Check (Latest status per barcode)
    const statsResult = await client.query(
        `WITH latest_scans AS (
            SELECT DISTINCT ON (barcode) barcode, status
            FROM ${scans_table}
            WHERE batch_id = $1
            ORDER BY barcode, scanned_at DESC
        )
        SELECT 
            COUNT(*) FILTER (WHERE status IN ('accepted', 'passed', 'ACCEPTED', 'PASSED')) as passed_qty,
            COUNT(*) FILTER (WHERE status IN ('rework', 'REWORK')) as rework_qty,
            COUNT(*) FILTER (WHERE status IN ('debug', 'DEBUG')) as debug_qty
        FROM latest_scans`,
        [batch_id]
    );

    const { passed_qty, rework_qty, debug_qty } = statsResult.rows[0];
    
    const woResult = await client.query("SELECT quantity FROM work_orders WHERE id = $1", [work_order_id]);
    const total_qty = parseInt(woResult.rows[0]?.quantity || '0');

    if (total_qty > 0 && parseInt(passed_qty) === total_qty && parseInt(rework_qty) === 0 && parseInt(debug_qty) === 0) {
        await client.query(
            `UPDATE ${batch_table} SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [batch_id]
        );
    }

    return historyResult.rows[0];
};
