import pool, { smtPool } from '../config/db';

let inFlightSync: Promise<void> | null = null;
let lastKnownSmtFingerprint = '';

/**
 * One-time schema check executed ONLY during server startup (index.ts).
 * Never called on incoming request paths to prevent AccessExclusiveLock contention.
 */
export async function ensureSchemaColumns(): Promise<void> {
    try {
        await pool.query(`
            ALTER TABLE work_orders 
            ADD COLUMN IF NOT EXISTS po_id VARCHAR(255),
            ADD COLUMN IF NOT EXISTS product_name VARCHAR(255),
            ADD COLUMN IF NOT EXISTS product_description TEXT,
            ADD COLUMN IF NOT EXISTS sides VARCHAR(50),
            ADD COLUMN IF NOT EXISTS line_id VARCHAR(50),
            ADD COLUMN IF NOT EXISTS priority VARCHAR(50),
            ADD COLUMN IF NOT EXISTS solder_paste_status VARCHAR(50),
            ADD COLUMN IF NOT EXISTS selected_stages JSONB,
            ADD COLUMN IF NOT EXISTS remark TEXT,
            ADD COLUMN IF NOT EXISTS has_smt BOOLEAN DEFAULT TRUE,
            ADD COLUMN IF NOT EXISTS has_backend BOOLEAN DEFAULT TRUE,
            ADD COLUMN IF NOT EXISTS updated_by VARCHAR(100),
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;

            CREATE INDEX IF NOT EXISTS idx_work_orders_created_at_id ON work_orders (created_at DESC, id DESC);
        `);
    } catch (err: any) {
        console.error('Error ensuring schema columns in work_orders:', err.message);
    }
}

/**
 * Explicitly invalidate sync cache so newly created or edited Work Orders
 * trigger synchronization immediately.
 */
export function invalidateSyncCache(): void {
    lastKnownSmtFingerprint = '';
}

function formatSelectedStagesJson(stages: any): string | null {
    if (!stages) return null;
    if (typeof stages === 'string') {
        try {
            JSON.parse(stages);
            return stages;
        } catch {
            return JSON.stringify([stages]);
        }
    }
    return JSON.stringify(stages);
}

/**
 * High-performance set-based synchronization of Work Orders from SMT DB to Backend DB.
 * Features:
 * - Shared in-flight promise to prevent concurrent duplicate sync runs.
 * - Sub-millisecond fingerprint check: only synchronizes if smt_work_orders has changed.
 * - Set-based bulk batch & progress record population (2 queries instead of 250+).
 */
export async function syncSmtWorkOrders(options?: { force?: boolean }): Promise<void> {
    if (inFlightSync) {
        return inFlightSync;
    }

    inFlightSync = (async () => {
        try {
            // Fast fingerprint check: has smt_work_orders count, timestamps, or stage configuration changed?
            if (!options?.force) {
                const checkRes = await smtPool.query(`
                    SELECT count(*) as count, 
                           max(created_at)::text as max_created,
                           md5(COALESCE(string_agg(id || COALESCE(selected_stages::text, ''), ',' ORDER BY id), '')) as stages_hash
                    FROM smt_work_orders 
                    WHERE status NOT IN ('Deleted', 'Cancelled')
                `);
                const currentFingerprint = `${checkRes.rows[0]?.count || 0}_${checkRes.rows[0]?.max_created || ''}_${checkRes.rows[0]?.stages_hash || ''}`;
                if (currentFingerprint === lastKnownSmtFingerprint && lastKnownSmtFingerprint !== '') {
                    return; // No changes in SMT work orders; return immediately in ~0.5ms!
                }
            }

            const smtRes = await smtPool.query(`
                SELECT id, po_id, product_name, product_description, sides, quantity, 
                       customer_name, model_name, selected_stages, line_id, priority, 
                       solder_paste_status, created_by, created_at, remark,
                       has_smt, has_backend
                FROM smt_work_orders 
                WHERE status NOT IN ('Deleted', 'Cancelled')
            `);

            if (!smtRes.rows || smtRes.rows.length === 0) {
                lastKnownSmtFingerprint = '0_';
                return;
            }

            const stagesRes = await pool.query(`SELECT id FROM production_stages ORDER BY stage_order ASC`);
            const stageIds = stagesRes.rows.map((row: any) => row.id);
            const firstStageId = stageIds.length > 0 ? stageIds[0] : 1;

            const client = await pool.connect();
            try {
                await client.query('BEGIN');

                // 1. Upsert Work Orders
                for (const smtWo of smtRes.rows) {
                    const wo_number = smtWo.id;
                    const po_id = smtWo.po_id || null;
                    const product_name = smtWo.product_name || '-';
                    const product_description = smtWo.product_description || '-';
                    const sides = smtWo.sides || '-';
                    const quantity = parseInt(smtWo.quantity) || 0;
                    const customer_name = smtWo.customer_name || '-';
                    const model = smtWo.model_name || '-';
                    const selected_stages = formatSelectedStagesJson(smtWo.selected_stages);
                    const line_id = smtWo.line_id || 'SMT-1';
                    const priority = smtWo.priority || 'medium';
                    const solder_paste_status = smtWo.solder_paste_status || 'Pending';
                    const created_by = smtWo.created_by || 'System admin';
                    const created_at = smtWo.created_at || new Date();
                    const remark = smtWo.remark || null;
                    const has_smt = smtWo.has_smt !== false;
                    const has_backend = smtWo.has_backend !== false;

                    await client.query(
                        `INSERT INTO work_orders (
                            wo_number, po_id, product_name, product_description, sides, quantity, 
                            customer_name, model, selected_stages, line_id, priority, 
                            solder_paste_status, created_by, created_at, remark, has_smt, has_backend
                        )
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15, $16, $17)
                         ON CONFLICT (wo_number) 
                         DO UPDATE SET 
                            po_id = EXCLUDED.po_id,
                            product_name = EXCLUDED.product_name,
                            product_description = EXCLUDED.product_description,
                            sides = EXCLUDED.sides,
                            quantity = EXCLUDED.quantity,
                            customer_name = EXCLUDED.customer_name,
                            model = EXCLUDED.model,
                            selected_stages = EXCLUDED.selected_stages,
                            line_id = EXCLUDED.line_id,
                            priority = EXCLUDED.priority,
                            solder_paste_status = EXCLUDED.solder_paste_status,
                            created_by = EXCLUDED.created_by,
                            remark = EXCLUDED.remark,
                            has_smt = EXCLUDED.has_smt,
                            has_backend = EXCLUDED.has_backend`,
                        [
                            wo_number, po_id, product_name, product_description, sides, quantity,
                            customer_name, model, selected_stages, line_id, priority,
                            solder_paste_status, created_by, created_at, remark, has_smt, has_backend
                        ]
                    );
                }

                // 2. Set-based bulk batch creation for any work orders without a batch
                await client.query(`
                    INSERT INTO batches (work_order_id, batch_number, current_stage_id, created_by, created_at)
                    SELECT w.id, w.wo_number, $1, w.created_by, w.created_at
                    FROM work_orders w
                    ON CONFLICT (batch_number) 
                    DO UPDATE SET work_order_id = EXCLUDED.work_order_id
                `, [firstStageId]);

                // 3. Set-based bulk progress initialization across all batches and production stages in a single query
                await client.query(`
                    INSERT INTO batch_stage_progress (batch_id, stage_id)
                    SELECT b.id, ps.id
                    FROM batches b
                    CROSS JOIN production_stages ps
                    ON CONFLICT (batch_id, stage_id) DO NOTHING
                `);

                await client.query('COMMIT');

                // Update fingerprint after successful commit
                const finalCheck = await smtPool.query(`
                    SELECT count(*) as count, 
                           max(created_at)::text as max_created,
                           md5(COALESCE(string_agg(id || COALESCE(selected_stages::text, ''), ',' ORDER BY id), '')) as stages_hash
                    FROM smt_work_orders 
                    WHERE status NOT IN ('Deleted', 'Cancelled')
                `);
                lastKnownSmtFingerprint = `${finalCheck.rows[0]?.count || 0}_${finalCheck.rows[0]?.max_created || ''}_${finalCheck.rows[0]?.stages_hash || ''}`;
            } catch (txErr) {
                await client.query('ROLLBACK');
                throw txErr;
            } finally {
                client.release();
            }
        } catch (err: any) {
            console.error('Error in syncSmtWorkOrders:', err.message);
        } finally {
            inFlightSync = null;
        }
    })();

    return inFlightSync;
}

/**
 * On-demand single Work Order sync: fetches exactly 1 record from SMT DB
 * when requested by ID/number if it was not found in backend DB.
 */
export async function syncSingleWorkOrder(identifier: string | number): Promise<boolean> {
    if (!identifier) return false;
    let cleanId = String(identifier).trim();
    if (!cleanId) return false;

    // If identifier is a numeric ID, resolve wo_number from work_orders first if it exists
    if (typeof identifier === 'number' || /^\d+$/.test(cleanId)) {
        try {
            const localWo = await pool.query('SELECT wo_number FROM work_orders WHERE id = $1', [Number(cleanId)]);
            if (localWo.rows.length > 0 && localWo.rows[0].wo_number) {
                cleanId = localWo.rows[0].wo_number;
            }
        } catch {}
    }

    try {
        const smtRes = await smtPool.query(`
            SELECT id, po_id, product_name, product_description, sides, quantity, 
                   customer_name, model_name, selected_stages, line_id, priority, 
                   solder_paste_status, created_by, created_at, remark,
                   has_smt, has_backend
            FROM smt_work_orders 
            WHERE (UPPER(TRIM(id)) = UPPER($1) OR UPPER(TRIM(po_id)) = UPPER($1))
              AND status NOT IN ('Deleted', 'Cancelled')
            LIMIT 1
        `, [cleanId]);

        if (smtRes.rows.length === 0) return false;

        const smtWo = smtRes.rows[0];
        const wo_number = smtWo.id;
        const po_id = smtWo.po_id || null;
        const product_name = smtWo.product_name || '-';
        const product_description = smtWo.product_description || '-';
        const sides = smtWo.sides || '-';
        const quantity = parseInt(smtWo.quantity) || 0;
        const customer_name = smtWo.customer_name || '-';
        const model = smtWo.model_name || '-';
        const selected_stages = formatSelectedStagesJson(smtWo.selected_stages);
        const line_id = smtWo.line_id || 'SMT-1';
        const priority = smtWo.priority || 'medium';
        const solder_paste_status = smtWo.solder_paste_status || 'Pending';
        const created_by = smtWo.created_by || 'System admin';
        const created_at = smtWo.created_at || new Date();
        const remark = smtWo.remark || null;
        const has_smt = smtWo.has_smt !== false;
        const has_backend = smtWo.has_backend !== false;

        const stagesRes = await pool.query(`SELECT id FROM production_stages ORDER BY stage_order ASC`);
        const firstStageId = stagesRes.rows.length > 0 ? stagesRes.rows[0].id : 1;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const woRes = await client.query(
                `INSERT INTO work_orders (
                    wo_number, po_id, product_name, product_description, sides, quantity, 
                    customer_name, model, selected_stages, line_id, priority, 
                    solder_paste_status, created_by, created_at, remark, has_smt, has_backend
                )
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15, $16, $17)
                 ON CONFLICT (wo_number) 
                 DO UPDATE SET 
                    po_id = EXCLUDED.po_id,
                    product_name = EXCLUDED.product_name,
                    product_description = EXCLUDED.product_description,
                    sides = EXCLUDED.sides,
                    quantity = EXCLUDED.quantity,
                    customer_name = EXCLUDED.customer_name,
                    model = EXCLUDED.model,
                    selected_stages = EXCLUDED.selected_stages,
                    line_id = EXCLUDED.line_id,
                    priority = EXCLUDED.priority,
                    solder_paste_status = EXCLUDED.solder_paste_status,
                    created_by = EXCLUDED.created_by,
                    remark = EXCLUDED.remark,
                    has_smt = EXCLUDED.has_smt,
                    has_backend = EXCLUDED.has_backend
                 RETURNING id`,
                [
                    wo_number, po_id, product_name, product_description, sides, quantity,
                    customer_name, model, selected_stages, line_id, priority,
                    solder_paste_status, created_by, created_at, remark, has_smt, has_backend
                ]
            );

            const workOrderId = woRes.rows[0].id;

            const batchRes = await client.query(
                `INSERT INTO batches (work_order_id, batch_number, current_stage_id, created_by, created_at)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (batch_number) 
                 DO UPDATE SET work_order_id = EXCLUDED.work_order_id
                 RETURNING id`,
                [workOrderId, wo_number, firstStageId, created_by, created_at]
            );

            const batchId = batchRes.rows[0].id;

            for (const stageRow of stagesRes.rows) {
                await client.query(
                    `INSERT INTO batch_stage_progress (batch_id, stage_id)
                     VALUES ($1, $2)
                     ON CONFLICT (batch_id, stage_id) DO NOTHING`,
                    [batchId, stageRow.id]
                );
            }

            await client.query('COMMIT');
            return true;
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err: any) {
        console.error(`Error in syncSingleWorkOrder for "${identifier}":`, err.message);
        return false;
    }
}
