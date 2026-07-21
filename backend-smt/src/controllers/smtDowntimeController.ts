import { Request, Response } from 'express';
import { createLogger } from '../utils/logger';
import { SmtDowntimeService, GetRecordsQueryOptions } from '../services/smtDowntimeService';

const logger = createLogger('SMT_DOWNTIME_CONTROLLER');

const getSessionUser = (req: Request) => {
    const user = (req as any).user;
    const headerName = req.headers['x-user-name'];
    const decodedName = headerName ? decodeURIComponent(headerName as string) : null;
    return {
        id: user?.id || user?.userId || null,
        name: decodedName || user?.name || user?.email || 'Unknown User',
        role: user?.role || 'OPERATOR',
        email: user?.email || 'unknown@example.com'
    };
};

export const createDowntimeRecord = async (req: Request, res: Response) => {
    const sessionUser = getSessionUser(req);
    const {
        shift,
        line,
        machine_name,
        start_time,
        end_time,
        downtime_category,
        downtime_description,
        action_taken,
        responsible_person,
        status,
        remarks
    } = req.body;

    if (!shift || !line || !machine_name || !start_time || !end_time || !downtime_category || !downtime_description || !action_taken || !responsible_person || !status) {
        return res.status(400).json({ success: false, message: 'All marked fields are required.' });
    }

    try {
        const record = await SmtDowntimeService.createDowntimeRecord({
            shift,
            line,
            machine_name,
            start_time,
            end_time,
            downtime_category,
            downtime_description,
            action_taken,
            responsible_person,
            status,
            remarks
        }, sessionUser);

        logger.info(`Downtime record created: ${record.id} by ${sessionUser.name}`);
        return res.status(201).json({ success: true, data: record });
    } catch (err: any) {
        logger.error(`Error creating downtime record: ${err.message}`);
        return res.status(400).json({ success: false, message: err.message || 'Internal Server Error' });
    }
};

export const getDowntimeRecords = async (req: Request, res: Response) => {
    const options: GetRecordsQueryOptions = {
        page: parseInt(req.query.page as string, 10) || 1,
        limit: parseInt(req.query.limit as string, 10) || 10,
        search: req.query.search as string,
        sortBy: req.query.sortBy as string,
        sortOrder: (req.query.sortOrder as string)?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC'
    };

    try {
        const result = await SmtDowntimeService.getDowntimeRecords(options);
        return res.status(200).json({
            success: true,
            data: result.data,
            pagination: result.pagination
        });
    } catch (err: any) {
        logger.error(`Error fetching downtime records: ${err.message}`);
        return res.status(500).json({ success: false, message: err.message || 'Internal Server Error' });
    }
};

export const updateDowntimeRecord = async (req: Request, res: Response) => {
    const { id } = req.params;
    const sessionUser = getSessionUser(req);
    const {
        shift,
        line,
        machine_name,
        start_time,
        end_time,
        downtime_category,
        downtime_description,
        action_taken,
        responsible_person,
        status,
        remarks
    } = req.body;

    if (!shift || !line || !machine_name || !start_time || !end_time || !downtime_category || !downtime_description || !action_taken || !responsible_person || !status) {
        return res.status(400).json({ success: false, message: 'All marked fields are required.' });
    }

    try {
        const updatedRecord = await SmtDowntimeService.updateDowntimeRecord(id, {
            shift,
            line,
            machine_name,
            start_time,
            end_time,
            downtime_category,
            downtime_description,
            action_taken,
            responsible_person,
            status,
            remarks
        }, sessionUser);

        if (!updatedRecord) {
            return res.status(404).json({ success: false, message: 'Downtime record not found.' });
        }

        logger.info(`Downtime record updated: ${updatedRecord.id} by ${sessionUser.name}`);
        return res.status(200).json({ success: true, data: updatedRecord });
    } catch (err: any) {
        logger.error(`Error updating downtime record: ${err.message}`);
        return res.status(400).json({ success: false, message: err.message || 'Internal Server Error' });
    }
};

export const deleteDowntimeRecord = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const deleted = await SmtDowntimeService.deleteDowntimeRecord(id);
        if (!deleted) {
            return res.status(404).json({ success: false, message: 'Downtime record not found.' });
        }

        logger.info(`Downtime record deleted: ${id}`);
        return res.status(200).json({ success: true, message: 'Record deleted successfully.' });
    } catch (err: any) {
        logger.error(`Error deleting downtime record: ${err.message}`);
        return res.status(500).json({ success: false, message: err.message || 'Internal Server Error' });
    }
};

export const getDowntimeDashboard = async (req: Request, res: Response) => {
    try {
        const dashboardData = await SmtDowntimeService.getDowntimeDashboard();
        return res.status(200).json({
            success: true,
            data: dashboardData
        });
    } catch (err: any) {
        logger.error(`Error getting downtime dashboard: ${err.message}`);
        return res.status(500).json({ success: false, message: err.message || 'Internal Server Error' });
    }
};
