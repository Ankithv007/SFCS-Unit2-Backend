import express from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import smtRoutes from './routes/smtRoutes';
import workorderHistoryRoutes from './routes/workorderHistory.routes';
import pool from './config/db';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5005;

// Initialize Database Tables
const initDB = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS smt_work_orders (
                id VARCHAR(255) PRIMARY KEY,
                area_id VARCHAR(255) NOT NULL,
                line_id VARCHAR(255) NOT NULL,
                priority VARCHAR(50) NOT NULL,
                product_name VARCHAR(255) NOT NULL,
                product_description TEXT,
                quantity INTEGER NOT NULL,
                panel_quantity INTEGER NOT NULL,
                status VARCHAR(50) DEFAULT 'Created',
                created_by VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            ALTER TABLE smt_work_orders ADD COLUMN IF NOT EXISTS created_by VARCHAR(255);

            CREATE TABLE IF NOT EXISTS smt_serial_numbers (
                id SERIAL PRIMARY KEY,
                work_order_id VARCHAR(255) REFERENCES smt_work_orders(id) ON DELETE CASCADE,
                serial_format VARCHAR(50) NOT NULL,
                serial_number VARCHAR(255) UNIQUE NOT NULL,
                status VARCHAR(50) DEFAULT 'Created',
                created_by VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            ALTER TABLE smt_serial_numbers ADD COLUMN IF NOT EXISTS created_by VARCHAR(255);

            CREATE TABLE IF NOT EXISTS smt_printing_employees (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name VARCHAR(255) NOT NULL,
                user_id VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Migration: Remove all hyphens from existing records
            UPDATE smt_serial_numbers SET serial_number = REPLACE(serial_number, '-', '') WHERE serial_number LIKE '%-%';
            UPDATE smt_serial_numbers SET serial_format = REPLACE(serial_format, '-', '') WHERE serial_format LIKE '%-%';
        `);
        console.log("SMT Database tables initialized and migration completed.");
    } catch (err) {
        console.error("Error initializing SMT database tables:", err);
    }
};

app.use('/api', smtRoutes);
app.use('/api', workorderHistoryRoutes);

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', service: 'backend-smt' });
});

app.listen(PORT, async () => {
    console.log(`SMT Backend Server running on port ${PORT}`);
    await initDB();
});
