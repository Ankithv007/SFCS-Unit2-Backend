import { Request, Response } from 'express';
import { AuditService } from '../services/audit/AuditService';
import { determineScannedBy } from '../utils/scanUser';

export const deleteScan = async (req: Request, res: Response) => {
    const userRole = (req as any).user?.role;
    const lowerRole = (userRole || '').toString().toLowerCase().replace(/\s/g, '');
    if (lowerRole !== 'admin' && lowerRole !== 'superadmin') {
        return res.status(403).json({ error: 'You do not have permission to delete this record.' });
    }
    const scanId = req.params.scanId || req.params.scan_id;
    const actor = determineScannedBy((req as any).user) || 'system';
    try {
        await AuditService.deleteScanById(scanId, actor);
        return res.status(200).json({ message: 'Record deleted successfully.' });
    } catch (err: any) {
        if (err.message && err.message.includes('not found')) {
            return res.status(404).json({ error: 'Scan not found' });
        }
        return res.status(500).json({ error: err.message || 'Failed to delete scan' });
    }
};

export default { deleteScan };
