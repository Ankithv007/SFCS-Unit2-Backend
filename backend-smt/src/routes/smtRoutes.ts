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
    loginEmployee 
} from '../controllers/smtController';

const router = express.Router();

// Work Orders
router.post('/work-orders', createWorkOrder);
router.get('/work-orders', getWorkOrders);
router.get('/workorders/pending', getPendingWorkOrders); // New endpoint

// Serial Numbers
router.post('/serial-numbers', generateSerials);
router.get('/serial-numbers', getSerials);
router.delete('/serial-numbers', deleteSerials);

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
