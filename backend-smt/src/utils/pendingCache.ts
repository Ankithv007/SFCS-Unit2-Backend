import { createLogger } from './logger';

const logger = createLogger('PendingCache');

interface CacheEntry<T> {
    data: T;
    expiresAt: number;
}

const cache = new Map<string, CacheEntry<any>>();

// Clean up expired items periodically (every 60s)
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of cache.entries()) {
        if (entry.expiresAt <= now) {
            cache.delete(key);
        }
    }
}, 60000).unref?.();

/**
 * Get item from cache if not expired
 */
export function getPendingCache<T>(key: string): T | null {
    const entry = cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
        cache.delete(key);
        return null;
    }
    return entry.data;
}

/**
 * Set item in cache with TTL in milliseconds (default 10 seconds)
 */
export function setPendingCache<T>(key: string, data: T, ttlMs = 10000): void {
    cache.set(key, {
        data,
        expiresAt: Date.now() + ttlMs
    });
}

/**
 * Invalidate cache entries for a work order or all SMT pending caches
 */
export function invalidatePendingCache(workOrderId?: string): void {
    if (!workOrderId) {
        cache.clear();
        logger.info('Cleared all SMT pending stage caches.');
        return;
    }

    const cleanWo = workOrderId.trim().toUpperCase();
    let count = 0;
    for (const key of cache.keys()) {
        if (key.includes(`:${cleanWo}:`) || key.endsWith(`:${cleanWo}`)) {
            cache.delete(key);
            count++;
        }
    }
    if (count > 0) {
        logger.info(`Invalidated ${count} cache entries for WO ${cleanWo}`);
    }
}
