import { Pool, PoolClient } from 'pg';
import { pool } from '../config/db';
import { createLogger } from '../utils/logger';

const logger = createLogger('AUDIT');

export interface AuditLogOptions {
    performedBy?: number | null;
    action: string;
    targetType: string;
    targetId?: string | number | null;
    oldValues?: any;
    newValues?: any;
    requestId?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    success?: boolean;
    errorMessage?: string | null;
}

/**
 * Logs an administrative action into the admin_audit_logs database table.
 * Can take a Pool or PoolClient (for transaction context).
 */
export async function logAudit(options: AuditLogOptions, clientOverride?: PoolClient | Pool): Promise<void> {
    const db = clientOverride || pool;
    const {
        performedBy = null,
        action,
        targetType,
        targetId = null,
        oldValues = null,
        newValues = null,
        requestId = null,
        ipAddress = null,
        userAgent = null,
        success = true,
        errorMessage = null
    } = options;

    try {
        await db.query(
            `INSERT INTO admin_audit_logs (
                performed_by, action, target_type, target_id, 
                old_values, new_values, request_id, ip_address, 
                user_agent, success, error_message
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
                performedBy,
                action,
                targetType,
                targetId ? String(targetId) : null,
                oldValues ? JSON.stringify(oldValues) : null,
                newValues ? JSON.stringify(newValues) : null,
                requestId,
                ipAddress,
                userAgent,
                success,
                errorMessage
            ]
        );
    } catch (err: any) {
        logger.error(`Failed to record audit log: ${err.message}`, err);
    }
}
