import { Router, Request, Response } from 'express';
import { authMiddleware } from '../../middleware/auth';
import {
    getEligibleProgrammingWorkOrders,
    getWorkOrderIpqcDetails,
    createProgrammingSession,
    getProgrammingSessions,
    getProgrammingSessionById,
    updateProgrammingSessionStatus,
    deleteProgrammingSession,
    getRemainingIpqcMasterData,
    lookupSerialDetails,
    submitInspection,
    getScannedInspections,
    getFailedInspections,
    getDebugInspections,
    updateDebugAction,
    exportProgrammingExcel,
    exportUnscannedExcel,
    exportDebugExcel
} from '../../controllers/nonEcn/nonEcnProgrammingController';

const router = Router();

router.get('/eligible-work-orders', authMiddleware, getEligibleProgrammingWorkOrders as (req: Request, res: Response) => void);
router.get('/work-orders/:woId/ipqc-details', authMiddleware, getWorkOrderIpqcDetails as (req: Request, res: Response) => void);
router.get('/work-orders/:woId/initial-pbi-details', authMiddleware, getWorkOrderIpqcDetails as (req: Request, res: Response) => void);
router.get('/lookup', authMiddleware, lookupSerialDetails as (req: Request, res: Response) => void);

router.post('/sessions', authMiddleware, createProgrammingSession as (req: Request, res: Response) => void);
router.get('/sessions', authMiddleware, getProgrammingSessions as (req: Request, res: Response) => void);
router.get('/sessions/:id', authMiddleware, getProgrammingSessionById as (req: Request, res: Response) => void);
router.patch('/sessions/:id/status', authMiddleware, updateProgrammingSessionStatus as (req: Request, res: Response) => void);
router.delete('/sessions/:id', authMiddleware, deleteProgrammingSession as (req: Request, res: Response) => void);

router.get('/sessions/:id/remaining-master-data', authMiddleware, getRemainingIpqcMasterData as (req: Request, res: Response) => void);
router.post('/sessions/:id/inspections', authMiddleware, submitInspection as (req: Request, res: Response) => void);
router.get('/sessions/:id/inspections', authMiddleware, getScannedInspections as (req: Request, res: Response) => void);
router.get('/sessions/:id/failed-inspections', authMiddleware, getFailedInspections as (req: Request, res: Response) => void);
router.get('/sessions/:id/debug-inspections', authMiddleware, getDebugInspections as (req: Request, res: Response) => void);
router.patch('/inspections/:id/debug-action', authMiddleware, updateDebugAction as (req: Request, res: Response) => void);
router.get('/sessions/:id/export', authMiddleware, exportProgrammingExcel as (req: Request, res: Response) => void);
router.get('/sessions/:id/export-unscanned', authMiddleware, exportUnscannedExcel as (req: Request, res: Response) => void);
router.get('/sessions/:id/export-debug', authMiddleware, exportDebugExcel as (req: Request, res: Response) => void);

export default router;
