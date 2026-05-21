import express from 'express';
import { 
    getEmployees, 
    createEmployee, 
    updateEmployee, 
    toggleEmployeeStatus, 
    deleteEmployee,
    loginEmployee
} from '../controllers/backendEmployeeController';

const router = express.Router();

router.get('/', getEmployees);
router.post('/', createEmployee);
router.post('/login', loginEmployee);
router.put('/:id', updateEmployee);
router.patch('/:id/status', toggleEmployeeStatus);
router.delete('/:id', deleteEmployee);

export default router;
