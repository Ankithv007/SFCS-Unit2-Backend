import pool from '../config/db';

export interface DowntimeInputData {
    shift: string;
    line: string;
    machine_name: string;
    start_time: string;
    end_time: string;
    downtime_category: string;
    downtime_description: string;
    action_taken: string;
    responsible_person: string;
    status?: string;
    remarks?: string;
    work_order_id?: string | null;
}

export interface SessionUserInfo {
    id: string | null;
    name: string;
    role: string;
    email: string;
}

export interface GetRecordsQueryOptions {
    page?: number;
    limit?: number;
    search?: string;
    sortBy?: string;
    sortOrder?: 'ASC' | 'DESC';
}

export class SmtDowntimeService {
    /**
     * Create a new downtime record
     */
    static async createDowntimeRecord(data: DowntimeInputData, sessionUser: SessionUserInfo) {
        const start = new Date(data.start_time);
        const end = new Date(data.end_time);

        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            throw new Error('Invalid start time or end time.');
        }

        if (end <= start) {
            throw new Error('End Time must be greater than Start Time.');
        }

        const duration = (end.getTime() - start.getTime()) / (1000 * 60);

        // Validation of Work Order
        if (data.work_order_id) {
            const woRes = await pool.query(`SELECT smt_production_status FROM smt_work_orders WHERE id = $1`, [data.work_order_id]);
            if (woRes.rowCount === 0) {
                throw new Error(`Invalid Work Order ID: ${data.work_order_id} does not exist.`);
            }
            const woStatus = woRes.rows[0].smt_production_status.toLowerCase();
            if (!['pending', 'in progress'].includes(woStatus)) {
                throw new Error(`Work Order ID: ${data.work_order_id} is ${woRes.rows[0].smt_production_status}. Only Pending or In Progress Work Orders can be linked.`);
            }
        }

        const query = `
            INSERT INTO smt_downtime_records (
                shift, line, machine_name, start_time, end_time, duration,
                downtime_category, downtime_description, action_taken,
                responsible_person, status, remarks, created_by, created_by_name,
                work_order_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            RETURNING *
        `;

        const values = [
            data.shift,
            data.line,
            data.machine_name,
            start,
            end,
            duration,
            data.downtime_category,
            data.downtime_description,
            data.action_taken,
            data.responsible_person,
            data.status || 'Open',
            data.remarks || null,
            sessionUser.email,
            sessionUser.name,
            data.work_order_id || null
        ];

        const { rows } = await pool.query(query, values);
        return rows[0];
    }

    /**
     * Fetch paginated and filtered downtime records
     */
    static async getDowntimeRecords(options: GetRecordsQueryOptions) {
        const page = options.page || 1;
        const limit = options.limit || 10;
        const search = options.search;
        const sortBy = options.sortBy;
        const sortOrder = options.sortOrder === 'ASC' ? 'ASC' : 'DESC';
        const offset = (page - 1) * limit;

        let whereClause = '';
        const queryParams: any[] = [];

        if (search) {
            whereClause = `
                WHERE shift ILIKE $1 
                   OR line ILIKE $1 
                   OR machine_name ILIKE $1 
                   OR downtime_category ILIKE $1 
                   OR responsible_person ILIKE $1 
                   OR status ILIKE $1
            `;
            queryParams.push(`%${search}%`);
        }

        const countQuery = `SELECT COUNT(*) FROM smt_downtime_records ${whereClause}`;
        const countRes = await pool.query(countQuery, queryParams);
        const total = parseInt(countRes.rows[0].count, 10);

        const allowedSortColumns = ['shift', 'line', 'machine_name', 'downtime_category', 'start_time', 'end_time', 'duration', 'responsible_person', 'status'];
        const validSortBy = allowedSortColumns.includes(sortBy || '') ? sortBy : 'start_time';

        const selectQuery = `
            SELECT r.*,
                   wo.po_id, wo.product_name, wo.sides AS work_order_sides, wo.quantity AS work_order_quantity, wo.panel_quantity, wo.product_description
            FROM smt_downtime_records r
            LEFT JOIN smt_work_orders wo ON r.work_order_id = wo.id
            ${whereClause}
            ORDER BY ${validSortBy} ${sortOrder}
            LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
        `;

        queryParams.push(limit, offset);
        const { rows } = await pool.query(selectQuery, queryParams);

        return {
            data: rows,
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            }
        };
    }

    /**
     * Update an existing downtime record
     */
    static async updateDowntimeRecord(id: string, data: DowntimeInputData, sessionUser: SessionUserInfo) {
        const checkRes = await pool.query(`SELECT id FROM smt_downtime_records WHERE id = $1`, [id]);
        if (checkRes.rowCount === 0) {
            return null;
        }

        const start = new Date(data.start_time);
        const end = new Date(data.end_time);

        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            throw new Error('Invalid start time or end time.');
        }

        if (end <= start) {
            throw new Error('End Time must be greater than Start Time.');
        }

        const duration = (end.getTime() - start.getTime()) / (1000 * 60);

        // Validation of Work Order
        if (data.work_order_id) {
            const woRes = await pool.query(`SELECT smt_production_status FROM smt_work_orders WHERE id = $1`, [data.work_order_id]);
            if (woRes.rowCount === 0) {
                throw new Error(`Invalid Work Order ID: ${data.work_order_id} does not exist.`);
            }
            const woStatus = woRes.rows[0].smt_production_status.toLowerCase();
            if (!['pending', 'in progress'].includes(woStatus)) {
                throw new Error(`Work Order ID: ${data.work_order_id} is ${woRes.rows[0].smt_production_status}. Only Pending or In Progress Work Orders can be linked.`);
            }
        }

        const query = `
            UPDATE smt_downtime_records
            SET shift = $1,
                line = $2,
                machine_name = $3,
                start_time = $4,
                end_time = $5,
                duration = $6,
                downtime_category = $7,
                downtime_description = $8,
                action_taken = $9,
                responsible_person = $10,
                status = COALESCE($11, status, 'Open'),
                remarks = $12,
                updated_by = $13,
                updated_by_name = $14,
                updated_at = CURRENT_TIMESTAMP,
                work_order_id = $15
            WHERE id = $16
            RETURNING *
        `;

        const values = [
            data.shift,
            data.line,
            data.machine_name,
            start,
            end,
            duration,
            data.downtime_category,
            data.downtime_description,
            data.action_taken,
            data.responsible_person,
            data.status || null,
            data.remarks || null,
            sessionUser.email,
            sessionUser.name,
            data.work_order_id || null,
            id
        ];

        const { rows } = await pool.query(query, values);
        return rows[0];
    }

    /**
     * Delete a downtime record by ID
     */
    static async deleteDowntimeRecord(id: string) {
        const checkRes = await pool.query(`SELECT id FROM smt_downtime_records WHERE id = $1`, [id]);
        if (checkRes.rowCount === 0) {
            return false;
        }

        await pool.query(`DELETE FROM smt_downtime_records WHERE id = $1`, [id]);
        return true;
    }

    /**
     * Fetch aggregated dashboard summary & chart metrics
     */
    static async getDowntimeDashboard() {
        const summaryQuery = `
            SELECT 
                COALESCE(COUNT(*), 0) AS total_records,
                COALESCE(SUM(duration), 0) AS total_duration,
                COALESCE(AVG(duration), 0) AS avg_duration,
                COALESCE(SUM(CASE WHEN status = 'Open' THEN 1 ELSE 0 END), 0) AS open_issues,
                COALESCE(SUM(CASE WHEN status = 'Closed' THEN 1 ELSE 0 END), 0) AS closed_issues
            FROM smt_downtime_records
        `;
        const summaryRes = await pool.query(summaryQuery);
        const summary = summaryRes.rows[0];

        const machineQuery = `
            SELECT machine_name, SUM(duration) AS total_duration
            FROM smt_downtime_records
            GROUP BY machine_name
            ORDER BY total_duration DESC
            LIMIT 1
        `;
        const machineRes = await pool.query(machineQuery);
        const mostAffectedMachine = machineRes.rows[0]?.machine_name || 'N/A';

        const categoryQuery = `
            SELECT downtime_category, COUNT(*) AS count
            FROM smt_downtime_records
            GROUP BY downtime_category
            ORDER BY count DESC
            LIMIT 1
        `;
        const categoryRes = await pool.query(categoryQuery);
        const mostFrequentCategory = categoryRes.rows[0]?.downtime_category || 'N/A';

        const categoryBreakdownQuery = `
            SELECT downtime_category AS name, SUM(duration) AS value
            FROM smt_downtime_records
            GROUP BY downtime_category
        `;
        const categoryBreakdownRes = await pool.query(categoryBreakdownQuery);

        const machineBreakdownQuery = `
            SELECT machine_name AS name, SUM(duration) AS value
            FROM smt_downtime_records
            GROUP BY machine_name
        `;
        const machineBreakdownRes = await pool.query(machineBreakdownQuery);

        const shiftBreakdownQuery = `
            SELECT shift AS name, SUM(duration) AS value
            FROM smt_downtime_records
            GROUP BY shift
        `;
        const shiftBreakdownRes = await pool.query(shiftBreakdownQuery);

        const statusDistributionQuery = `
            SELECT status AS name, COUNT(*) AS value
            FROM smt_downtime_records
            GROUP BY status
        `;
        const statusDistributionRes = await pool.query(statusDistributionQuery);

        return {
            summary: {
                total_records: parseInt(summary.total_records, 10),
                total_duration: parseFloat(summary.total_duration || 0),
                avg_duration: parseFloat(summary.avg_duration || 0),
                open_issues: parseInt(summary.open_issues, 10),
                closed_issues: parseInt(summary.closed_issues, 10),
                most_affected_machine: mostAffectedMachine,
                most_frequent_category: mostFrequentCategory
            },
            charts: {
                category: categoryBreakdownRes.rows,
                machine: machineBreakdownRes.rows,
                shift: shiftBreakdownRes.rows,
                status: statusDistributionRes.rows
            }
        };
    }

    /**
     * Fetch pending work orders
     */
    static async getPendingWorkOrders() {
        const { rows } = await pool.query(
            `SELECT id, po_id, product_name, sides, quantity, panel_quantity, product_description, smt_production_status AS status
             FROM smt_work_orders
             WHERE LOWER(smt_production_status) IN ('pending', 'in progress')
             ORDER BY created_at DESC`
        );
        return rows;
    }
}

