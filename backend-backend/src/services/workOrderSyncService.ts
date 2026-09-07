import pool, { smtPool } from '../config/db';

export async function syncSmtWorkOrders(): Promise<void> {
    try {
        // Ensure columns exist on work_orders table in backend_db
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
            ADD COLUMN IF NOT EXISTS updated_by VARCHAR(100),
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;
        `);

        const smtRes = await smtPool.query(`
            SELECT id, po_id, product_name, product_description, sides, quantity, 
                   customer_name, model_name, selected_stages, line_id, priority, 
                   solder_paste_status, created_by, created_at, remark
            FROM smt_work_orders 
            WHERE status NOT IN ('Deleted', 'Cancelled')
        `);

        if (!smtRes.rows || smtRes.rows.length === 0) return;

        const stagesRes = await pool.query(`SELECT id FROM production_stages ORDER BY stage_order ASC`);
        const stageIds = stagesRes.rows.map((row: any) => row.id);
        const firstStageId = stageIds.length > 0 ? stageIds[0] : 1;

        for (const smtWo of smtRes.rows) {
            const wo_number = smtWo.id;
            const po_id = smtWo.po_id || null;
            const product_name = smtWo.product_name || '-';
            const product_description = smtWo.product_description || '-';
            const sides = smtWo.sides || '-';
            const quantity = parseInt(smtWo.quantity) || 0;
            const customer_name = smtWo.customer_name || '-';
            const model = smtWo.model_name || '-';
            const selected_stages = smtWo.selected_stages ? JSON.stringify(smtWo.selected_stages) : JSON.stringify(["PTH", "VI", "QA", "Flashing", "PCBA-FCT", "Assembly", "Unit Testing", "QI", "Packing"]);
            const line_id = smtWo.line_id || 'SMT-1';
            const priority = smtWo.priority || 'medium';
            const solder_paste_status = smtWo.solder_paste_status || 'Pending';
            const created_by = smtWo.created_by || 'System admin';
            const created_at = smtWo.created_at || new Date();
            const remark = smtWo.remark || null;

            // 1. Upsert into work_orders in backend_db
            const woRes = await pool.query(
                `INSERT INTO work_orders (
                    wo_number, po_id, product_name, product_description, sides, quantity, 
                    customer_name, model, selected_stages, line_id, priority, 
                    solder_paste_status, created_by, created_at, remark
                )
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
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
                    remark = EXCLUDED.remark
                 RETURNING id`,
                [
                    wo_number, po_id, product_name, product_description, sides, quantity,
                    customer_name, model, selected_stages, line_id, priority,
                    solder_paste_status, created_by, created_at, remark
                ]
            );

            const workOrderId = woRes.rows[0].id;

            // 2. Upsert into batches in backend_db
            const batchRes = await pool.query(
                `INSERT INTO batches (work_order_id, batch_number, current_stage_id, created_by, created_at)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (batch_number) 
                 DO UPDATE SET work_order_id = EXCLUDED.work_order_id
                 RETURNING id`,
                [workOrderId, wo_number, firstStageId, created_by, created_at]
            );

            const batchId = batchRes.rows[0].id;

            // 3. Ensure batch_stage_progress records exist for all stages
            for (const stageId of stageIds) {
                await pool.query(
                    `INSERT INTO batch_stage_progress (batch_id, stage_id)
                     VALUES ($1, $2)
                     ON CONFLICT (batch_id, stage_id) DO NOTHING`,
                    [batchId, stageId]
                );
            }
        }
    } catch (err) {
        console.error('Error syncing SMT work orders to backend:', err);
    }
}
