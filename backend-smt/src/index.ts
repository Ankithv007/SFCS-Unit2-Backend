import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import smtRoutes from './routes/smtRoutes';
import workorderHistoryRoutes from './routes/workorderHistory.routes';
import pool from './config/db';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5005;

// Initialize Database Tables from schema.sql
const initDB = async () => {
    try {
        console.log("Initializing SMT database tables...");
        const schemaPath = path.join(__dirname, 'db/schema.sql');

        if (fs.existsSync(schemaPath)) {
            const schema = fs.readFileSync(schemaPath, 'utf8');
            await pool.query(schema);
            console.log("SMT Database tables initialized successfully from schema.sql.");

            // Run migrations/initial data if needed
            await pool.query(`
                UPDATE smt_serial_numbers SET serial_number = REPLACE(serial_number, '-', '') WHERE serial_number LIKE '%-%';
                UPDATE smt_serial_numbers SET serial_format = REPLACE(serial_format, '-', '') WHERE serial_format LIKE '%-%';
            `);
            console.log("SMT migrations completed.");
        } else {
            console.warn("Warning: schema.sql not found at", schemaPath);
            // Fallback to legacy init if file missing (optional)
        }
    } catch (err) {
        console.error("Error initializing SMT database tables:", err);
    }
};

app.use('/api', smtRoutes);
app.use('/api', workorderHistoryRoutes);

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', service: 'backend-smt' });
});

const startServer = async () => {
    try {
        await initDB();
        app.listen(PORT, () => {
            console.log(`SMT Backend Server running on port ${PORT}`);
        });
    } catch (err) {
        console.error("Failed to start SMT Backend Server:", err);
        process.exit(1);
    }
};

startServer();
