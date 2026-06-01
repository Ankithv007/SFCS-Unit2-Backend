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
    downloadSmtReport
} from '../controllers/smtController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = express.Router();

// Work Orders
router.post('/work-orders', createWorkOrder);
router.get('/work-orders', getWorkOrders);
router.get('/workorders/pending', getPendingWorkOrders);
router.post('/work-orders/:id/register', registerWorkOrder);
router.get('/work-orders/registered', getRegisteredWorkOrders);
router.get('/workorder-history', getWorkOrderHistory);
router.delete('/work-orders/:id', deleteWorkOrder);

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
