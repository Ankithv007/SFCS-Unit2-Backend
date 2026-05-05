import express from 'express';
import { 
    createFlashing, 
    getAllFlashings, 
    getFlashingById, 
    updateFlashing, 
    deleteFlashing 
} from '../controllers/flashingController';

const router = express.Router();

router.post('/', createFlashing);
router.get('/', getAllFlashings);
router.get('/:id', getFlashingById);
router.put('/:id', updateFlashing);
router.delete('/:id', deleteFlashing);

export default router;
