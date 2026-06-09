import express from 'express';
import { authenticateToken, authorizeAdminOrSuperAdmin } from '../middleware/authMiddleware';
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
router.delete('/:id', authenticateToken, authorizeAdminOrSuperAdmin, deleteEmployee);

export default router;
