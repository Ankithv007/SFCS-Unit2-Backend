import { Router } from 'express';
import ecnIpqcRoutes from './ecn/ecnIpqcRoutes';
import ecnProgrammingRoutes from './ecn/ecnProgrammingRoutes';
import ecnPreBurnInRoutes from './ecn/ecnPreBurnInRoutes';
import ecnHipotRoutes from './ecn/ecnHipotRoutes';
import ecnPostBurnInRoutes from './ecn/ecnPostBurnInRoutes';

const router = Router();

router.use('/ipqc', ecnIpqcRoutes);
router.use('/programming', ecnProgrammingRoutes);
router.use('/pre-burn-in', ecnPreBurnInRoutes);
router.use('/hipot', ecnHipotRoutes);
router.use('/post-burn-in', ecnPostBurnInRoutes);

export default router;
