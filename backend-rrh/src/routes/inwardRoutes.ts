import { Router } from 'express';
import { 
    createInwardSession, 
    getInwardSessions, 
    getSessionById, 
    updateSessionStatus,
    checkBottom
} from '../controllers/inwardController';
import {
    getSessionStats,
    scanBarcode,
    assignUnit,
    getRemainingMasterData,
    failScan,
    editScan,
    deleteSession
} from '../controllers/inwardScanController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// Work order checks
router.get('/work-orders/:woId/check-bottom', checkBottom);

// Session management (authenticated)
router.post('/sessions', authMiddleware, createInwardSession);
router.get('/sessions', authMiddleware, getInwardSessions);
router.get('/sessions/:id', authMiddleware, getSessionById);
router.patch('/sessions/:id/status', authMiddleware, updateSessionStatus);
router.delete('/sessions/:id', authMiddleware, deleteSession);

// Session stats & scanning & remaining master data (authenticated)
router.get('/sessions/:id/stats', authMiddleware, getSessionStats);
router.post('/sessions/:id/scan', authMiddleware, scanBarcode);
router.post('/sessions/:id/assign', authMiddleware, assignUnit);
router.get('/sessions/:id/remaining-master-data', authMiddleware, getRemainingMasterData);
router.post('/sessions/:id/scan/:scanId/fail', authMiddleware, failScan);
router.put('/sessions/:id/scan/:scanId', authMiddleware, editScan);

export default router;
