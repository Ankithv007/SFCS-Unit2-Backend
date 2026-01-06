import express from 'express';
import { startSession, scanPcb, getSessions, getSessionScans } from '../controllers/impedanceController';

const router = express.Router();

router.post('/sessions', startSession);
router.get('/sessions', getSessions);
router.post('/scan', scanPcb);
router.get('/sessions/:session_id/scans', getSessionScans);

export default router;
