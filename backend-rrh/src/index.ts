import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { ensureUploadDirectoriesExist } from './utils/uploads';
import { createLogger } from './utils/logger';
import masterDataRoutes from './routes/masterDataRoutes';
import inwardRoutes from './routes/inwardRoutes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5007;
const logger = createLogger('Server');

// Middleware
app.use(cors());
app.use(express.json());

// Init Directories
ensureUploadDirectoriesExist();

// Routes
app.use('/api/rrh', masterDataRoutes);
app.use('/api/rrh/inward', inwardRoutes);

// Health check
app.get('/api/rrh/health', (req, res) => {
    res.status(200).json({ status: 'RRH Service is healthy.' });
});

// Start Server
app.listen(PORT, () => {
    logger.info(`RRH Microservice running on port ${PORT}`);
});
