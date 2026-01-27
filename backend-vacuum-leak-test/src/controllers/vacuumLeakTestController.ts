import { Request, Response } from 'express';
import pool from '../config/db';

export const getTest = async (req: Request, res: Response) => {
    try {
        res.json({ message: 'Vacuum Leak Test API is working' });
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
};
