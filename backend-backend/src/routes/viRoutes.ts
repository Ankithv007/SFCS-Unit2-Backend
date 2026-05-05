import express from 'express';
import { 
    createVi, 
    getAllVi, 
    getViById, 
    updateVi, 
    deleteVi 
} from '../controllers/viController';

const router = express.Router();

router.post('/', createVi);
router.get('/', getAllVi);
router.get('/:id', getViById);
router.put('/:id', updateVi);
router.delete('/:id', deleteVi);

export default router;
