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
app.use(express.json({ limit: '10mb' })); // Increase limit for Base64 uploads
app.use('/uploads', express.static('../../uploads'));

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

// Temporary Callback Route for Zoho Auth
app.get('/api/auth/callback', (req, res) => {
    const { code, error } = req.query;
    if (code) {
        console.log('✅ ZOHO AUTH CODE CAPTURED:', code);
        res.send('<h1>Authorization Successful!</h1><p>I have captured the code. You can close this window now.</p>');
    } else if (error) {
        console.error('❌ ZOHO AUTH ERROR:', error);
        res.send(`<h1>Authorization Failed</h1><p>Error: ${error}</p>`);
    } else {
        res.send('<h1>No Code Found</h1>');
    }
});

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
