import { Router, Request, Response } from 'express';
import { authMiddleware } from '../../middleware/auth';
import {
    getEligiblePreBurnInWorkOrders,
    getWorkOrderProgrammingDetails,
    createPreBurnInSession,
    getPreBurnInSessions,
    getPreBurnInSessionById,
    updatePreBurnInSessionStatus,
    deletePreBurnInSession,
    getRemainingProgrammingMasterData,
    lookupSerialDetails,
    submitInspection,
    getScannedInspections,
    getFailedInspections,
    getDebugInspections,
    updateDebugAction,
    exportPreBurnInExcel,
    exportUnscannedExcel,
    exportDebugExcel
} from '../../controllers/ecn/ecnPreBurnInController';

const router = Router();

router.get('/eligible-work-orders', authMiddleware, getEligiblePreBurnInWorkOrders as (req: Request, res: Response) => void);
router.get('/work-orders/:woId/programming-details', authMiddleware, getWorkOrderProgrammingDetails as (req: Request, res: Response) => void);
router.get('/lookup', authMiddleware, lookupSerialDetails as (req: Request, res: Response) => void);

router.post('/sessions', authMiddleware, createPreBurnInSession as (req: Request, res: Response) => void);
router.get('/sessions', authMiddleware, getPreBurnInSessions as (req: Request, res: Response) => void);
router.get('/sessions/:id', authMiddleware, getPreBurnInSessionById as (req: Request, res: Response) => void);
router.patch('/sessions/:id/status', authMiddleware, updatePreBurnInSessionStatus as (req: Request, res: Response) => void);
router.delete('/sessions/:id', authMiddleware, deletePreBurnInSession as (req: Request, res: Response) => void);

router.get('/sessions/:id/remaining-master-data', authMiddleware, getRemainingProgrammingMasterData as (req: Request, res: Response) => void);
router.post('/sessions/:id/inspections', authMiddleware, submitInspection as (req: Request, res: Response) => void);
router.get('/sessions/:id/inspections', authMiddleware, getScannedInspections as (req: Request, res: Response) => void);
router.get('/sessions/:id/failed-inspections', authMiddleware, getFailedInspections as (req: Request, res: Response) => void);
router.get('/sessions/:id/debug-inspections', authMiddleware, getDebugInspections as (req: Request, res: Response) => void);
router.patch('/inspections/:id/debug-action', authMiddleware, updateDebugAction as (req: Request, res: Response) => void);
router.get('/sessions/:id/export', authMiddleware, exportPreBurnInExcel as (req: Request, res: Response) => void);
router.get('/sessions/:id/export-unscanned', authMiddleware, exportUnscannedExcel as (req: Request, res: Response) => void);
router.get('/sessions/:id/export-debug', authMiddleware, exportDebugExcel as (req: Request, res: Response) => void);

export default router;
