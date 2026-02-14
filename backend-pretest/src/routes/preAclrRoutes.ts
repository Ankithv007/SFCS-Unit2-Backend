import { Router } from 'express';
import * as preAclrController from '../controllers/preAclrController';

const router = Router();

router.get('/test-cases', preAclrController.getTestCaseMaster);
router.get('/summary', preAclrController.getRecentSummary);
router.get('/verify-barcode', preAclrController.verifyBarcode);
router.post('/scan', preAclrController.scanBarcode);
router.get('/scans', preAclrController.getCompletedScans);
router.post('/reset-session', preAclrController.resetSession);
router.get('/download', preAclrController.downloadExcel);

export default router;
