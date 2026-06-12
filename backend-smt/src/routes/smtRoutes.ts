import express from 'express';
import {
    createWorkOrder,
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
import { authenticateToken } from '../middleware/authMiddleware';

const router = express.Router();

// Work Orders
router.post('/work-orders', createWorkOrder);
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
