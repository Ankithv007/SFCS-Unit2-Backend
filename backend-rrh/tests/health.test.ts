import { test, describe } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';

const BASE_URL = process.env.TEST_API_URL || 'http://localhost:5007';

function get(path: string): Promise<{ statusCode: number; data: any }> {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        http.get(url, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    resolve({ statusCode: res.statusCode || 500, data: parsed });
                } catch {
                    resolve({ statusCode: res.statusCode || 500, data: body });
                }
            });
        }).on('error', reject);
    });
}

describe('Health and Diagnostics Telemetry Endpoints', () => {
    test('GET /api/rrh/health returns 200 and healthy status', async () => {
        const res = await get('/api/rrh/health');
        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.data.status, 'healthy');
        assert.strictEqual(res.data.service, 'backend-rrh');
        assert.strictEqual(typeof res.data.uptime, 'number');
    });

    test('GET /api/rrh/ready returns 200 and database connected', async () => {
        const res = await get('/api/rrh/ready');
        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.data.status, 'ready');
        assert.strictEqual(res.data.database, 'connected');
    });

    test('GET /api/rrh/diagnostics returns 200 with pool and memory telemetry', async () => {
        const res = await get('/api/rrh/diagnostics');
        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.data.status, 'operational');
        assert.ok(res.data.memory.heapUsedMb >= 0);
        assert.ok(res.data.database.totalCount >= 0);
        assert.strictEqual(res.data.database.statementTimeoutMs, 15000);
    });
});
