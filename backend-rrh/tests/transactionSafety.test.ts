import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import { pool, withTransaction, withClient, getPoolDiagnostics } from '../src/utils/db';

describe('Transaction Safety and Connection Leak Immunity Tests', () => {
    after(async () => {
        await pool.end();
    });
    test('withTransaction successfully commits changes and releases connection', async () => {
        const initialDiag = getPoolDiagnostics();

        const testVal = await withTransaction(async (client) => {
            const res = await client.query('SELECT 42 as answer;');
            return res.rows[0].answer;
        });

        assert.strictEqual(testVal, 42);

        // Verify pool client was released back
        const postDiag = getPoolDiagnostics();
        assert.ok(postDiag.waitingCount === 0);
    });

    test('withTransaction automatically rolls back on error and releases connection without leaking', async () => {
        const dummyTable = `test_tx_leak_${Date.now()}`;
        
        await pool.query(`CREATE TEMP TABLE ${dummyTable} (val INT);`);

        await assert.rejects(
            async () => {
                await withTransaction(async (client) => {
                    await client.query(`INSERT INTO ${dummyTable} VALUES (100);`);
                    throw new Error('Simulated intentional transaction failure');
                });
            },
            /Simulated intentional transaction failure/
        );

        // Verify row was rolled back
        const checkRes = await pool.query(`SELECT count(*) as cnt FROM ${dummyTable};`);
        assert.strictEqual(Number(checkRes.rows[0].cnt), 0);

        // Verify connection was released
        const postDiag = getPoolDiagnostics();
        assert.ok(postDiag.waitingCount === 0);
    });

    test('withClient guarantees connection release even on unhandled exception', async () => {
        await assert.rejects(
            async () => {
                await withClient(async () => {
                    throw new Error('Unhandled exception inside withClient');
                });
            },
            /Unhandled exception inside withClient/
        );

        const postDiag = getPoolDiagnostics();
        assert.ok(postDiag.waitingCount === 0);
    });
});
