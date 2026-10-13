import { Pool } from 'pg';
import { createLogger } from './logger';

const logger = createLogger('Database');

const rrhDbName = process.env.DB_NAME || process.env.DB_NAME_RRH || 'rrh_db';

// Strict Safety Guard: Block any accidental connection to production SMT or Backend databases
if (rrhDbName === 'smt_db' || rrhDbName === 'backend_process_db') {
    throw new Error(`CRITICAL SECURITY VIOLATION: backend-rrh is strictly isolated and prohibited from connecting to '${rrhDbName}'! It must connect only to 'rrh_db'.`);
}

// Strict Production Credential Guard: Prevent silent fallback to default password in production
if (process.env.NODE_ENV === 'production' && !process.env.DB_PASSWORD) {
    throw new Error('CRITICAL SECURITY VIOLATION: DB_PASSWORD must be explicitly provided in production environment!');
}

export const pool = new Pool({
    host: process.env.DB_HOST || 'db',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'root',
    database: rrhDbName,
    min: Number(process.env.DB_POOL_MIN || 5), // Keep 5 warm connections active for 0ms acquisition
    max: Number(process.env.DB_POOL_MAX || 50), // Sized for 7 parallel factory lines under shift rushes
    idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30000),
    connectionTimeoutMillis: Number(process.env.DB_CONN_TIMEOUT_MS || 5000),
    statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 15000),
});

pool.on('connect', () => {
    logger.info(`Connected to dedicated RRH PostgreSQL database: ${rrhDbName}`);
});

pool.on('error', (err) => {
    // Log the error but do NOT crash the process. The pg pool automatically
    // recovers from transient idle-client errors by creating new connections.
    logger.error(`Unexpected error on idle pool client (pool will recover): ${err.message}`);
});

export const getClient = () => pool.connect();

/**
 * Safe transaction runner that guarantees automatic BEGIN, COMMIT on success,
 * ROLLBACK on failure, and deterministic client release back to the pool in all cases.
 */
export const withTransaction = async <T>(
    operation: (client: any) => Promise<T>
): Promise<T> => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await operation(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch (rollbackErr: any) {
            logger.error(`Failed to rollback transaction: ${rollbackErr.message}`);
        }
        throw error;
    } finally {
        client.release();
    }
};

/**
 * Safe client runner that guarantees client release in all cases without transactions.
 */
export const withClient = async <T>(
    operation: (client: any) => Promise<T>
): Promise<T> => {
    const client = await pool.connect();
    try {
        return await operation(client);
    } finally {
        client.release();
    }
};

// Bounded LRU Cache with TTL: Guards against memory leaks, stale entries, and process bloating
interface CacheEntry {
    id: number;
    expiresAt: number;
}

class BoundedLruTtlCache {
    private readonly map = new Map<string, CacheEntry>();
    private readonly maxSize: number;
    private readonly ttlMs: number;

    constructor(maxSize = 1000, ttlMs = 10 * 60 * 1000) {
        this.maxSize = maxSize;
        this.ttlMs = ttlMs;
    }

    get(key: string): number | null {
        const entry = this.map.get(key);
        if (!entry) return null;

        if (Date.now() > entry.expiresAt) {
            this.map.delete(key);
            return null;
        }

        // Refresh LRU order (delete and re-insert)
        this.map.delete(key);
        this.map.set(key, entry);
        return entry.id;
    }

    set(key: string, id: number): void {
        if (this.map.has(key)) {
            this.map.delete(key);
        } else if (this.map.size >= this.maxSize) {
            // Evict oldest (first key in iteration)
            const oldestKey = this.map.keys().next().value;
            if (oldestKey) this.map.delete(oldestKey);
        }

        this.map.set(key, {
            id,
            expiresAt: Date.now() + this.ttlMs
        });
    }

    delete(key: string): void {
        this.map.delete(key);
    }

    clear(): void {
        this.map.clear();
    }

    get size(): number {
        return this.map.size;
    }
}

const woIdCache = new BoundedLruTtlCache(1000, 10 * 60 * 1000);

export const getCachedWorkOrderInternalId = async (
    clientOrPool: { query: (sql: string, params?: any[]) => Promise<any> },
    workOrderId: string | null | undefined
): Promise<number | null> => {
    if (!workOrderId) return null;
    const clean = String(workOrderId).trim();
    if (!clean) return null;

    const canonicalKey = clean.toUpperCase();
    const cached = woIdCache.get(canonicalKey);
    if (cached !== null) {
        return cached;
    }

    try {
        const res = await clientOrPool.query(
            'SELECT id FROM rrh_work_orders WHERE UPPER(TRIM(work_order_id)) = UPPER(TRIM($1)) LIMIT 1',
            [clean]
        );
        if (res.rows.length > 0) {
            const internalId = Number(res.rows[0].id);
            woIdCache.set(canonicalKey, internalId);
            return internalId;
        }
    } catch (err: any) {
        logger.warn(`Failed to resolve work_order_internal_id for '${clean}': ${err.message}`);
    }
    return null;
};

export const invalidateWorkOrderCache = (workOrderId?: string) => {
    const payload = workOrderId ? String(workOrderId).trim() : '*';
    if (workOrderId) {
        woIdCache.delete(payload);
        woIdCache.delete(payload.toUpperCase());
        woIdCache.delete(payload.toLowerCase());
    } else {
        woIdCache.clear();
    }
    // Broadcast cache invalidation across all multi-replica containers in the cluster
    pool.query(`NOTIFY rrh_cache_invalidation, '${payload}'`).catch(err => {
        logger.warn(`Failed to broadcast cluster cache invalidation: ${err.message}`);
    });
};

// Background subscriber: keeps all container replicas synchronized in real time
let subPool: Pool | null = null;
export const startClusterCacheSync = async () => {
    try {
        subPool = new Pool({
            host: process.env.DB_HOST || 'db',
            port: Number(process.env.DB_PORT || 5432),
            user: process.env.DB_USER || 'postgres',
            password: process.env.DB_PASSWORD || 'root',
            database: rrhDbName,
            max: 1,
            idleTimeoutMillis: 0,
        });

        const client = await subPool.connect();
        await client.query('LISTEN rrh_cache_invalidation');
        logger.info('Active PostgreSQL LISTEN subscription for cluster cache sync established');

        client.on('notification', (msg) => {
            if (msg.channel === 'rrh_cache_invalidation') {
                const target = msg.payload?.trim();
                if (!target || target === '*') {
                    woIdCache.clear();
                    logger.info('[ClusterCacheSync] Flushed all cached work orders via cluster broadcast');
                } else {
                    woIdCache.delete(target);
                    woIdCache.delete(target.toUpperCase());
                    woIdCache.delete(target.toLowerCase());
                    logger.info(`[ClusterCacheSync] Evicted work order '${target}' via cluster broadcast`);
                }
            }
        });

        client.on('error', (err) => {
            logger.warn(`[ClusterCacheSync] Listener error (will recover): ${err.message}`);
        });
    } catch (err: any) {
        logger.warn(`[ClusterCacheSync] Failed to initialize cluster cache sync: ${err.message}`);
    }
};

export const stopClusterCacheSync = async (): Promise<void> => {
    if (subPool) {
        try {
            await subPool.end();
            logger.info('Closed PostgreSQL LISTEN cluster cache sync subscriber connection pool.');
        } catch (err: any) {
            logger.warn(`Error closing cluster cache subscriber pool: ${err.message}`);
        }
        subPool = null;
    }
};

export const getPoolDiagnostics = () => ({
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
    cachedWorkOrders: woIdCache.size,
});

