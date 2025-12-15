import express from 'express';

const router = express.Router();

router.get('/', (req, res) => {
    res.json({ message: 'Inventory API is working' });
});

export default router;
