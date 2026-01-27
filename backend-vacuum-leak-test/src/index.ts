import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import vacuumLeakTestRoutes from './routes/vacuumLeakTestRoutes';
import pool from './config/db';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5004;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/vacuum-leak-test', vacuumLeakTestRoutes);

// Health Check
app.get('/', (req, res) => {
    res.json({ message: 'Vacuum Leak Test Microservice is running' });
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
