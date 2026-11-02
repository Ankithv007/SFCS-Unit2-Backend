import { Router, Request, Response, NextFunction } from 'express';
import multer, { FileFilterCallback } from 'multer';
import path from 'path';
import fs from 'fs';
import { getUploadsDir } from '../utils/uploads';
import { authMiddleware } from '../middleware/auth';
import {
    createIviSession,
    getIviSessions,
    getIviSessionById,
    updateIviSessionStatus,
    deleteIviSession,
    lookupSerialDetails,
    submitInspection,
    getRecentInspections,
    getScrapInspections,
    exportIviExcel,
    getRemainingInwardMasterData,
    viewInspectionPhotos,
    downloadInspectionPhoto,
    getEligibleIviWorkOrders,
    passToNextStage,
    addInspectionImages
} from '../controllers/iviController';

const router = Router();

// Multer storage for IVI inspection photos (saved strictly in uploads/rrh/ivi, max 600KB each)
const storage = multer.diskStorage({
    destination: (_req: Request, _file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) => {
        const dest = path.join(getUploadsDir(), 'rrh', 'ivi');
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }
        cb(null, dest);
    },
    filename: (_req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, `IVI_${uniqueSuffix}${path.extname(file.originalname)}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // Max 10MB per file
    fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
        const allowedTypes = /jpeg|jpg|png|webp/;
        const ext = path.extname(file.originalname).toLowerCase();
        const mime = file.mimetype.toLowerCase();
        if (allowedTypes.test(ext) || allowedTypes.test(mime)) {
            cb(null, true);
        } else {
            cb(new Error('Only image files (.jpg, .jpeg, .png, .webp) are allowed.'));
        }
    }
});

// Inspection photo viewer & direct download (public for Excel exports & browser access)
router.get('/inspections/:id/photos', viewInspectionPhotos as (req: Request, res: Response) => void);
router.get('/photos/download/*', downloadInspectionPhoto as (req: Request, res: Response) => void);
router.get('/photos/download/:filename', downloadInspectionPhoto as (req: Request, res: Response) => void);

// Serial lookup (authenticated)
router.get('/lookup', authMiddleware, lookupSerialDetails as (req: Request, res: Response) => void);

// Eligible work orders for IVI (excluding active & completed IVI sessions)
router.get('/eligible-work-orders', authMiddleware, getEligibleIviWorkOrders as (req: Request, res: Response) => void);

// Session management (authenticated)
router.post('/sessions', authMiddleware, createIviSession as (req: Request, res: Response) => void);
router.get('/sessions', authMiddleware, getIviSessions as (req: Request, res: Response) => void);
router.get('/sessions/:id', authMiddleware, getIviSessionById as (req: Request, res: Response) => void);
router.patch('/sessions/:id/status', authMiddleware, updateIviSessionStatus as (req: Request, res: Response) => void);
router.delete('/sessions/:id', authMiddleware, deleteIviSession as (req: Request, res: Response) => void);

// Inspection submission & listing & export (authenticated)
router.patch('/inspections/:id/pass-to-next-stage', authMiddleware, passToNextStage as (req: Request, res: Response) => void);
router.post('/inspections/:id/images', authMiddleware, upload.array('images', 6), addInspectionImages as (req: Request, res: Response) => void);
router.get('/sessions/:id/remaining-master-data', authMiddleware, getRemainingInwardMasterData as (req: Request, res: Response) => void);
router.post('/sessions/:id/inspections', authMiddleware, upload.array('images', 6), submitInspection as (req: Request, res: Response) => void);
router.get('/sessions/:id/inspections', authMiddleware, getRecentInspections as (req: Request, res: Response) => void);
router.get('/sessions/:id/scrap-inspections', authMiddleware, getScrapInspections as (req: Request, res: Response) => void);
router.get('/sessions/:id/export', authMiddleware, exportIviExcel as (req: Request, res: Response) => void);

export default router;
