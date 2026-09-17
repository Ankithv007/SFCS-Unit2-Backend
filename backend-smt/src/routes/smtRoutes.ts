import express from 'express';
import {
    getLiveWorkOrders,
    searchWorkOrders,
    getWorkOrderDashboard,
    exportWorkOrderDayExcel,
    exportWorkOrderDayPdfData,
    streamDashboardEvents
} from '../controllers/adminDashboardController';
import {
    createWorkOrder,
    updateWorkOrder,
    getWorkOrders,
    getWorkOrderById,
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
    getCans,
    createCan,
    updateCan,
    deleteCan,
    getModels,
    getFifoCan,
    startSession,
    getLatestSession,
    recordConsumption,
    getConsumptionHistory,
    updateModel,
    getActiveSessions,
    getActiveSessionById,
    deleteActiveSession
} from '../controllers/spMasterController';
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
    getActiveStencils,
    getLifecycleWorkOrders,
    createLifecycleRecord,
    getLifecycleRecords,
    getLifecycleRecordById,
    deleteLifecycleRecord,
    completeMaintenance,
    scrapStencil,
    getMaintenanceHistory,
    getStatusHistory
} from '../controllers/stencilLifecycleController';
import {
    createBakingRecord,
    getBakingRecords,
    getBakingRecordById,
    stopBakingRecord,
    deleteBakingRecord
} from '../controllers/bakingTrackingController';
import {
    getDashboardStats,
    getRacks,
    createRack,
    updateRack,
    deleteRack,
    getRackLocations,
    assignStencil,
    clearLocation,
    getStencilInfoByJob,
    scanReceive,
    scanReturn,
    relocateStencil,
    getMovementHistory,
    exportRackReport,
    exportSingleRackExcel
} from '../controllers/stencilRackController';
import { authenticateToken, requireRole, requirePermission } from '../middleware/authMiddleware';
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
    getActiveCustomerBatch,
    updateCustomerBarcode,
    exportSerialGenerationExcel,
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
    getEligibleWorkOrders as getSpiEligibleWos,
    getStencilDetailsForWo as getSpiStencilDetails,
    createSpiSession,
    getSpiSessions,
    getSessionById as getSpiSessionById,
    updateSessionStatus as updateSpiSessionStatus,
    deleteSpiSession,
    validateAndRecordScan as validateAndRecordSpiScan,
    updateScanBarcode as updateSpiScanBarcode,
    failScanRow as failSpiScanRow,
    getSessionStatistics as getSpiSessionStatistics,
    exportSpiSessionExcel,
    exportSpiSessionPdfData,
    checkBottomCompleted as checkSpiBottomCompleted,
    getPrintingPassedBarcodes as getSpiPrintingPassedBarcodes,
    getAutoPopulateDetails as getSpiAutoPopulateDetails
} from '../controllers/spiController';
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
    exportFgSessionPdfData,
    getPostAoiPassedBarcodes,
    getAutoPopulateDetails as getFgAutoPopulateDetails,
    checkBottomCompleted as checkFgBottomCompleted
} from '../controllers/fgController';
import {
    getSmtOperators,
    getOperatorAssignment,
    assignOperator,
    getPendingFgJobs
} from '../controllers/smtFgOperatorController';


const router = express.Router();


// Admin Production Dashboard APIs
router.get('/admin/dashboard/events', authenticateToken, streamDashboardEvents);
router.get('/admin/dashboard/live-work-orders', authenticateToken, getLiveWorkOrders);
router.get('/admin/work-orders/search', authenticateToken, searchWorkOrders);
router.get('/admin/work-orders/:workOrderId/dashboard', authenticateToken, getWorkOrderDashboard);
router.get('/admin/work-orders/:workOrderId/export/excel', authenticateToken, exportWorkOrderDayExcel);
router.get('/admin/work-orders/:workOrderId/export/pdf-data', authenticateToken, exportWorkOrderDayPdfData);

// Work Orders
const workOrderView = [authenticateToken, requirePermission('smt_work_order', 'can_view')];
const workOrderCreate = [authenticateToken, requirePermission('smt_work_order', 'can_create')];
const workOrderEdit = [authenticateToken, requirePermission('smt_work_order', 'can_edit')];
const workOrderDelete = [authenticateToken, requirePermission('smt_work_order', 'can_delete')];
const workOrderExport = [authenticateToken, requirePermission('smt_work_order', 'can_export')];
const poDocumentAccess = [authenticateToken, requireRole(['Super Admin', 'Admin'])];

router.post('/work-orders', workOrderCreate, createWorkOrder);
router.put('/work-orders/:id', workOrderEdit, updateWorkOrder);
router.get('/work-orders', workOrderView, getWorkOrders);
router.get('/workorders/pending', authenticateToken, getPendingWorkOrders);
router.post('/work-orders/:id/register', workOrderCreate, registerWorkOrder);
router.get('/work-orders/registered', workOrderView, getRegisteredWorkOrders);
router.get('/work-orders/:id', workOrderView, getWorkOrderById);
router.get('/workorder-history', workOrderView, getWorkOrderHistory);
router.delete('/work-orders/:id', workOrderDelete, deleteWorkOrder);
router.get('/work-orders/:id/preview-po', poDocumentAccess, previewPoDocument);
router.get('/work-orders/:id/view-po-file', poDocumentAccess, viewPoDocumentFile);
router.get('/work-orders/:id/download-po', poDocumentAccess, downloadPoDocument);

// Serial Numbers
router.post('/serial-numbers', authenticateToken, generateSerials);
router.get('/serial-numbers', authenticateToken, getSerials);
router.delete('/serial-numbers', [authenticateToken, requirePermission('smt_serial_number', 'can_delete')], deleteSerials);
router.patch('/serial-numbers/:id/status', authenticateToken, updateSerialNumberStatus);

// Inspections
router.post('/inspections', createInspection);
router.get('/inspections', getInspections);
router.delete('/inspections/batch', [authenticateToken, requirePermission('smt_printing', 'can_delete')], deleteInspectionsForBatch);
router.get('/export/excel', downloadSmtReport);

// Process Setups (AOI, etc.)
router.post('/process-setups', createProcessSetup);
router.get('/process-setups', getProcessSetups);
router.delete('/process-setups/:id', [authenticateToken, requirePermission('smt_printing', 'can_delete')], deleteProcessSetup);

// ─── Solder Paste Master (New Centralized Module) ────────────────────────────
router.get('/sp-master/cans',                authenticateToken, getCans);
router.post('/sp-master/cans',               authenticateToken, createCan);
router.put('/sp-master/cans/:id',            authenticateToken, updateCan);
router.delete('/sp-master/cans/:id',         [authenticateToken, requirePermission('smt_solder_paste', 'can_delete')], deleteCan);
router.get('/sp-master/models',              authenticateToken, getModels);
router.put('/sp-master/models/:id',         authenticateToken, updateModel);
router.get('/sp-master/fifo',                authenticateToken, getFifoCan);
router.post('/sp-master/sessions',           authenticateToken, startSession);
router.get('/sp-master/sessions/latest',     authenticateToken, getLatestSession);
router.post('/sp-master/consume',            authenticateToken, recordConsumption);
router.get('/sp-master/consumption',         authenticateToken, getConsumptionHistory);
router.get('/sp-master/active-sessions',     authenticateToken, getActiveSessions);
router.get('/sp-master/active-sessions/:id', authenticateToken, getActiveSessionById);
router.delete('/sp-master/active-sessions/:id', [authenticateToken, requirePermission('smt_solder_paste', 'can_delete')], deleteActiveSession);

// Backward compatible aliases without /sp-master prefix
router.get('/active-sessions',                 authenticateToken, getActiveSessions);
router.get('/active-sessions/:id',             authenticateToken, getActiveSessionById);
router.delete('/active-sessions/:id',           [authenticateToken, requirePermission('smt_solder_paste', 'can_delete')], deleteActiveSession);

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



// Stencil Life Cycle Management
router.get('/stencil-lifecycle/stencils', authenticateToken, getActiveStencils);
router.get('/stencil-lifecycle/work-orders', authenticateToken, getLifecycleWorkOrders);
router.post('/stencil-lifecycle/create', authenticateToken, createLifecycleRecord);
router.get('/stencil-lifecycle/records', authenticateToken, getLifecycleRecords);
router.get('/stencil-lifecycle/records/:id', authenticateToken, getLifecycleRecordById);
router.delete('/stencil-lifecycle/records/:id', [authenticateToken, requirePermission('smt_stencil_lifecycle', 'can_delete')], deleteLifecycleRecord);

// New Maintenance & History routes
router.post('/stencil-lifecycle/maintenance/complete', [authenticateToken, requirePermission('smt_stencil_lifecycle', 'can_edit')], completeMaintenance);
router.post('/stencil-lifecycle/maintenance/scrap', [authenticateToken, requirePermission('smt_stencil_lifecycle', 'can_edit')], scrapStencil);
router.get('/stencil-lifecycle/maintenance/history/:rackNumber', authenticateToken, getMaintenanceHistory);
router.get('/stencil-lifecycle/status-history/:rackNumber', authenticateToken, getStatusHistory);

// Baking Tracking Record
router.post('/baking-tracking/create', authenticateToken, createBakingRecord);
router.get('/baking-tracking/records', authenticateToken, getBakingRecords);
router.get('/baking-tracking/records/:id', authenticateToken, getBakingRecordById);
router.post('/baking-tracking/stop/:id', authenticateToken, stopBakingRecord);
router.delete('/baking-tracking/records/:id', [authenticateToken, requirePermission('smt_baking_tracking', 'can_delete')], deleteBakingRecord);

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
    { name: 'drawing', maxCount: 3 },
    { name: 'drawing1', maxCount: 1 },
    { name: 'drawing2', maxCount: 1 },
    { name: 'drawing3', maxCount: 1 }
]), createQms);

router.post('/qms/bom-revision/:qmsId', authenticateToken, uploadRateLimiter, qmsUpload.single('file'), uploadBomRevision);
router.post('/qms/update-file/:qmsId', authenticateToken, uploadRateLimiter, qmsUpload.single('file'), updateQmsFile);

router.get('/qms/files/:action/:qmsId/:fileType', serveQmsFile);
router.post('/qms/delete/:qmsId', [authenticateToken, requirePermission('smt_qms', 'can_delete')], deleteQms);

// Aliases for Requirement 5
router.get('/serials', getSerials);
router.post('/serials', generateSerials);

// Employees
router.post('/employees', createEmployee);
router.get('/employees', getEmployees);
router.put('/employees/:id', updateEmployee);
router.delete('/employees/:id', [authenticateToken, requirePermission('smt_dashboard', 'can_delete')], deleteEmployee);
router.patch('/employees/:id/status', toggleEmployeeStatus);
router.post('/employees/login', loginEmployee);

// Redesigned Serial Number Generation Records (API Version 1)
router.post('/v1/smt/serial-generation-records', authenticateToken, createSerialGenerationRecord);
router.get('/v1/smt/serial-generation-records', authenticateToken, getSerialGenerationRecords);
router.get('/v1/smt/serial-generation-records/active-customer/:workOrderId', authenticateToken, getActiveCustomerBatch);
router.get('/v1/smt/serial-generation-records/check-serial/:serialNumber', authenticateToken, checkSerialNumberExists);
router.post('/v1/smt/serial-generation-records/laser/validate', authenticateToken, uploadRateLimiter, qmsUpload.single('file'), validateLaserFile);
router.post('/v1/smt/serial-generation-records/laser/cleanup-temp', authenticateToken, cleanupTempFile);
router.post('/v1/smt/serial-generation-records/:id/scans', authenticateToken, addScannedBarcode);
router.get('/v1/smt/serial-generation-records/:id', authenticateToken, getSerialGenerationRecordDetails);
router.get('/v1/smt/serial-generation-records/:id/serials', authenticateToken, getGeneratedSerialNumbers);
router.delete('/v1/smt/serial-generation-records/:id', [authenticateToken, requirePermission('smt_serial_number', 'can_delete')], deleteSerialGenerationRecord);
router.get('/v1/smt/serial-generation-records/:id/document/download', authenticateToken, downloadLaserDocument);
router.put('/v1/smt/serial-generation-records/:id/customer-barcode', authenticateToken, updateCustomerBarcode);
router.get('/v1/smt/serial-generation-records/:id/export/excel', authenticateToken, exportSerialGenerationExcel);

// SMT Printing Workflow
router.get('/printing/eligible-wos', authenticateToken, getPrintingEligibleWos);
router.get('/printing/stencil-details/:woId', authenticateToken, getStencilDetailsForWo);
router.post('/printing/sessions', authenticateToken, createPrintingSession);
router.get('/printing/sessions', authenticateToken, getPrintingSessions);
router.get('/printing/sessions/:id', authenticateToken, getPrintingSessionById);
router.patch('/printing/sessions/:id/status', authenticateToken, updateSessionStatus);
router.delete('/printing/sessions/:id', [authenticateToken, requirePermission('smt_printing', 'can_delete')], deletePrintingSession);
router.post('/printing/sessions/:id/scan', authenticateToken, validateAndRecordScan);
router.put('/printing/sessions/:id/scan/:scanId', authenticateToken, updateScanBarcode);
router.post('/printing/sessions/:id/scan/:scanId/fail', authenticateToken, failScanRow);
router.get('/printing/sessions/:id/stats', authenticateToken, getSessionStatistics);
router.get('/printing/sessions/:id/export/excel', authenticateToken, exportPrintingSessionExcel);
router.get('/printing/sessions/:id/export/pdf-data', authenticateToken, exportPrintingSessionPdfData);
router.get('/printing/work-orders/:woId/check-bottom', authenticateToken, checkBottomCompleted);

// SMT SPI Workflow
router.get('/spi/eligible-wos', authenticateToken, getSpiEligibleWos);
router.get('/spi/stencil-details/:woId', authenticateToken, getSpiStencilDetails);
router.post('/spi/sessions', authenticateToken, createSpiSession);
router.get('/spi/sessions', authenticateToken, getSpiSessions);
router.get('/spi/sessions/:id', authenticateToken, getSpiSessionById);
router.patch('/spi/sessions/:id/status', authenticateToken, updateSpiSessionStatus);
router.delete('/spi/sessions/:id', [authenticateToken, requirePermission('smt_spi', 'can_delete')], deleteSpiSession);
router.post('/spi/sessions/:id/scan', authenticateToken, validateAndRecordSpiScan);
router.put('/spi/sessions/:id/scan/:scanId', authenticateToken, updateSpiScanBarcode);
router.post('/spi/sessions/:id/scan/:scanId/fail', authenticateToken, failSpiScanRow);
router.get('/spi/sessions/:id/stats', authenticateToken, getSpiSessionStatistics);
router.get('/spi/sessions/:id/export/excel', authenticateToken, exportSpiSessionExcel);
router.get('/spi/sessions/:id/export/pdf-data', authenticateToken, exportSpiSessionPdfData);
router.get('/spi/work-orders/:woId/check-bottom', authenticateToken, checkSpiBottomCompleted);
router.get('/spi/sessions/:id/printing-passed', authenticateToken, getSpiPrintingPassedBarcodes);
router.get('/spi/auto-populate-details/:woId', authenticateToken, getSpiAutoPopulateDetails);

// SMT Pre AOI Workflow
router.get('/pre-aoi/eligible-wos', authenticateToken, getPreAoiEligibleWos);
router.get('/pre-aoi/stencil-details/:woId', authenticateToken, getPreAoiStencilDetails);
router.post('/pre-aoi/sessions', authenticateToken, createPreAoiSession);
router.get('/pre-aoi/sessions', authenticateToken, getPreAoiSessions);
router.get('/pre-aoi/sessions/:id', authenticateToken, getPreAoiSessionById);
router.patch('/pre-aoi/sessions/:id/status', authenticateToken, updatePreAoiSessionStatus);
router.delete('/pre-aoi/sessions/:id', [authenticateToken, requirePermission('smt_pre_aoi', 'can_delete')], deletePreAoiSession);
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
router.delete('/post-aoi/sessions/:id', [authenticateToken, requirePermission('smt_post_aoi', 'can_delete')], deletePostAoiSession);
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
router.delete('/rework/sessions/:id', [authenticateToken, requirePermission('smt_rework', 'can_delete')], deleteReworkSession);
router.post('/rework/sessions/:id/scan', authenticateToken, validateAndRecordReworkScan);
router.put('/rework/sessions/:id/scan/:scanId', authenticateToken, updateReworkScanBarcode);
router.post('/rework/sessions/:id/scan/:scanId/fail', authenticateToken, failReworkScanRow);
router.get('/rework/sessions/:id/stats', authenticateToken, getReworkSessionStatistics);
router.get('/rework/sessions/:id/export/excel', authenticateToken, exportReworkSessionExcel);
router.get('/rework/sessions/:id/export/pdf-data', authenticateToken, exportReworkSessionPdfData);
router.get('/rework/work-orders/:woId/check-bottom', authenticateToken, checkReworkBottomCompleted);
router.get('/rework/sessions/:id/post-aoi-failed', authenticateToken, getPostAoiFailedBarcodes);
router.get('/rework/auto-populate-details/:woId', authenticateToken, getReworkAutoPopulateDetails);

// SMT-FG Operator Assignment (Admin Panel)
router.get('/smt-fg/smt-operators', [authenticateToken, requireRole(['Admin', 'Super Admin'])], getSmtOperators);
router.get('/smt-fg/pending-fg-jobs', [authenticateToken, requireRole(['Admin', 'Super Admin'])], getPendingFgJobs);
router.get('/smt-fg/work-orders/:woId/operator-assignment', [authenticateToken, requireRole(['Admin', 'Super Admin'])], getOperatorAssignment);
router.post('/smt-fg/work-orders/:woId/operator-assignment', [authenticateToken, requireRole(['Admin', 'Super Admin'])], assignOperator);

// SMT FG Workflow
router.get('/smt-fg/eligible-wos', authenticateToken, getFgEligibleWos);
router.get('/smt-fg/stencil-details/:woId', authenticateToken, getFgStencilDetails);
router.post('/smt-fg/sessions', authenticateToken, createFgSession);
router.get('/smt-fg/sessions', authenticateToken, getFgSessions);
router.get('/smt-fg/sessions/:id', authenticateToken, getFgSessionById);
router.patch('/smt-fg/sessions/:id/status', authenticateToken, updateFgSessionStatus);
router.delete('/smt-fg/sessions/:id', [authenticateToken, requirePermission('smt_fg', 'can_delete')], deleteFgSession);
router.post('/smt-fg/sessions/:id/scan', authenticateToken, validateAndRecordFgScan);
router.get('/smt-fg/sessions/:id/stats', authenticateToken, getFgSessionStatistics);
router.get('/smt-fg/sessions/:id/export/excel', authenticateToken, exportFgSessionExcel);
router.get('/smt-fg/sessions/:id/export/pdf-data', authenticateToken, exportFgSessionPdfData);
router.get('/smt-fg/work-orders/:woId/check-bottom', authenticateToken, checkFgBottomCompleted);
router.get('/smt-fg/sessions/:id/post-aoi-passed', authenticateToken, getPostAoiPassedBarcodes);
router.get('/smt-fg/auto-populate-details/:woId', authenticateToken, getFgAutoPopulateDetails);

// BOM Split Module Routes
import {
    parseBomWorkbook,
    getBomHistoryList,
    downloadBomFile,
    getAuditLogs,
    recordResetAction,
    getBomDetail,
    updateBomSplitItem,
    parseAgain,
    deleteBomHistory,
    uploadExcel
} from '../controllers/bomSplitController';

router.post('/bom-split/parse', authenticateToken, uploadExcel.single('file'), parseBomWorkbook);
router.get('/bom-split/history', authenticateToken, getBomHistoryList);
router.get('/bom-split/download/:id/:type', authenticateToken, downloadBomFile);
router.get('/bom-split/audit-logs', authenticateToken, getAuditLogs);
router.post('/bom-split/reset', authenticateToken, recordResetAction);
router.get('/bom-split/detail/:id', authenticateToken, getBomDetail);
router.put('/bom-split/items/:itemId', authenticateToken, updateBomSplitItem);
router.post('/bom-split/parse-again/:id', authenticateToken, parseAgain);
router.delete('/bom-split/history/:id', [authenticateToken, requirePermission('bom_split', 'can_delete')], deleteBomHistory);

// Stencil Rack Management Routes
router.get('/stencil-rack/dashboard', authenticateToken, getDashboardStats);
router.get('/stencil-rack', authenticateToken, getRacks);
router.post('/stencil-rack', [authenticateToken, requirePermission('smt_stencil_rack', 'can_create')], createRack);
router.put('/stencil-rack/:id', [authenticateToken, requirePermission('smt_stencil_rack', 'can_edit')], updateRack);
router.delete('/stencil-rack/:id', [authenticateToken, requirePermission('smt_stencil_rack', 'can_delete')], deleteRack);
router.get('/stencil-rack/:id/locations', authenticateToken, getRackLocations);
router.post('/stencil-rack/locations/:locationId/assign', [authenticateToken, requirePermission('smt_stencil_rack', 'can_edit')], assignStencil);
router.post('/stencil-rack/locations/:locationId/clear', [authenticateToken, requirePermission('smt_stencil_rack', 'can_edit')], clearLocation);
router.post('/stencil-rack/locations/:locationId/relocate', [authenticateToken, requirePermission('smt_stencil_rack', 'can_edit')], relocateStencil);
router.get('/stencil-rack/reports/export', authenticateToken, exportRackReport);
router.get('/stencil-rack/:id/export/excel', authenticateToken, exportSingleRackExcel);

// Stencil Scan Routes
router.get('/stencil-rack/stencil-info/:jobNumber', authenticateToken, getStencilInfoByJob);
router.post('/stencil-rack/scan/receive', [authenticateToken, requirePermission('smt_stencil_scan', 'can_edit')], scanReceive);
router.post('/stencil-rack/scan/return', [authenticateToken, requirePermission('smt_stencil_scan', 'can_edit')], scanReturn);
router.get('/stencil-rack/history/:jobNumber', authenticateToken, getMovementHistory);

export default router;

