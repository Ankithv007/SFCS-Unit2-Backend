import express from 'express';
import { 
    createPcbaFct, 
    getAllPcbaFct, 
    getPcbaFctById, 
    updatePcbaFct, 
    deletePcbaFct 
} from '../controllers/pcbaFctController';

const router = express.Router();

router.post('/', createPcbaFct);
router.get('/', getAllPcbaFct);
router.get('/:id', getPcbaFctById);
router.put('/:id', updatePcbaFct);
router.delete('/:id', deletePcbaFct);

export default router;
