import express from 'express';
import { getWorkOrderHistory } from '../controllers/workorderHistory.controller';

const router = express.Router();

router.get('/workorder-history', getWorkOrderHistory);

export default router;
