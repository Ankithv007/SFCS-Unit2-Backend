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
    let { client, batch_id, barcode, scanned_by, status, remarks, resolution_remarks, failed_at, failed_remarks, stage_id, prev_stage_id, batch_table, scans_table, work_order_id } = ctx;

    // 0. Recover work_order_id if missing (robustness)
    if (!work_order_id) {
        if (batch_id) {

            const woRes = await client.query(`SELECT work_order_id FROM ${batch_table} WHERE id = $1`, [batch_id]);
            if ((woRes.rowCount || 0) > 0) {
                work_order_id = woRes.rows[0].work_order_id;
            }
        }
        
        if (!work_order_id && barcode) {

            const trackRes = await client.query(`SELECT mb.work_order_id FROM barcode_tracking bt JOIN master_batches mb ON bt.batch_id = mb.id WHERE bt.barcode = $1`, [barcode]);
            if ((trackRes.rowCount || 0) > 0) {
                work_order_id = trackRes.rows[0].work_order_id;
            }
        }
    }

    if (!work_order_id) {
        throw new Error(`Critical Error: work_order_id is undefined for barcode ${barcode}. Cannot proceed with stage transition.`);
    }

    // Fetch master_batch_id for tracking consistency
    const masterBatchResult = await client.query('SELECT id FROM master_batches WHERE work_order_id = $1 LIMIT 1', [work_order_id]);
    if (masterBatchResult.rowCount === 0) {
        throw new Error(`Master batch not found for Work Order ID: ${work_order_id}. Please ensure Work Order is initialized.`);
    }
    const master_batch_id = masterBatchResult.rows[0].id;

    // 1. Concurrency Protection: Lock barcode row
    let lockResult = await client.query(
        "SELECT * FROM barcode_tracking WHERE barcode = $1 FOR UPDATE",
        [barcode]
    );

    if (lockResult.rowCount === 0) {
        if (stage_id === 1) {
            // Create initial tracking for first stage (PTH)
            // Use NULL for current_stage_id as 0 violates FK constraint
            await client.query(
                `INSERT INTO barcode_tracking (barcode, batch_id, current_stage_id, current_status, last_updated_at, last_updated_by)
                 VALUES ($1, $2, NULL, 'ACCEPTED', CURRENT_TIMESTAMP, $3)
                 ON CONFLICT (barcode) DO NOTHING`,
                [barcode, master_batch_id, scanned_by]
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
    const currentStatus = (tracking.current_status || '').toUpperCase();
    const currentStageId = tracking.current_stage_id === null ? 0 : parseInt(tracking.current_stage_id);

    // Debug logging as requested


    // 2. Sequential Stage Check (board-level, NOT batch-level)
    // A board can enter the next stage as soon as its PREVIOUS stage status is ACCEPTED.
    if (prev_stage_id !== null) {
        // Special case: Board returned from Rework/Debug (READY_FOR_RESCAN)
        // It can be scanned if it is currently at THIS stage (stage_id) with READY_FOR_RESCAN status
        const isRepairReturn = currentStageId === stage_id && currentStatus === 'READY_FOR_RESCAN';
        const isPrevStagePassed = currentStageId >= prev_stage_id && currentStatus === 'ACCEPTED';
        
        if (!isPrevStagePassed && !isRepairReturn) {
            throw new Error(
                `Previous stage not completed for this barcode. Current stage: ${currentStageId}, Status: ${currentStatus}. ` +
                `Board must pass stage ${prev_stage_id} before it can be scanned here.`
            );
        }
    } else {
        // PTH (stage 1): barcode must be new OR returned from Rework/Debug
        // Allow if current_stage_id is 0 (new) OR current_stage_id is 1 with READY_FOR_RESCAN
        const isNew = currentStageId === 0;
        const isRepairReturn = currentStageId === stage_id && currentStatus === 'READY_FOR_RESCAN';
        
        if (!isNew && !isRepairReturn && currentStageId >= stage_id && currentStatus === 'ACCEPTED') {
            throw new Error("Barcode has already passed this stage and is in a later stage.");
        }
    }

    // 3. Batch Validity Check
    const batchResult = await client.query(`
        SELECT 
            b.status, 
            b.work_order_id,
            w.quantity as wo_qty
        FROM ${batch_table} b
        JOIN work_orders w ON b.work_order_id = w.id
        WHERE b.id = $1 AND b.is_deleted = FALSE
    `, [batch_id]);
    
    if (batchResult.rowCount === 0) throw new Error("Batch not found or already deleted");
    
    // REMOVED: Premature completion block.
    // We allow scanning even if status is 'completed' to support repair loops and re-scans.
    // The status will be automatically moved back to 'in_progress' if the completion criteria is no longer met.
    
    const wo_qty = parseInt(batchResult.rows[0].wo_qty || '0');

    // 4. Duplicate & Re-scan Check
    // IMPORTANT: If barcode is READY_FOR_RESCAN (returned from repair), bypass all duplicate checks
    // and allow a fresh scan at the original failed stage.
    const isRepairRescan = currentStatus === 'READY_FOR_RESCAN';

    if (!isRepairRescan) {
        const existingScan = await client.query(
            `SELECT status, resolution_remarks FROM ${scans_table} 
             WHERE barcode = $1 AND batch_id = $2 
             ORDER BY scanned_at DESC LIMIT 1`,
            [barcode, batch_id]
        );

        if (existingScan.rows.length > 0) {
            const lastStatus = (existingScan.rows[0].status || '').toUpperCase();
            const lastResolution = existingScan.rows[0].resolution_remarks || '';

            if (lastStatus === 'ACCEPTED') {
                throw new Error("Barcode already processed and passed in this stage.");
            }
            // REWORK or DEBUG: only allow re-scan if it has been resolved (Fixed or Closed)
            if (lastStatus === 'REWORK' || lastStatus === 'DEBUG') {
                if (lastResolution !== 'Fixed' && lastResolution !== 'Closed') {
                    throw new Error(
                        `This barcode is pending ${lastStatus} resolution. ` +
                        `Complete repair in the ${lastStatus === 'REWORK' ? 'Rework' : 'Debug'} page first.`
                    );
                }
                // Resolution confirmed — allow re-scan (fall through)
            }
        } else {
            // New barcode for this stage — check total WO quantity limit across all batches
            const distinctScannedResult = await client.query(
                `SELECT COUNT(DISTINCT s.barcode) as count 
                 FROM ${scans_table} s
                 JOIN ${batch_table} b ON s.batch_id = b.id
                 WHERE b.work_order_id = $1 AND b.is_deleted = FALSE`,
                [work_order_id]
            );
            const uniqueScanned = parseInt(distinctScannedResult.rows[0].count);
            if (uniqueScanned >= wo_qty) {
                throw new Error(`Work Order Quantity limit reached (${wo_qty}). Additional scans are not allowed for this Work Order.`);
            }
        }
    }

    // 5. Insert Scan Record (Full Traceability)
    const finalStatus = (status || 'ACCEPTED').toUpperCase();

    // Sanity guard: never insert error messages or non-barcode strings into scan history
    if (!barcode || barcode.length > 100 || 
        /stage transition|administrator|error|failed|invalid|null|undefined|\[object/i.test(barcode) ||
        barcode.trim() === "") {
        throw new Error(`Invalid barcode value: "${barcode}". Please scan a valid serial number.`);
    }

    const historyResult = await client.query(
        `INSERT INTO ${scans_table} (batch_id, barcode, scanned_by, status, remarks) 
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [batch_id, barcode, scanned_by, finalStatus, remarks]
    );

    // 6. Update Barcode Tracking
    // If ACCEPTED: advance stage to current stage (board can now enter next stage)
    // If REWORK: set current_stage_id to Rework stage (looked up by name)
    // If DEBUG: set current_stage_id to Debug stage (looked up by name)
    let nextStageId: number | null = stage_id;
    let failedStageId = tracking.failed_stage_id;

    if (finalStatus === 'REWORK') {
        // Look up Rework stage ID dynamically — never hardcode, as it varies per DB
        const reworkStageRes = await client.query(
            `SELECT id FROM production_stages WHERE LOWER(stage_name) = 'rework' LIMIT 1`
        );
        if (reworkStageRes.rowCount === 0) {
            throw new Error(`'Rework' stage is not configured in production_stages. Please contact administrator.`);
        }
        nextStageId = reworkStageRes.rows[0].id;
        failedStageId = stage_id;
    } else if (finalStatus === 'DEBUG') {
        // Look up Debug stage ID dynamically — never hardcode, as it varies per DB
        const debugStageRes = await client.query(
            `SELECT id FROM production_stages WHERE LOWER(stage_name) = 'debug' LIMIT 1`
        );
        if (debugStageRes.rowCount === 0) {
            throw new Error(`'Debug' stage is not configured in production_stages. Please contact administrator.`);
        }
        nextStageId = debugStageRes.rows[0].id;
        failedStageId = stage_id;
    } else if (finalStatus === 'ACCEPTED') {
        // Clear failed_stage_id if it passes a regular stage
        failedStageId = null;
    }
    const isRevalidatedPass = currentStatus === 'READY_FOR_RESCAN' && finalStatus === 'ACCEPTED';
    const isNewFailure = finalStatus === 'REWORK' || finalStatus === 'DEBUG';

    await client.query(
        `UPDATE barcode_tracking 
         SET current_stage_id = $1, 
             current_status = $2, 
             failed_stage_id = $3,
             batch_id = $6,
             last_updated_at = CURRENT_TIMESTAMP, 
             last_updated_by = $4,
             revalidated_passed_at = CASE WHEN $7 = TRUE THEN CURRENT_TIMESTAMP ELSE revalidated_passed_at END,
             failure_created_at = CASE WHEN $8 = TRUE THEN CURRENT_TIMESTAMP ELSE failure_created_at END
         WHERE barcode = $5`,
        [nextStageId, finalStatus, failedStageId, scanned_by, barcode, master_batch_id, isRevalidatedPass, isNewFailure]
    );

    // 7. Auto Batch Completion Check (Work Order level)
    // A batch is "completed" only when the ENTIRE Work Order quantity is passed
    // and there are no barcodes remaining in REWORK or DEBUG for this stage.
    const statsResult = await client.query(
        `WITH latest_scans AS (
            SELECT DISTINCT ON (s.barcode) s.barcode, s.status
            FROM ${scans_table} s
            JOIN ${batch_table} b ON s.batch_id = b.id
            WHERE b.work_order_id = $1 AND b.is_deleted = FALSE
            ORDER BY s.barcode, s.scanned_at DESC
        )
        SELECT 
            COUNT(*)::int as total_distinct,
            COUNT(*) FILTER (WHERE status = 'ACCEPTED')::int as passed_qty,
            COUNT(*) FILTER (WHERE status = 'REWORK')::int as rework_qty,
            COUNT(*) FILTER (WHERE status = 'DEBUG')::int as debug_qty
        FROM latest_scans`,
        [work_order_id]
    );

    const { total_distinct, passed_qty, rework_qty, debug_qty } = statsResult.rows[0];

    // Batch is "completed" only when ALL boards in the Work Order have passed 
    // AND there are no boards currently in repair (REWORK/DEBUG)
    const isWOFinished = wo_qty > 0 && passed_qty >= wo_qty && rework_qty === 0 && debug_qty === 0;

    if (isWOFinished) {
        // Mark ALL batches for this Work Order as completed in this stage
        await client.query(
            `UPDATE ${batch_table} SET status = 'completed', completed_at = CURRENT_TIMESTAMP 
             WHERE work_order_id = $1 AND is_deleted = FALSE AND status <> 'completed'`,
            [work_order_id]
        );
    } else {
        // Ensure ALL batches for this Work Order are in_progress if not yet finished
        await client.query(
            `UPDATE ${batch_table} SET status = 'in_progress' 
             WHERE work_order_id = $1 AND is_deleted = FALSE AND status = 'completed'`,
            [work_order_id]
        );
    }

    return historyResult.rows[0];
};
