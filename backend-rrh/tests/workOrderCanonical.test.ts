import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import { pool, withTransaction } from '../src/utils/db';

describe('Canonical Identity and Referential Integrity Tests', () => {
    const testWoId = `TEST_CANON_${Date.now()}`;

    after(async () => {
        // Clean up test records
        await pool.query(
            "DELETE FROM rrh_work_orders WHERE work_order_id ILIKE 'TEST_CANON_%'"
        );
        await pool.end();
    });

    test('Work order identity is automatically canonicalized (UPPER and TRIM)', async () => {
        const inputId = `   ${testWoId.toLowerCase()}   `;
        const res = await pool.query(
            `INSERT INTO rrh_work_orders (work_order_id, lot_quantity, status)
             VALUES ($1, 10, 'CREATED')
             RETURNING id, work_order_id;`,
            [inputId]
        );

        assert.strictEqual(res.rows.length, 1);
        assert.strictEqual(res.rows[0].work_order_id, testWoId.toUpperCase());
    });

    test('Duplicate work order with differing whitespace/case violates unique constraint', async () => {
        const duplicateInput = `  ${testWoId.toUpperCase()}  `;
        await assert.rejects(
            async () => {
                await pool.query(
                    `INSERT INTO rrh_work_orders (work_order_id, lot_quantity, status)
                     VALUES ($1, 20, 'CREATED');`,
                    [duplicateInput]
                );
            },
            (err: any) => {
                return err.code === '23505';
            }
        );
    });

    test('Cross-work-order active_import_id is blocked with check_violation', async () => {
        await assert.rejects(
            async () => {
                await pool.query(
                    `UPDATE rrh_work_orders 
                     SET active_import_id = 99999999
                     WHERE work_order_id = $1;`,
                    [testWoId.toUpperCase()]
                );
            },
            (err: any) => {
                return err.code === '23514'; // check_violation
            }
        );
    });

    test('Child table trigger writes canonical work_order_id and resolves internal ID', async () => {
        const childInput = `  ${testWoId.toLowerCase()}  `;
        const sessionRes = await pool.query(
            `INSERT INTO rrh_inward_sessions (work_order_id, status, created_by, created_by_name)
             VALUES ($1, 'In Progress', 'ci_test', 'ci_test')
             RETURNING id, work_order_id, work_order_internal_id;`,
            [childInput]
        );

        assert.strictEqual(sessionRes.rows.length, 1);
        assert.strictEqual(sessionRes.rows[0].work_order_id, testWoId.toUpperCase());
        assert.ok(sessionRes.rows[0].work_order_internal_id > 0);

        // Clean up child session
        await pool.query('DELETE FROM rrh_inward_sessions WHERE id = $1', [sessionRes.rows[0].id]);
    });
});
