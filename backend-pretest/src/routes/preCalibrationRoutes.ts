import { Router } from 'express';
import * as preCalibrationController from '../controllers/preCalibrationController';

const router = Router();

router.get('/summary', preCalibrationController.getRecentSummary);
router.post('/scan', preCalibrationController.scanBarcode);
router.get('/scans', preCalibrationController.getCompletedScans);
router.post('/reset-session', preCalibrationController.resetSession);
router.get('/download', preCalibrationController.downloadExcel);
router.get('/verify-barcode', preCalibrationController.verifyBarcode);
router.get('/test-cases', preCalibrationController.getTestCaseMaster);

export default router;
