import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import inventoryRoutes from './routes/inventoryRoutes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5002;

app.use(cors());
app.use(express.json());

app.use('/api/inventory', inventoryRoutes);

app.get('/', (req, res) => {
    res.send('Inventory Service is running');
});

app.listen(PORT, () => {
    console.log(`Inventory Service running on port ${PORT}`);
});
