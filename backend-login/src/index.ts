import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/authRoutes';
import { pool } from './config/db';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Request Logging Middleware
app.use((req, res, next) => {
    const istTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    console.log(`[${istTime}] ${req.method} ${req.url}`);
    next();
});

// Debug Config
console.log('--- Config ---');
console.log(`DB_HOST: ${process.env.DB_HOST}`);
console.log('--------------');

// Routes
app.use('/api/auth', authRoutes);

// Health Check
app.get('/health', async (req, res) => {
    try {
        const dbRes = await pool.query('SELECT NOW()');
        res.json({
            status: 'ok',
            db: dbRes.rows[0].now
        });
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// Start Server
app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server running on port ${PORT} (0.0.0.0)`);
});
