import express from 'express';
import { 
    createAssembly, 
    getAllAssemblies, 
    getAssemblyById, 
    updateAssembly, 
    deleteAssembly 
} from '../controllers/assemblyController';

const router = express.Router();

router.post('/', createAssembly);
router.get('/', getAllAssemblies);
router.get('/:id', getAssemblyById);
router.put('/:id', updateAssembly);
router.delete('/:id', deleteAssembly);

export default router;
