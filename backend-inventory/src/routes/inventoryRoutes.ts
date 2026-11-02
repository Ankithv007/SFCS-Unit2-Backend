import express from 'express';
import { createPurchaseOrder, searchItems, getZohoPO, getAllPurchaseOrders } from '../controllers/inventoryController';

const router = express.Router();

router.get('/zoho/po/:poNumber', (req, res, next) => {
    console.log('=== ROUTE HIT ===');
    console.log('PO Number from params:', req.params.poNumber);
    next();
}, getZohoPO);

router.get('/po', getAllPurchaseOrders);
router.post('/po', createPurchaseOrder);
router.get('/items/search', searchItems);

router.get('/', (req, res) => {
    res.json({ message: 'Inventory API is working' });
});

export default router;
