import { Request, Response } from 'express';
import pool from '../config/db';
import { createLogger } from '../utils/logger';

const logger = createLogger('SP_MASTER');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getActor = (req: Request): string =>
    (req as any).user?.name || (req as any).user?.employee_code || 'System';

const validateCanBody = (b: any): string | null => {
    const { can_id, manufacturing_date, expiry_date, total_weight_g, used_weight_g, min_thawing_hours, max_working_hours } = b;
    if (!can_id?.trim() || !manufacturing_date || !expiry_date)
        return 'Fields required: can_id, manufacturing_date, expiry_date';
    if (total_weight_g == null || Number(total_weight_g) <= 0)
        return 'Total weight must be a positive number';
    if (Number(used_weight_g ?? 0) < 0)
        return 'Used weight cannot be negative';
    if (Number(used_weight_g ?? 0) > Number(total_weight_g))
        return 'Used weight cannot exceed total weight';
    if (new Date(expiry_date) <= new Date(manufacturing_date))
        return 'Expiry date must be after manufacturing date';
    if (min_thawing_hours != null && Number(min_thawing_hours) < 0)
        return 'Minimum thawing hours cannot be negative';
    if (max_working_hours != null && Number(max_working_hours) <= 0)
        return 'Maximum working hours must be positive';
    return null;
};

// ─── Master List CRUD ──────────────────────────────────────────────────────────

/** GET /sp-master/cans */
export const getCans = async (req: Request, res: Response) => {
    const { search = '', filter = '', sort = 'expiry_asc', page = '1', limit = '50' } = req.query as Record<string, string>;
    try {
        const params: any[] = [];
        const conds: string[] = [];

        if (search.trim()) {
            params.push(`%${search.trim().toLowerCase()}%`);
            const p = `$${params.length}`;
            conds.push(`(LOWER(m.model) LIKE ${p} OR LOWER(m.make) LIKE ${p} OR LOWER(c.can_id) LIKE ${p})`);
        }
        if (filter === 'active')     conds.push('c.is_active = true');
        if (filter === 'expired')    conds.push('c.expiry_date < CURRENT_DATE');
        if (filter === 'available')  conds.push('c.is_active = true AND c.expiry_date >= CURRENT_DATE AND (c.total_weight_g - c.used_weight_g) > 0');
        if (filter === 'consumed')   conds.push('(c.total_weight_g - c.used_weight_g) <= 0');

        const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
        const orderMap: Record<string, string> = {
            expiry_asc:   'c.expiry_date ASC, c.can_id ASC',
            expiry_desc:  'c.expiry_date DESC',
            model_asc:    'm.model ASC, m.make ASC, c.expiry_date ASC',
            created_desc: 'c.created_at DESC',
        };
        const order = orderMap[sort] ?? 'c.expiry_date ASC, c.can_id ASC';

        const pg   = Math.max(1, parseInt(page));
        const lim  = Math.min(200, Math.max(1, parseInt(limit)));
        const offset = (pg - 1) * lim;

        const [countRow, data] = await Promise.all([
            pool.query(
                `SELECT COUNT(*)::int AS total 
                 FROM smt_solder_paste_cans c
                 JOIN smt_solder_paste_master m ON c.master_id = m.id
                 ${where}`, 
                params
            ),
            pool.query(
                `SELECT c.*, m.model, m.make, 
                        (c.total_weight_g - c.used_weight_g) AS remaining_weight_g,
                        (c.expiry_date < CURRENT_DATE) AS is_expired
                 FROM smt_solder_paste_cans c
                 JOIN smt_solder_paste_master m ON c.master_id = m.id
                 ${where}
                 ORDER BY ${order}
                 LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
                [...params, lim, offset]
            ),
        ]);

        return res.json({ total: countRow.rows[0].total, page: pg, limit: lim, data: data.rows });
    } catch (err: any) {
        logger.error('getCans:', err);
        return res.status(500).json({ error: 'Failed to fetch cans: ' + err.message });
    }
};

/** POST /sp-master/cans */
export const createCan = async (req: Request, res: Response) => {
    const err = validateCanBody(req.body);
    if (err) return res.status(400).json({ error: err });

    const { master_id, model, make, can_id, manufacturing_date, expiry_date, total_weight_g,
            used_weight_g = 0, min_thawing_hours = 4, max_working_hours = 8 } = req.body;
    const actor = getActor(req);
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Check if Can ID is unique
        const dup = await client.query('SELECT id FROM smt_solder_paste_cans WHERE LOWER(can_id) = LOWER($1)', [can_id.trim()]);
        if (dup.rows.length) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: `Can ID "${can_id}" already exists` });
        }

        // Get or Create Model record (Parent)
        let masterId = master_id;
        let modelName = model?.trim();
        let makeName = make?.trim();

        if (masterId) {
            const masterRow = await client.query('SELECT model, make FROM smt_solder_paste_master WHERE id = $1', [masterId]);
            if (!masterRow.rows.length) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Selected Model Master not found' });
            }
            modelName = masterRow.rows[0].model;
            makeName = masterRow.rows[0].make;
        } else {
            if (!modelName || !makeName) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Model and Make are required when creating a new Model' });
            }
            // Find or create
            const mEx = await client.query(
                'SELECT id FROM smt_solder_paste_master WHERE LOWER(model) = LOWER($1) AND LOWER(make) = LOWER($2)',
                [modelName, makeName]
            );
            if (mEx.rows.length) {
                masterId = mEx.rows[0].id;
            } else {
                const mIns = await client.query(
                    `INSERT INTO smt_solder_paste_master (model, make, is_active, created_by, updated_by)
                     VALUES ($1, $2, true, $3, $3) RETURNING id`,
                    [modelName, makeName, actor]
                );
                masterId = mIns.rows[0].id;
            }
        }

        // Insert into Solder Paste Cans (Child)
        const { rows } = await client.query(
            `INSERT INTO smt_solder_paste_cans
             (master_id, can_id, manufacturing_date, expiry_date, total_weight_g, used_weight_g,
              min_thawing_hours, max_working_hours, is_active, created_by, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$9) RETURNING *`,
            [masterId, can_id.trim(), manufacturing_date, expiry_date,
             total_weight_g, used_weight_g, min_thawing_hours, max_working_hours, actor]
        );
        const row = rows[0];

        // Audit Trail
        await client.query(
            `INSERT INTO smt_solder_paste_usage_history (can_id, master_id, weight_used_g, operator, action, notes)
             VALUES ($1, $2, $3, $4, 'CREATE', $5)`,
            [row.id, masterId, used_weight_g, actor, `Can ${can_id} created under Model: ${modelName}, Make: ${makeName}`]
        );

        await client.query('COMMIT');
        return res.status(201).json({
            message: 'Can created successfully',
            data: {
                ...row,
                model: modelName,
                make: makeName,
                remaining_weight_g: Number(row.total_weight_g) - Number(row.used_weight_g)
            }
        });
    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error('createCan:', err);
        return res.status(500).json({ error: 'Failed to create can: ' + err.message });
    } finally { client.release(); }
};

/** PUT /sp-master/cans/:id */
export const updateCan = async (req: Request, res: Response) => {
    const err = validateCanBody(req.body);
    if (err) return res.status(400).json({ error: err });

    const { id } = req.params;
    const { can_id, manufacturing_date, expiry_date, total_weight_g,
            used_weight_g, min_thawing_hours, max_working_hours, is_active } = req.body;
    const actor = getActor(req);
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const existing = await client.query('SELECT * FROM smt_solder_paste_cans WHERE id = $1', [id]);
        if (!existing.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Can not found' });
        }
        const old = existing.rows[0];

        // Unique can_id check (excluding self)
        const dup = await client.query('SELECT id FROM smt_solder_paste_cans WHERE LOWER(can_id) = LOWER($1) AND id != $2', [can_id.trim(), id]);
        if (dup.rows.length) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: `Can ID "${can_id}" already exists on another record` });
        }

        const { rows } = await client.query(
            `UPDATE smt_solder_paste_cans SET can_id=$1, manufacturing_date=$2, expiry_date=$3,
             total_weight_g=$4, used_weight_g=$5, min_thawing_hours=$6, max_working_hours=$7,
             is_active=$8, updated_by=$9, updated_at=CURRENT_TIMESTAMP
             WHERE id=$10 RETURNING *`,
            [can_id.trim(), manufacturing_date, expiry_date,
             total_weight_g, used_weight_g, min_thawing_hours, max_working_hours,
             is_active ?? old.is_active, actor, id]
        );

        // Audit Trail
        await client.query(
            `INSERT INTO smt_solder_paste_usage_history (can_id, master_id, weight_used_g, operator, action, notes)
             VALUES ($1, $2, $3, $4, 'UPDATE', $5)`,
            [id, old.master_id, Number(used_weight_g) - Number(old.used_weight_g), actor, `Can ${can_id} details updated`]
        );

        await client.query('COMMIT');
        const r = rows[0];
        return res.json({ message: 'Can updated successfully', data: { ...r, remaining_weight_g: Number(r.total_weight_g) - Number(r.used_weight_g) } });
    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error('updateCan:', err);
        return res.status(500).json({ error: 'Failed to update can: ' + err.message });
    } finally { client.release(); }
};

/** DELETE /sp-master/cans/:id  (soft-delete/deactivate) */
export const deleteCan = async (req: Request, res: Response) => {
    const { id } = req.params;
    const actor = getActor(req);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const existing = await client.query('SELECT * FROM smt_solder_paste_cans WHERE id = $1', [id]);
        if (!existing.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Can not found' });
        }
        const old = existing.rows[0];

        await client.query(
            `UPDATE smt_solder_paste_cans SET is_active=false, updated_by=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2`,
            [actor, id]
        );

        // Audit Trail
        await client.query(
            `INSERT INTO smt_solder_paste_usage_history (can_id, master_id, weight_used_g, operator, action, notes)
             VALUES ($1, $2, 0, $3, 'DEACTIVATE', $4)`,
            [id, old.master_id, actor, `Can deactivated`]
        );

        await client.query('COMMIT');
        return res.json({ message: 'Can deactivated successfully' });
    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error('deleteCan:', err);
        return res.status(500).json({ error: 'Failed to deactivate can: ' + err.message });
    } finally { client.release(); }
};

// ─── Distinct Models ───────────────────────────────────────────────────────────

/** GET /sp-master/models */
export const getModels = async (_req: Request, res: Response) => {
    try {
        const { rows } = await pool.query(
            `SELECT id, model, make FROM smt_solder_paste_master
             WHERE is_active = true ORDER BY model ASC, make ASC`
        );
        return res.json(rows);
    } catch (err: any) {
        logger.error('getModels:', err);
        return res.status(500).json({ error: 'Failed to fetch models: ' + err.message });
    }
};

/** PUT /sp-master/models/:id */
export const updateModel = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { model, make } = req.body;
    if (!model?.trim() || !make?.trim()) {
        return res.status(400).json({ error: 'model and make are required' });
    }
    const actor = getActor(req);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const dup = await client.query('SELECT id FROM smt_solder_paste_master WHERE LOWER(model) = LOWER($1) AND LOWER(make) = LOWER($2) AND id != $3', [model.trim(), make.trim(), id]);
        if (dup.rows.length) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: `Model "${model}" with Make "${make}" already exists` });
        }

        const { rows } = await client.query(
            `UPDATE smt_solder_paste_master SET model=$1, make=$2, updated_by=$3, updated_at=CURRENT_TIMESTAMP WHERE id=$4 RETURNING *`,
            [model.trim(), make.trim(), actor, id]
        );
        if (!rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Model not found' });
        }

        // Audit Trail on linked cans
        const linkedCans = await client.query('SELECT id FROM smt_solder_paste_cans WHERE master_id = $1', [id]);
        for (const c of linkedCans.rows) {
            await client.query(
                `INSERT INTO smt_solder_paste_usage_history (can_id, master_id, weight_used_g, operator, action, notes)
                 VALUES ($1, $2, 0, $3, 'UPDATE', $4)`,
                [c.id, id, actor, `Parent model/make renamed to Model: ${model.trim()}, Make: ${make.trim()}`]
            );
        }

        await client.query('COMMIT');
        return res.json({ message: 'Model updated successfully', data: rows[0] });
    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error('updateModel:', err);
        return res.status(500).json({ error: 'Failed to update model: ' + err.message });
    } finally { client.release(); }
};

// ─── FIFO Selection ────────────────────────────────────────────────────────────

/** GET /sp-master/fifo?model= */
export const getFifoCan = async (req: Request, res: Response) => {
    const { model } = req.query as Record<string, string>;
    if (!model) return res.status(400).json({ error: 'model is required' });

    try {
        const q = `SELECT c.*, m.model, m.make, (c.total_weight_g - c.used_weight_g) AS remaining_weight_g
                   FROM smt_solder_paste_cans c
                   JOIN smt_solder_paste_master m ON c.master_id = m.id
                   WHERE LOWER(m.model) = LOWER($1)
                     AND c.is_active = true
                     AND c.expiry_date >= CURRENT_DATE
                     AND (c.total_weight_g - c.used_weight_g) > 0
                   ORDER BY c.expiry_date ASC, c.can_id ASC LIMIT 1`;

        const { rows } = await pool.query(q, [model.trim()]);
        if (!rows.length) {
            return res.status(404).json({ error: 'No Available Solder Paste Can' });
        }
        return res.json(rows[0]);
    } catch (err: any) {
        logger.error('getFifoCan:', err);
        return res.status(500).json({ error: 'FIFO lookup failed: ' + err.message });
    }
};

// ─── Sessions (Refrigerator Removal Events) ───────────────────────────────────

/** POST /sp-master/sessions */
export const startSession = async (req: Request, res: Response) => {
    const { can_id, operator, notes } = req.body;
    if (!can_id) return res.status(400).json({ error: 'can_id is required' });

    const actor = operator?.trim() || getActor(req);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Check the status and detail of the requested Can, locking it for update
        const canRow = await client.query(
            `SELECT c.*, m.model, m.make FROM smt_solder_paste_cans c
             JOIN smt_solder_paste_master m ON c.master_id = m.id
             WHERE c.id = $1 FOR UPDATE OF c`, [can_id]
        );
        if (!canRow.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Can not found' });
        }
        let can = canRow.rows[0];

        // Concurrency Check: Is this can available?
        // Available means: is_active = true, expiry_date >= current_date, remaining weight > 0, and no session with working_expires_at >= CURRENT_TIMESTAMP
        const activeSessionEx = await client.query(
            `SELECT id FROM smt_solder_paste_sessions 
             WHERE can_id = $1 AND working_expires_at >= CURRENT_TIMESTAMP`, [can_id]
        );
        const remainingWeight = Number(can.total_weight_g) - Number(can.used_weight_g);
        const isExpired = new Date(can.expiry_date) < new Date(new Date().toDateString());

        let targetCanId = can_id;

        if (!can.is_active || isExpired || remainingWeight <= 0 || activeSessionEx.rows.length > 0) {
            // Can is unavailable! Find the NEXT available FIFO Can for the same master_id
            const nextCanEx = await client.query(
                `SELECT c.* FROM smt_solder_paste_cans c
                 WHERE c.master_id = $1
                   AND c.is_active = true
                   AND c.expiry_date >= CURRENT_DATE
                   AND (c.total_weight_g - c.used_weight_g) > 0
                   AND c.id NOT IN (
                       SELECT can_id FROM smt_solder_paste_sessions 
                       WHERE working_expires_at >= CURRENT_TIMESTAMP
                   )
                 ORDER BY c.expiry_date ASC, c.can_id ASC
                 FOR UPDATE OF c
                 LIMIT 1`,
                [can.master_id]
            );

            if (!nextCanEx.rows.length) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'No Available Solder Paste Can' });
            }
            can = nextCanEx.rows[0];
            targetCanId = can.id;
        }

        const removedAt = new Date();
        const thawingReadyAt  = new Date(removedAt.getTime() + Number(can.min_thawing_hours)  * 3600000);
        const workingExpiresAt = new Date(thawingReadyAt.getTime()  + Number(can.max_working_hours) * 3600000);

        const { rows } = await client.query(
            `INSERT INTO smt_solder_paste_sessions (can_id, removed_at, thawing_ready_at, working_expires_at, operator, notes)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [targetCanId, removedAt, thawingReadyAt, workingExpiresAt, actor, notes || null]
        );
        const session = rows[0];

        // Audit Trail
        await client.query(
            `INSERT INTO smt_solder_paste_usage_history (can_id, master_id, weight_used_g, operator, action, notes)
             VALUES ($1, $2, 0, $3, 'SESSION_START', $4)`,
            [targetCanId, can.master_id, actor, `Session started for can ${can.can_id}`]
        );

        await client.query('COMMIT');
        return res.status(201).json({ message: 'Session started', data: session });
    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error('startSession:', err);
        return res.status(500).json({ error: 'Failed to start session: ' + err.message });
    } finally { client.release(); }
};

/** GET /sp-master/sessions/latest?canId= */
export const getLatestSession = async (req: Request, res: Response) => {
    const { canId } = req.query as Record<string, string>;
    if (!canId) return res.status(400).json({ error: 'canId is required' });
    try {
        const { rows } = await pool.query(
            `SELECT * FROM smt_solder_paste_sessions WHERE can_id = $1 ORDER BY removed_at DESC LIMIT 1`,
            [canId]
        );
        if (!rows.length) return res.status(404).json({ error: 'No session found' });
        return res.json(rows[0]);
    } catch (err: any) {
        logger.error('getLatestSession:', err);
        return res.status(500).json({ error: 'Failed to fetch session: ' + err.message });
    }
};

// ─── Weight Consumption ────────────────────────────────────────────────────────

/** POST /sp-master/consume */
export const recordConsumption = async (req: Request, res: Response) => {
    const { can_id, session_id, weight_consumed_g, consumed_by, notes } = req.body;
    if (!can_id || !weight_consumed_g) return res.status(400).json({ error: 'can_id and weight_consumed_g are required' });
    if (Number(weight_consumed_g) <= 0) return res.status(400).json({ error: 'Weight consumed must be positive' });

    const actor = consumed_by?.trim() || getActor(req);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const canRow = await client.query(
            `SELECT * FROM smt_solder_paste_cans WHERE id = $1 FOR UPDATE OF smt_solder_paste_cans`, [can_id]
        );
        if (!canRow.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Can not found' });
        }
        const can = canRow.rows[0];
        const remaining = Number(can.total_weight_g) - Number(can.used_weight_g);
        if (Number(weight_consumed_g) > remaining) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: `Cannot consume ${weight_consumed_g}g — only ${remaining.toFixed(2)}g remaining` });
        }

        const newUsed = Number(can.used_weight_g) + Number(weight_consumed_g);

        // Update can used weight
        await client.query(
            `UPDATE smt_solder_paste_cans SET used_weight_g=$1, updated_by=$2, updated_at=CURRENT_TIMESTAMP WHERE id=$3`,
            [newUsed, actor, can_id]
        );

        // Audit Trail (consolidated under usage history table)
        const { rows: historyRows } = await client.query(
            `INSERT INTO smt_solder_paste_usage_history 
             (can_id, master_id, weight_used_g, operator, action, notes)
             VALUES ($1,$2,$3,$4,'CONSUME',$5) RETURNING *`,
            [can_id, can.master_id, weight_consumed_g, actor, notes || `Consumed ${weight_consumed_g}g`]
        );

        const newRemaining = Number(can.total_weight_g) - newUsed;
        await client.query('COMMIT');

        return res.json({
            message: 'Consumption recorded',
            data: historyRows[0],
            can_remaining_weight_g: newRemaining,
            can_exhausted: newRemaining <= 0,
        });
    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error('recordConsumption:', err);
        return res.status(500).json({ error: 'Failed to record consumption: ' + err.message });
    } finally { client.release(); }
};

/** GET /sp-master/consumption?canId= */
export const getConsumptionHistory = async (req: Request, res: Response) => {
    const { canId } = req.query as Record<string, string>;
    if (!canId) return res.status(400).json({ error: 'canId is required' });
    try {
        const { rows } = await pool.query(
            `SELECT h.*, h.created_at AS consumed_at
             FROM smt_solder_paste_usage_history h
             WHERE h.can_id = $1 AND h.action = 'CONSUME'
             ORDER BY h.created_at DESC`,
            [canId]
        );
        return res.json(rows);
    } catch (err: any) {
        logger.error('getConsumptionHistory:', err);
        return res.status(500).json({ error: 'Failed to fetch history: ' + err.message });
    }
};
