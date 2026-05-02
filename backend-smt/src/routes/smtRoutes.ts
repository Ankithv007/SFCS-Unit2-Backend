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
    updateSerialNumberStatus
} from '../controllers/smtController';

const router = express.Router();

// Work Orders
router.post('/work-orders', createWorkOrder);
router.get('/work-orders', getWorkOrders);
router.get('/workorders/pending', getPendingWorkOrders);
router.post('/work-orders/:id/register', registerWorkOrder);
router.get('/work-orders/registered', getRegisteredWorkOrders);

// Serial Numbers
router.post('/serial-numbers', generateSerials);
router.get('/serial-numbers', getSerials);
router.delete('/serial-numbers', deleteSerials);
router.patch('/serial-numbers/:id/status', updateSerialNumberStatus);

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
