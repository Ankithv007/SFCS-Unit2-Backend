import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger';

const logger = createLogger('ScannerGuard');

interface RateBucket {
    count: number;
    resetTime: number;
}

// In-memory sliding window rate limiter per client IP
const ipBuckets = new Map<string, RateBucket>();

// Periodic garbage collection of inactive client buckets every 60s
setInterval(() => {
    const now = Date.now();
    for (const [ip, bucket] of ipBuckets.entries()) {
        if (now > bucket.resetTime) {
            ipBuckets.delete(ip);
        }
    }
}, 60000).unref(); // .unref() so this timer does not prevent process exit

/**
 * Scanner Rate Guardrail
 * Allows up to 60 scans per 10 seconds (6 scans/second) per IP/terminal.
 * Blocks jammed hardware scanners, bouncing laser triggers, and infinite loops.
 */
export const scannerRateLimiter = (maxRequests = 60, windowMs = 10000) => {
    return (req: Request, res: Response, next: NextFunction) => {
        const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';
        const now = Date.now();

        let bucket = ipBuckets.get(clientIp);
        if (!bucket || now > bucket.resetTime) {
            bucket = {
                count: 1,
                resetTime: now + windowMs
            };
            ipBuckets.set(clientIp, bucket);
            return next();
        }

        bucket.count++;

        if (bucket.count > maxRequests) {
            const retryAfterSec = Math.ceil((bucket.resetTime - now) / 1000);
            logger.warn(`Hardware scanner rate limit triggered for terminal ${clientIp} (${bucket.count} req in window). Throttling.`);
            res.setHeader('Retry-After', retryAfterSec);
            return res.status(429).json({
                success: false,
                message: 'Hardware scanner rate limit exceeded. Please release scanner trigger or slow down scan frequency.',
                retryAfterSeconds: retryAfterSec
            });
        }

        return next();
    };
};
