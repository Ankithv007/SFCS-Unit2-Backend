import { Router } from 'express';
import nonEcnPostBurnInInitialRoutes from './nonEcn/nonEcnPostBurnInInitialRoutes';
import nonEcnProgrammingRoutes from './nonEcn/nonEcnProgrammingRoutes';
import nonEcnPreBurnInRoutes from './nonEcn/nonEcnPreBurnInRoutes';
import nonEcnHipotRoutes from './nonEcn/nonEcnHipotRoutes';
import nonEcnPostBurnInRoutes from './nonEcn/nonEcnPostBurnInRoutes';

const router = Router();

router.use('/post-burn-in-initial', nonEcnPostBurnInInitialRoutes);
router.use('/post-burn-in', nonEcnPostBurnInInitialRoutes);
router.use('/post-burn-in-final', nonEcnPostBurnInRoutes);
router.use('/final-post-burn-in', nonEcnPostBurnInRoutes);
router.use('/programming', nonEcnProgrammingRoutes);
router.use('/pre-burn-in', nonEcnPreBurnInRoutes);
router.use('/hipot', nonEcnHipotRoutes);

export default router;
