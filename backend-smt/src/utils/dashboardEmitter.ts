import { EventEmitter } from 'events';
import { createLogger } from './logger';

const logger = createLogger('DASHBOARD_EMITTER');

class SmtDashboardEventEmitter extends EventEmitter {
    constructor() {
        super();
        // Allow adequate listeners for multiple dashboard sessions
        this.setMaxListeners(100);
    }
}

export const dashboardEvents = new SmtDashboardEventEmitter();

/**
 * Notifies all connected dashboard subscribers that an authoritative
 * SMT production state change (PASS, genuine FAIL, or Repair) occurred for a Work Order.
 * 
 * Note: Must only be called after the database transaction has successfully committed.
 * Invalid scans and technical errors must NEVER call this function.
 */
import { invalidatePendingCache } from './pendingCache';

export const notifySmtDashboardUpdate = (workOrderId: string) => {
    if (!workOrderId) return;
    try {
        // Automatically invalidate pending cache for this Work Order
        invalidatePendingCache(workOrderId);

        logger.info(`Emitting SMT dashboard update for Work Order: ${workOrderId}`);
        dashboardEvents.emit('smt-dashboard-update', {
            event: 'SMT_DASHBOARD_UPDATE',
            type: 'SMT_DASHBOARD_UPDATE',
            workOrderId,
            data: { workOrderId },
            timestamp: new Date().toISOString()
        });
    } catch (err: any) {
        logger.error(`Failed to emit dashboard update: ${err.message}`);
    }
};
