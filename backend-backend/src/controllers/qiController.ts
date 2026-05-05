import { Request, Response } from 'express';
import pool from '../config/db';

export const createQi = async (req: Request, res: Response) => {
    try {
        const { name } = req.body;
        const result = await pool.query(
            'INSERT INTO qi (name) VALUES ($1) RETURNING *',
            [name]
        );
        res.status(201).json(result.rows[0]);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

export const getAllQi = async (req: Request, res: Response) => {
    try {
        const result = await pool.query('SELECT * FROM qi ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

export const getQiById = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM qi WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0]);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

export const updateQi = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { name } = req.body;
        const result = await pool.query(
            'UPDATE qi SET name = $1 WHERE id = $2 RETURNING *',
            [name, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0]);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

export const deleteQi = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM qi WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json({ message: 'Deleted successfully' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};
