import express from 'express';
import multer from 'multer';
import path from 'path';
import {
    parseExcelPreview,
    createRrhWorkOrder,
    getRrhWorkOrders,
    getRrhWorkOrderById,
    downloadRrhExcel,
    deleteRrhWorkOrder
} from '../controllers/rrhController';
import { authenticateToken, requirePermission } from '../middleware/authMiddleware';

const router = express.Router();

// Multer memory storage (50MB)
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext === '.xlsx' || ext === '.xls') {
            cb(null, true);
        } else {
            cb(new Error('Only Excel workbooks (.xlsx, .xls) are allowed.'));
        }
    }
});

const canView = [authenticateToken, requirePermission('rrh_work_order', 'can_view')];
const canCreate = [authenticateToken, requirePermission('rrh_work_order', 'can_create')];
const canDelete = [authenticateToken, requirePermission('rrh_work_order', 'can_delete')];

// RRH Work Order Routes
router.post('/work-orders/parse-excel', authenticateToken, upload.single('file'), parseExcelPreview);
router.post('/work-orders', canCreate, upload.single('file'), createRrhWorkOrder);
router.get('/work-orders', canView, getRrhWorkOrders);
router.get('/work-orders/:id', canView, getRrhWorkOrderById);
router.get('/work-orders/:id/download', canView, downloadRrhExcel);
router.delete('/work-orders/:id', canDelete, deleteRrhWorkOrder);

export default router;
