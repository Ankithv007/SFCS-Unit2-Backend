import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import iqcRoutes from './routes/iqcRoutes';
import impedanceRoutes from './routes/impedanceRoutes';
import warehouseRoutes from './routes/warehouseRoutes';
import pool from './config/db';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5002;

// Middleware
app.use(cors({
    origin: [
        'http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175',
        'http://127.0.0.1:5173', 'http://127.0.0.1:5174', 'http://127.0.0.1:5175'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Routes
app.use('/api/iqc', iqcRoutes);
app.use('/api/impedance', impedanceRoutes);
app.use('/api/warehouse', warehouseRoutes);

// Health Check
app.get('/', (req, res) => {
    res.json({ message: 'Backend Pre-test Service is running' });
});

// Database Connection Check
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('Database connection error:', err);
    } else {
        console.log('Database connected successfully');
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
