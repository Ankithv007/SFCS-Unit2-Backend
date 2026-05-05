import express from 'express';
import { 
    createUnitTesting, 
    getAllUnitTesting, 
    getUnitTestingById, 
    updateUnitTesting, 
    deleteUnitTesting 
} from '../controllers/unitTestingController';

const router = express.Router();

router.post('/', createUnitTesting);
router.get('/', getAllUnitTesting);
router.get('/:id', getUnitTestingById);
router.put('/:id', updateUnitTesting);
router.delete('/:id', deleteUnitTesting);

export default router;
