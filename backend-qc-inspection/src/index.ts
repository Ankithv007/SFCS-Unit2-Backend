import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import qcInspectionRoutes from './routes/qcInspectionRoutes';

dotenv.config();

const app = express();
const port = process.env.PORT || 5003;

// Middleware
app.use(cors());
app.use(express.json());

// Database connection imported from config
import { pool } from './config/database';

// Routes
app.use('/api/qc-inspection', qcInspectionRoutes);

// Health check
app.get('/', (req, res) => {
    res.send('QC Inspection Microservice is running');
});

app.listen(port, () => {
    console.log(`QC Inspection Microservice running on port ${port}`);
});
