import express from 'express';
import { 
    createQi, 
    getAllQi, 
    getQiById, 
    updateQi, 
    deleteQi 
} from '../controllers/qiController';

const router = express.Router();

router.post('/', createQi);
router.get('/', getAllQi);
router.get('/:id', getQiById);
router.put('/:id', updateQi);
router.delete('/:id', deleteQi);

export default router;
