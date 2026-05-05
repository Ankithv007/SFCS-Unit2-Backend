import express from 'express';
import { 
    createPacking, 
    getAllPacking, 
    getPackingById, 
    updatePacking, 
    deletePacking 
} from '../controllers/packingController';

const router = express.Router();

router.post('/', createPacking);
router.get('/', getAllPacking);
router.get('/:id', getPackingById);
router.put('/:id', updatePacking);
router.delete('/:id', deletePacking);

export default router;
