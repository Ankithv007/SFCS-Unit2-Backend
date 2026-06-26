import express from 'express';
import {
    createWorkOrder,
    updateWorkOrder,
    getWorkOrders,
    getPendingWorkOrders,
    generateSerials,
    getSerials,
    deleteSerials,
    createEmployee,
    getEmployees,
    updateEmployee,
    deleteEmployee,
    toggleEmployeeStatus,
    loginEmployee,
    registerWorkOrder,
    getRegisteredWorkOrders,
    updateSerialNumberStatus,
    createInspection,
    getInspections,
    createProcessSetup,
    getProcessSetups,
    getWorkOrderHistory,
    deleteProcessSetup,
    deleteWorkOrder,
    deleteInspectionsForBatch,
    downloadSmtReport,
    previewPoDocument,
    viewPoDocumentFile,
    downloadPoDocument
} from '../controllers/smtController';
import {
    getSolderPasteStatus,
    getEligibleWorkOrders,
    getDashboardCounts,
    completeStage1,
    startStage2Thawing,
    startStage3Mixing,
    completeStage3Mixing,
    getCompletedBatches
} from '../controllers/solderPasteController';
import {
    getQmsWorkOrders,
    getQmsRecords,
    getBomRevisions,
    getQmsRevisions,
    createQms,
    uploadBomRevision,
    updateQmsFile,
    serveQmsFile,
    deleteQms,
    qmsUpload,
    uploadRateLimiter,
    getBomItems
} from '../controllers/qmsController';
import {
    getEligibleWorkOrders as getMMEligibleWorkOrders,
    createMaterialManagement,
    getMaterialManagementRecords,
    getMaterialManagementDetail,
    getMaterialManagementBom,
    saveMaterialManagementBom,
    updateMaterialManagementStatus,
    syncMaterialManagementBom,
    exportMaterialManagementExcel
} from '../controllers/materialManagementController';
import {
    getEligibleWorkOrders as getMREligibleWorkOrders,
    createMaterialReturn,
    getMaterialReturnRecords,
    getMaterialReturnDetail,
    getMaterialReturnBom,
    saveMaterialReturnBom,
    exportMaterialReturnExcel
} from '../controllers/materialReturnController';
import {
    createStencilRecord,
    updateStencilRecord,
    deleteStencilRecord,
    getStencilRecords,
    exportStencilExcel
} from '../controllers/stencilController';
import {
    getActiveStencils,
    getLifecycleWorkOrders,
    createLifecycleRecord,
    getLifecycleRecords,
    getLifecycleRecordById,
    deleteLifecycleRecord
} from '../controllers/stencilLifecycleController';
import {
    createBakingRecord,
    getBakingRecords,
    getBakingRecordById,
    stopBakingRecord,
    deleteBakingRecord
} from '../controllers/bakingTrackingController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = express.Router();

// Work Orders
router.post('/work-orders', createWorkOrder);
router.put('/work-orders/:id', updateWorkOrder);
router.get('/work-orders', getWorkOrders);
router.get('/workorders/pending', getPendingWorkOrders);
router.post('/work-orders/:id/register', registerWorkOrder);
router.get('/work-orders/registered', getRegisteredWorkOrders);
router.get('/workorder-history', getWorkOrderHistory);
router.delete('/work-orders/:id', authenticateToken, deleteWorkOrder);
router.get('/work-orders/:id/preview-po', previewPoDocument);
router.get('/work-orders/:id/view-po-file', viewPoDocumentFile);
router.get('/work-orders/:id/download-po', downloadPoDocument);

// Serial Numbers
router.post('/serial-numbers', generateSerials);
router.get('/serial-numbers', getSerials);
router.delete('/serial-numbers', deleteSerials);
router.patch('/serial-numbers/:id/status', updateSerialNumberStatus);

// Inspections
router.post('/inspections', createInspection);
router.get('/inspections', getInspections);
router.delete('/inspections/batch', deleteInspectionsForBatch);
router.get('/export/excel', downloadSmtReport);

// Process Setups (SPI, AOI, etc.)
router.post('/process-setups', createProcessSetup);
router.get('/process-setups', getProcessSetups);
router.delete('/process-setups/:id', deleteProcessSetup);

// Solder Paste Management
router.get('/solder-paste/status/:woId', getSolderPasteStatus);
router.get('/solder-paste/eligible-wos', getEligibleWorkOrders);
router.get('/solder-paste/dashboard-counts', getDashboardCounts);
router.get('/solder-paste/completed-batches', getCompletedBatches);
router.post('/solder-paste/stage1', completeStage1);
router.post('/solder-paste/stage2/start', startStage2Thawing);
router.post('/solder-paste/stage3/start', startStage3Mixing);
router.post('/solder-paste/stage3/complete', completeStage3Mixing);

// QMS endpoints
router.get('/qms/work-orders', authenticateToken, getQmsWorkOrders);
router.get('/qms/records', authenticateToken, getQmsRecords);
router.get('/qms/bom-revisions/:qmsId', authenticateToken, getBomRevisions);
router.get('/qms/revisions/:qmsId', authenticateToken, getQmsRevisions);
router.get('/qms/bom-items/:revisionId', authenticateToken, getBomItems);

// Material Management
router.get('/material-management/eligible-wos', authenticateToken, getMMEligibleWorkOrders);
router.get('/material-management/records', authenticateToken, getMaterialManagementRecords);
router.post('/material-management/create', authenticateToken, createMaterialManagement);
router.get('/material-management/records/:id', authenticateToken, getMaterialManagementDetail);
router.get('/material-management/records/:id/bom', authenticateToken, getMaterialManagementBom);
router.post('/material-management/records/:id/bom', authenticateToken, saveMaterialManagementBom);
router.post('/material-management/records/:id/sync-bom', authenticateToken, syncMaterialManagementBom);
router.put('/material-management/records/:id/status', authenticateToken, updateMaterialManagementStatus);
router.get('/material-management/records/:id/export/excel', authenticateToken, exportMaterialManagementExcel);

// Material Return
router.get('/material-return/eligible-wos', authenticateToken, getMREligibleWorkOrders);
router.get('/material-return/records', authenticateToken, getMaterialReturnRecords);
router.post('/material-return/create', authenticateToken, createMaterialReturn);
router.get('/material-return/records/:id', authenticateToken, getMaterialReturnDetail);
router.get('/material-return/records/:id/bom', authenticateToken, getMaterialReturnBom);
router.post('/material-return/records/:id/bom', authenticateToken, saveMaterialReturnBom);
router.get('/material-return/records/:id/export/excel', authenticateToken, exportMaterialReturnExcel);

// Stencil Management
router.post('/stencil-management/create', authenticateToken, createStencilRecord);
router.put('/stencil-management/:id', authenticateToken, updateStencilRecord);
router.delete('/stencil-management/:id', authenticateToken, deleteStencilRecord);
router.get('/stencil-management/records', authenticateToken, getStencilRecords);
router.get('/stencil-management/export', authenticateToken, exportStencilExcel);

// Stencil Life Cycle Management
router.get('/stencil-lifecycle/stencils', authenticateToken, getActiveStencils);
router.get('/stencil-lifecycle/work-orders', authenticateToken, getLifecycleWorkOrders);
router.post('/stencil-lifecycle/create', authenticateToken, createLifecycleRecord);
router.get('/stencil-lifecycle/records', authenticateToken, getLifecycleRecords);
router.get('/stencil-lifecycle/records/:id', authenticateToken, getLifecycleRecordById);
router.delete('/stencil-lifecycle/records/:id', authenticateToken, deleteLifecycleRecord);

// Baking Tracking Record
router.post('/baking-tracking/create', authenticateToken, createBakingRecord);
router.get('/baking-tracking/records', authenticateToken, getBakingRecords);
router.get('/baking-tracking/records/:id', authenticateToken, getBakingRecordById);
router.post('/baking-tracking/stop/:id', authenticateToken, stopBakingRecord);
router.delete('/baking-tracking/records/:id', authenticateToken, deleteBakingRecord);

router.post('/qms/create', authenticateToken, uploadRateLimiter, qmsUpload.fields([
    { name: 'bom', maxCount: 1 },
    { name: 'pfc', maxCount: 1 },
    { name: 'xy', maxCount: 1 },
    { name: 'ecn', maxCount: 1 },
    { name: 'drawing', maxCount: 1 }
]), createQms);

router.post('/qms/bom-revision/:qmsId', authenticateToken, uploadRateLimiter, qmsUpload.single('file'), uploadBomRevision);
router.post('/qms/update-file/:qmsId', authenticateToken, uploadRateLimiter, qmsUpload.single('file'), updateQmsFile);

router.get('/qms/files/:action/:qmsId/:fileType', serveQmsFile);
router.post('/qms/delete/:qmsId', authenticateToken, deleteQms);

// Aliases for Requirement 5
router.get('/serials', getSerials);
router.post('/serials', generateSerials);

// Employees
router.post('/employees', createEmployee);
router.get('/employees', getEmployees);
router.put('/employees/:id', updateEmployee);
router.delete('/employees/:id', deleteEmployee);
router.patch('/employees/:id/status', toggleEmployeeStatus);
router.post('/employees/login', loginEmployee);

export default router;
