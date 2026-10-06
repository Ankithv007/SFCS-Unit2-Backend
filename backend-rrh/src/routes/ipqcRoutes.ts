import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
    getEligibleIpqcWorkOrders,
    getWorkOrderIviDetails,
    createIpqcSession,
    getIpqcSessions,
    getIpqcSessionById,
    updateIpqcSessionStatus,
    deleteIpqcSession,
    getRemainingIviMasterData,
    lookupSerialDetails,
    submitInspection,
    getScannedInspections,
    getFailedInspections,
    exportIpqcExcel,
    exportUnscannedExcel
} from '../controllers/ipqcController';

const router = Router();

// Eligible work orders for IPQC
router.get('/eligible-work-orders', authMiddleware, getEligibleIpqcWorkOrders as (req: Request, res: Response) => void);
router.get('/work-orders/:woId/ivi-details', authMiddleware, getWorkOrderIviDetails as (req: Request, res: Response) => void);

// Serial lookup for IPQC inspection (authenticated)
router.get('/lookup', authMiddleware, lookupSerialDetails as (req: Request, res: Response) => void);

// Session management
router.post('/sessions', authMiddleware, createIpqcSession as (req: Request, res: Response) => void);
router.get('/sessions', authMiddleware, getIpqcSessions as (req: Request, res: Response) => void);
router.get('/sessions/:id', authMiddleware, getIpqcSessionById as (req: Request, res: Response) => void);
router.patch('/sessions/:id/status', authMiddleware, updateIpqcSessionStatus as (req: Request, res: Response) => void);
router.delete('/sessions/:id', authMiddleware, deleteIpqcSession as (req: Request, res: Response) => void);

// Inspection submission & logs & export
router.get('/sessions/:id/remaining-master-data', authMiddleware, getRemainingIviMasterData as (req: Request, res: Response) => void);
router.post('/sessions/:id/inspections', authMiddleware, submitInspection as (req: Request, res: Response) => void);
router.get('/sessions/:id/inspections', authMiddleware, getScannedInspections as (req: Request, res: Response) => void);
router.get('/sessions/:id/failed-inspections', authMiddleware, getFailedInspections as (req: Request, res: Response) => void);
router.get('/sessions/:id/export', authMiddleware, exportIpqcExcel as (req: Request, res: Response) => void);
router.get('/sessions/:id/export-unscanned', authMiddleware, exportUnscannedExcel as (req: Request, res: Response) => void);

export default router;
