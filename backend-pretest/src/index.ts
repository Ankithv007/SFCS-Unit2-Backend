import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import iqcRoutes from './routes/iqcRoutes';
import pool from './config/db';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5002;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/iqc', iqcRoutes);

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
