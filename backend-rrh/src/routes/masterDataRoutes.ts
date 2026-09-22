import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { getUploadsDir } from '../utils/uploads';
import {
    previewMasterData,
    confirmMasterData,
    getWorkOrders,
    getWorkOrderById,
    createWorkOrder,
    deleteTempFile,
    downloadWorkOrderExcel,
    deleteWorkOrder
} from '../controllers/masterDataController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// Ensure uploads/rrh/temp directory is configured for multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dest = path.join(getUploadsDir(), 'rrh', 'temp');
        cb(null, dest);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, `TEMP_RRH_${uniqueSuffix}${path.extname(file.originalname)}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext === '.xlsx' || ext === '.xls' || file.mimetype.includes('spreadsheet') || file.mimetype.includes('excel')) {
            cb(null, true);
        } else {
            cb(new Error('Only Excel workbooks (.xlsx, .xls) are permitted.'));
        }
    }
});

// RRH Work Order & Master Data Routes
router.get('/work-orders', authMiddleware, getWorkOrders);
router.post('/work-orders', authMiddleware, upload.single('file'), createWorkOrder);
router.get('/work-orders/:id', authMiddleware, getWorkOrderById);
router.get('/work-orders/:id/download', authMiddleware, downloadWorkOrderExcel);
router.delete('/work-orders/:id', authMiddleware, deleteWorkOrder);

// Master Excel Staging, Preview & Confirmation
router.post('/work-orders/parse-excel', authMiddleware, upload.single('file'), previewMasterData);
router.post('/work-orders/:id/master/preview', authMiddleware, upload.single('file'), previewMasterData);
router.post('/work-orders/:id/master/confirm', authMiddleware, confirmMasterData);
router.delete('/work-orders/temp-file/:fileName', authMiddleware, deleteTempFile);

export default router;
