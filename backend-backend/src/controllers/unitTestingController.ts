import { Request, Response } from 'express';
import pool from '../config/db';

export const createUnitTesting = async (req: Request, res: Response) => {
    try {
        const { name } = req.body;
        const result = await pool.query(
            'INSERT INTO unit_testing (name) VALUES ($1) RETURNING *',
            [name]
        );
        res.status(201).json(result.rows[0]);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

export const getAllUnitTesting = async (req: Request, res: Response) => {
    try {
        const result = await pool.query('SELECT * FROM unit_testing ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

export const getUnitTestingById = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM unit_testing WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0]);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

export const updateUnitTesting = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { name } = req.body;
        const result = await pool.query(
            'UPDATE unit_testing SET name = $1 WHERE id = $2 RETURNING *',
            [name, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0]);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

export const deleteUnitTesting = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM unit_testing WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json({ message: 'Deleted successfully' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};
