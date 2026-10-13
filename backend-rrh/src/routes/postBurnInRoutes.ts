import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
    getEligiblePostBurnInWorkOrders,
    getWorkOrderHipotDetails,
    createPostBurnInSession,
    getPostBurnInSessions,
    getPostBurnInSessionById,
    updatePostBurnInSessionStatus,
    deletePostBurnInSession,
    getRemainingHipotMasterData,
    lookupSerialDetails,
    submitInspection,
    getScannedInspections,
    getFailedInspections,
    getDebugInspections,
    updateDebugAction,
    exportPostBurnInExcel,
    exportUnscannedExcel,
    exportDebugExcel
} from '../controllers/postBurnInController';

const router = Router();

// Eligible work orders for Post Burn In
router.get('/eligible-work-orders', authMiddleware, getEligiblePostBurnInWorkOrders as (req: Request, res: Response) => void);
router.get('/work-orders/:woId/hipot-details', authMiddleware, getWorkOrderHipotDetails as (req: Request, res: Response) => void);

// Serial lookup for Post Burn In inspection (authenticated)
router.get('/lookup', authMiddleware, lookupSerialDetails as (req: Request, res: Response) => void);

// Session management
router.post('/sessions', authMiddleware, createPostBurnInSession as (req: Request, res: Response) => void);
router.get('/sessions', authMiddleware, getPostBurnInSessions as (req: Request, res: Response) => void);
router.get('/sessions/:id', authMiddleware, getPostBurnInSessionById as (req: Request, res: Response) => void);
router.patch('/sessions/:id/status', authMiddleware, updatePostBurnInSessionStatus as (req: Request, res: Response) => void);
router.delete('/sessions/:id', authMiddleware, deletePostBurnInSession as (req: Request, res: Response) => void);

// Inspection submission & logs & export
router.get('/sessions/:id/remaining-master-data', authMiddleware, getRemainingHipotMasterData as (req: Request, res: Response) => void);
router.post('/sessions/:id/inspections', authMiddleware, submitInspection as (req: Request, res: Response) => void);
router.get('/sessions/:id/inspections', authMiddleware, getScannedInspections as (req: Request, res: Response) => void);
router.get('/sessions/:id/failed-inspections', authMiddleware, getFailedInspections as (req: Request, res: Response) => void);
router.get('/sessions/:id/debug-inspections', authMiddleware, getDebugInspections as (req: Request, res: Response) => void);
router.patch('/inspections/:id/debug-action', authMiddleware, updateDebugAction as (req: Request, res: Response) => void);
router.get('/sessions/:id/export', authMiddleware, exportPostBurnInExcel as (req: Request, res: Response) => void);
router.get('/sessions/:id/export-unscanned', authMiddleware, exportUnscannedExcel as (req: Request, res: Response) => void);
router.get('/sessions/:id/export-debug', authMiddleware, exportDebugExcel as (req: Request, res: Response) => void);

export default router;
