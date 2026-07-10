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
    getEligibleWorkOrders as getMsdEligibleWorkOrders,
    createMsdRecord,
    getMsdRecords,
    getMsdRecordDetail,
    getMsdBomItems,
    updateBomItem,
    getMsdRecordAudit,
    exportMsdToExcel,
    updateMsdStatus
} from '../controllers/msdTrackerController';
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
    exportMaterialManagementExcel,
    scanMaterialBarcode,
    scanReturnBarcode,
    globalScanBarcode,
    completeMaterialIssue,
    completeMaterialReturn
} from '../controllers/materialManagementController';

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
import {
    createSerialGenerationRecord,
    getSerialGenerationRecords,
    getSerialGenerationRecordDetails,
    getGeneratedSerialNumbers,
    deleteSerialGenerationRecord,
    downloadLaserDocument,
    validateLaserFile,
    cleanupTempFile,
    checkSerialNumberExists,
    addScannedBarcode,
} from '../controllers/serialBatchController';
import {
    getEligibleWorkOrders as getPrintingEligibleWos,
    getStencilDetailsForWo,
    createPrintingSession,
    getPrintingSessions,
    getSessionById as getPrintingSessionById,
    updateSessionStatus,
    deletePrintingSession,
    validateAndRecordScan,
    updateScanBarcode,
    failScanRow,
    getSessionStatistics,
    exportPrintingSessionExcel,
    exportPrintingSessionPdfData,
    checkBottomCompleted
} from '../controllers/printingController';
import {
    getEligibleWorkOrders as getPreAoiEligibleWos,
    getStencilDetailsForWo as getPreAoiStencilDetails,
    createPreAoiSession,
    getPreAoiSessions,
    getSessionById as getPreAoiSessionById,
    updateSessionStatus as updatePreAoiSessionStatus,
    deletePreAoiSession,
    validateAndRecordScan as validateAndRecordPreAoiScan,
    updateScanBarcode as updatePreAoiScanBarcode,
    failScanRow as failPreAoiScanRow,
    getSessionStatistics as getPreAoiSessionStatistics,
    exportPreAoiSessionExcel,
    exportPreAoiSessionPdfData,
    checkBottomCompleted as checkPreAoiBottomCompleted,
    getPrintingPassedBarcodes,
    getAutoPopulateDetails as getPreAoiAutoPopulateDetails
} from '../controllers/preAoiController';
import {
    getEligibleWorkOrders as getPostAoiEligibleWos,
    getStencilDetailsForWo as getPostAoiStencilDetails,
    createPostAoiSession,
    getPostAoiSessions,
    getSessionById as getPostAoiSessionById,
    updateSessionStatus as updatePostAoiSessionStatus,
    deletePostAoiSession,
    validateAndRecordScan as validateAndRecordPostAoiScan,
    updateScanBarcode as updatePostAoiScanBarcode,
    failScanRow as failPostAoiScanRow,
    getSessionStatistics as getPostAoiSessionStatistics,
    exportPostAoiSessionExcel,
    exportPostAoiSessionPdfData,
    checkBottomCompleted as checkPostAoiBottomCompleted,
    getPreAoiPassedBarcodes,
    getAutoPopulateDetails as getPostAoiAutoPopulateDetails
} from '../controllers/postAoiController';
import {
    getEligibleWorkOrders as getReworkEligibleWos,
    getStencilDetailsForWo as getReworkStencilDetails,
    createReworkSession,
    getReworkSessions,
    getSessionById as getReworkSessionById,
    updateSessionStatus as updateReworkSessionStatus,
    deleteReworkSession,
    validateAndRecordScan as validateAndRecordReworkScan,
    updateScanBarcode as updateReworkScanBarcode,
    failScanRow as failReworkScanRow,
    getSessionStatistics as getReworkSessionStatistics,
    exportReworkSessionExcel,
    exportReworkSessionPdfData,
    checkBottomCompleted as checkReworkBottomCompleted,
    getPostAoiFailedBarcodes,
    getAutoPopulateDetails as getReworkAutoPopulateDetails
} from '../controllers/reworkController';
import {
    getEligibleWorkOrders as getFgEligibleWos,
    getStencilDetailsForWo as getFgStencilDetails,
    createFgSession,
    getFgSessions,
    getSessionById as getFgSessionById,
    updateSessionStatus as updateFgSessionStatus,
    deleteSession as deleteFgSession,
    validateAndRecordScan as validateAndRecordFgScan,
    getSessionStatistics as getFgSessionStatistics,
    exportFgSessionExcel,
    getPostAoiPassedBarcodes,
    getAutoPopulateDetails as getFgAutoPopulateDetails,
    checkBottomCompleted as checkFgBottomCompleted
} from '../controllers/fgController';


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
router.delete('/serial-numbers', authenticateToken, deleteSerials);
router.patch('/serial-numbers/:id/status', updateSerialNumberStatus);

// Inspections
router.post('/inspections', createInspection);
router.get('/inspections', getInspections);
router.delete('/inspections/batch', authenticateToken, deleteInspectionsForBatch);
router.get('/export/excel', downloadSmtReport);

// Process Setups (AOI, etc.)
router.post('/process-setups', createProcessSetup);
router.get('/process-setups', getProcessSetups);
router.delete('/process-setups/:id', authenticateToken, deleteProcessSetup);

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
router.post('/material-management/records/:id/scan', authenticateToken, scanMaterialBarcode);
router.post('/material-management/records/:id/return-scan', authenticateToken, scanReturnBarcode);
router.post('/material-management/global-scan', authenticateToken, globalScanBarcode);
router.post('/material-management/records/:id/complete-issue', authenticateToken, completeMaterialIssue);
router.post('/material-management/records/:id/complete-return', authenticateToken, completeMaterialReturn);



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

// MSD Tracker Endpoints
router.get('/msd-tracker/eligible-work-orders', authenticateToken, getMsdEligibleWorkOrders);
router.post('/msd-tracker', authenticateToken, createMsdRecord);
router.get('/msd-tracker', authenticateToken, getMsdRecords);
router.get('/msd-tracker/:id', authenticateToken, getMsdRecordDetail);
router.get('/msd-tracker/:id/bom', authenticateToken, getMsdBomItems);
router.patch('/msd-tracker/bom-item/:id', authenticateToken, updateBomItem);
router.get('/msd-tracker/:id/audit', authenticateToken, getMsdRecordAudit);
router.get('/msd-tracker/:id/export/excel', authenticateToken, exportMsdToExcel);
router.patch('/msd-tracker/:id/status', authenticateToken, updateMsdStatus);

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
router.delete('/employees/:id', authenticateToken, deleteEmployee);
router.patch('/employees/:id/status', toggleEmployeeStatus);
router.post('/employees/login', loginEmployee);

// Redesigned Serial Number Generation Records (API Version 1)
router.post('/v1/smt/serial-generation-records', authenticateToken, createSerialGenerationRecord);
router.get('/v1/smt/serial-generation-records', authenticateToken, getSerialGenerationRecords);
router.get('/v1/smt/serial-generation-records/check-serial/:serialNumber', authenticateToken, checkSerialNumberExists);
router.post('/v1/smt/serial-generation-records/laser/validate', authenticateToken, uploadRateLimiter, qmsUpload.single('file'), validateLaserFile);
router.post('/v1/smt/serial-generation-records/laser/cleanup-temp', authenticateToken, cleanupTempFile);
router.post('/v1/smt/serial-generation-records/:id/scans', authenticateToken, addScannedBarcode);
router.get('/v1/smt/serial-generation-records/:id', authenticateToken, getSerialGenerationRecordDetails);
router.get('/v1/smt/serial-generation-records/:id/serials', authenticateToken, getGeneratedSerialNumbers);
router.delete('/v1/smt/serial-generation-records/:id', authenticateToken, deleteSerialGenerationRecord);
router.get('/v1/smt/serial-generation-records/:id/document/download', authenticateToken, downloadLaserDocument);

// SMT Printing Workflow
router.get('/printing/eligible-wos', authenticateToken, getPrintingEligibleWos);
router.get('/printing/stencil-details/:woId', authenticateToken, getStencilDetailsForWo);
router.post('/printing/sessions', authenticateToken, createPrintingSession);
router.get('/printing/sessions', authenticateToken, getPrintingSessions);
router.get('/printing/sessions/:id', authenticateToken, getPrintingSessionById);
router.patch('/printing/sessions/:id/status', authenticateToken, updateSessionStatus);
router.delete('/printing/sessions/:id', authenticateToken, deletePrintingSession);
router.post('/printing/sessions/:id/scan', authenticateToken, validateAndRecordScan);
router.put('/printing/sessions/:id/scan/:scanId', authenticateToken, updateScanBarcode);
router.post('/printing/sessions/:id/scan/:scanId/fail', authenticateToken, failScanRow);
router.get('/printing/sessions/:id/stats', authenticateToken, getSessionStatistics);
router.get('/printing/sessions/:id/export/excel', authenticateToken, exportPrintingSessionExcel);
router.get('/printing/sessions/:id/export/pdf-data', authenticateToken, exportPrintingSessionPdfData);
router.get('/printing/work-orders/:woId/check-bottom', authenticateToken, checkBottomCompleted);

// SMT Pre AOI Workflow
router.get('/pre-aoi/eligible-wos', authenticateToken, getPreAoiEligibleWos);
router.get('/pre-aoi/stencil-details/:woId', authenticateToken, getPreAoiStencilDetails);
router.post('/pre-aoi/sessions', authenticateToken, createPreAoiSession);
router.get('/pre-aoi/sessions', authenticateToken, getPreAoiSessions);
router.get('/pre-aoi/sessions/:id', authenticateToken, getPreAoiSessionById);
router.patch('/pre-aoi/sessions/:id/status', authenticateToken, updatePreAoiSessionStatus);
router.delete('/pre-aoi/sessions/:id', authenticateToken, deletePreAoiSession);
router.post('/pre-aoi/sessions/:id/scan', authenticateToken, validateAndRecordPreAoiScan);
router.put('/pre-aoi/sessions/:id/scan/:scanId', authenticateToken, updatePreAoiScanBarcode);
router.post('/pre-aoi/sessions/:id/scan/:scanId/fail', authenticateToken, failPreAoiScanRow);
router.get('/pre-aoi/sessions/:id/stats', authenticateToken, getPreAoiSessionStatistics);
router.get('/pre-aoi/sessions/:id/export/excel', authenticateToken, exportPreAoiSessionExcel);
router.get('/pre-aoi/sessions/:id/export/pdf-data', authenticateToken, exportPreAoiSessionPdfData);
router.get('/pre-aoi/work-orders/:woId/check-bottom', authenticateToken, checkPreAoiBottomCompleted);
router.get('/pre-aoi/sessions/:id/printing-passed', authenticateToken, getPrintingPassedBarcodes);
router.get('/pre-aoi/auto-populate-details/:woId', authenticateToken, getPreAoiAutoPopulateDetails);

// SMT Post AOI Workflow
router.get('/post-aoi/eligible-wos', authenticateToken, getPostAoiEligibleWos);
router.get('/post-aoi/stencil-details/:woId', authenticateToken, getPostAoiStencilDetails);
router.post('/post-aoi/sessions', authenticateToken, createPostAoiSession);
router.get('/post-aoi/sessions', authenticateToken, getPostAoiSessions);
router.get('/post-aoi/sessions/:id', authenticateToken, getPostAoiSessionById);
router.patch('/post-aoi/sessions/:id/status', authenticateToken, updatePostAoiSessionStatus);
router.delete('/post-aoi/sessions/:id', authenticateToken, deletePostAoiSession);
router.post('/post-aoi/sessions/:id/scan', authenticateToken, validateAndRecordPostAoiScan);
router.put('/post-aoi/sessions/:id/scan/:scanId', authenticateToken, updatePostAoiScanBarcode);
router.post('/post-aoi/sessions/:id/scan/:scanId/fail', authenticateToken, failPostAoiScanRow);
router.get('/post-aoi/sessions/:id/stats', authenticateToken, getPostAoiSessionStatistics);
router.get('/post-aoi/sessions/:id/export/excel', authenticateToken, exportPostAoiSessionExcel);
router.get('/post-aoi/sessions/:id/export/pdf-data', authenticateToken, exportPostAoiSessionPdfData);
router.get('/post-aoi/work-orders/:woId/check-bottom', authenticateToken, checkPostAoiBottomCompleted);
router.get('/post-aoi/sessions/:id/pre-aoi-passed', authenticateToken, getPreAoiPassedBarcodes);
router.get('/post-aoi/auto-populate-details/:woId', authenticateToken, getPostAoiAutoPopulateDetails);

// SMT Rework Workflow
router.get('/rework/eligible-wos', authenticateToken, getReworkEligibleWos);
router.get('/rework/stencil-details/:woId', authenticateToken, getReworkStencilDetails);
router.post('/rework/sessions', authenticateToken, createReworkSession);
router.get('/rework/sessions', authenticateToken, getReworkSessions);
router.get('/rework/sessions/:id', authenticateToken, getReworkSessionById);
router.patch('/rework/sessions/:id/status', authenticateToken, updateReworkSessionStatus);
router.delete('/rework/sessions/:id', authenticateToken, deleteReworkSession);
router.post('/rework/sessions/:id/scan', authenticateToken, validateAndRecordReworkScan);
router.put('/rework/sessions/:id/scan/:scanId', authenticateToken, updateReworkScanBarcode);
router.post('/rework/sessions/:id/scan/:scanId/fail', authenticateToken, failReworkScanRow);
router.get('/rework/sessions/:id/stats', authenticateToken, getReworkSessionStatistics);
router.get('/rework/sessions/:id/export/excel', authenticateToken, exportReworkSessionExcel);
router.get('/rework/sessions/:id/export/pdf-data', authenticateToken, exportReworkSessionPdfData);
router.get('/rework/work-orders/:woId/check-bottom', authenticateToken, checkReworkBottomCompleted);
router.get('/rework/sessions/:id/post-aoi-failed', authenticateToken, getPostAoiFailedBarcodes);
router.get('/rework/auto-populate-details/:woId', authenticateToken, getReworkAutoPopulateDetails);

// SMT FG Workflow
router.get('/smt-fg/eligible-wos', authenticateToken, getFgEligibleWos);
router.get('/smt-fg/stencil-details/:woId', authenticateToken, getFgStencilDetails);
router.post('/smt-fg/sessions', authenticateToken, createFgSession);
router.get('/smt-fg/sessions', authenticateToken, getFgSessions);
router.get('/smt-fg/sessions/:id', authenticateToken, getFgSessionById);
router.patch('/smt-fg/sessions/:id/status', authenticateToken, updateFgSessionStatus);
router.delete('/smt-fg/sessions/:id', authenticateToken, deleteFgSession);
router.post('/smt-fg/sessions/:id/scan', authenticateToken, validateAndRecordFgScan);
router.get('/smt-fg/sessions/:id/stats', authenticateToken, getFgSessionStatistics);
router.get('/smt-fg/sessions/:id/export/excel', authenticateToken, exportFgSessionExcel);
router.get('/smt-fg/work-orders/:woId/check-bottom', authenticateToken, checkFgBottomCompleted);
router.get('/smt-fg/sessions/:id/post-aoi-passed', authenticateToken, getPostAoiPassedBarcodes);
router.get('/smt-fg/auto-populate-details/:woId', authenticateToken, getFgAutoPopulateDetails);

export default router;

