import express from 'express';
import { 
    createWorkOrder, 
    getWorkOrders, 
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

// Serial Numbers
router.post('/serial-numbers', generateSerials);
router.get('/serial-numbers', getSerials);
router.delete('/serial-numbers', deleteSerials);

// Employees
router.post('/employees', createEmployee);
router.get('/employees', getEmployees);
router.put('/employees/:id', updateEmployee);
router.delete('/employees/:id', deleteEmployee);
router.patch('/employees/:id/status', toggleEmployeeStatus);
router.post('/employees/login', loginEmployee);

export default router;
