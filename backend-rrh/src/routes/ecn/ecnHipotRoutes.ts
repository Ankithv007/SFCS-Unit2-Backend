import { Router, Request, Response } from 'express';
import { authMiddleware } from '../../middleware/auth';
import {
    getEligibleHipotWorkOrders,
    getWorkOrderPreBurnInDetails,
    createHipotSession,
    getHipotSessions,
    getHipotSessionById,
    updateHipotSessionStatus,
    deleteHipotSession,
    getRemainingPreBurnInMasterData,
    lookupSerialDetails,
    submitInspection,
    getScannedInspections,
    getFailedInspections,
    getDebugInspections,
    updateDebugAction,
    exportHipotExcel,
    exportUnscannedExcel,
    exportDebugExcel
} from '../../controllers/ecn/ecnHipotController';

const router = Router();

router.get('/eligible-work-orders', authMiddleware, getEligibleHipotWorkOrders as (req: Request, res: Response) => void);
router.get('/work-orders/:woId/pre-burn-in-details', authMiddleware, getWorkOrderPreBurnInDetails as (req: Request, res: Response) => void);
router.get('/lookup', authMiddleware, lookupSerialDetails as (req: Request, res: Response) => void);

router.post('/sessions', authMiddleware, createHipotSession as (req: Request, res: Response) => void);
router.get('/sessions', authMiddleware, getHipotSessions as (req: Request, res: Response) => void);
router.get('/sessions/:id', authMiddleware, getHipotSessionById as (req: Request, res: Response) => void);
router.patch('/sessions/:id/status', authMiddleware, updateHipotSessionStatus as (req: Request, res: Response) => void);
router.delete('/sessions/:id', authMiddleware, deleteHipotSession as (req: Request, res: Response) => void);

router.get('/sessions/:id/remaining-master-data', authMiddleware, getRemainingPreBurnInMasterData as (req: Request, res: Response) => void);
router.post('/sessions/:id/inspections', authMiddleware, submitInspection as (req: Request, res: Response) => void);
router.get('/sessions/:id/inspections', authMiddleware, getScannedInspections as (req: Request, res: Response) => void);
router.get('/sessions/:id/failed-inspections', authMiddleware, getFailedInspections as (req: Request, res: Response) => void);
router.get('/sessions/:id/debug-inspections', authMiddleware, getDebugInspections as (req: Request, res: Response) => void);
router.patch('/inspections/:id/debug-action', authMiddleware, updateDebugAction as (req: Request, res: Response) => void);
router.get('/sessions/:id/export', authMiddleware, exportHipotExcel as (req: Request, res: Response) => void);
router.get('/sessions/:id/export-unscanned', authMiddleware, exportUnscannedExcel as (req: Request, res: Response) => void);
router.get('/sessions/:id/export-debug', authMiddleware, exportDebugExcel as (req: Request, res: Response) => void);

export default router;
