import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import inventoryRoutes from './routes/inventoryRoutes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

// Log all requests
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

app.use('/api/inventory', inventoryRoutes);

// Proxy auth requests to the main backend (assuming it runs on port 5000)
// This is a temporary workaround if the auth service is separate or merged
const proxy = require('express-http-proxy');
app.use('/api/auth', proxy('http://localhost:5000', {
    proxyReqPathResolver: (req: any) => {
        return `/api/auth${req.url}`;
    }
}));

app.get('/', (req, res) => {
    res.send('Inventory Service is running');
});

app.listen(PORT, () => {
    console.log(`Inventory Service running on port ${PORT}`);
});

// Trigger restart for env update
