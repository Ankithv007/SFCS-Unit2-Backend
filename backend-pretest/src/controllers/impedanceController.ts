import { Request, Response } from 'express';
import pool from '../config/db';

// Start a new Impedance Session
export const startSession = async (req: Request, res: Response) => {
    const { tested_by, remarks, batch_id } = req.body;

    if (!tested_by) {
        return res.status(400).json({ error: 'Tested By is required' });
    }

    try {
        const result = await pool.query(
            'INSERT INTO impedance_sessions (tested_by, remarks, batch_id) VALUES ($1, $2, $3) RETURNING *',
            [tested_by, remarks, batch_id]
        );
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error starting impedance session:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Scan PCB for Impedance
export const scanPcb = async (req: Request, res: Response) => {
    const { session_id, barcode, status, remarks } = req.body;

    if (!session_id || !barcode) {
        return res.status(400).json({ error: 'Session ID and Barcode are required' });
    }

    try {
        // 1. Validate against IQC (Must be ACCEPTED in IQC)
        // We check if this barcode exists in ANY IQC batch and is ACCEPTED.
        // Ideally, we might want to restrict to a specific batch if the session is tied to one,
        // but for now, we'll check global IQC status as per previous logic.
        const iqcCheck = await pool.query(
            "SELECT * FROM iqc_components WHERE barcode = $1 AND status = 'ACCEPTED' ORDER BY scanned_at DESC LIMIT 1",
            [barcode]
        );

        if (iqcCheck.rows.length === 0) {
            return res.status(400).json({ error: 'PCB not found in IQC or not ACCEPTED' });
        }

        // 2. Check for Duplicate in Current Session
        const duplicateCheck = await pool.query(
            'SELECT * FROM impedance_scans WHERE session_id = $1 AND barcode = $2',
            [session_id, barcode]
        );

        if (duplicateCheck.rows.length > 0) {
            return res.status(409).json({ error: 'Duplicate scan! PCB already scanned in this session.' });
        }

        // 3. Record Scan
        const newScan = await pool.query(
            'INSERT INTO impedance_scans (session_id, barcode, status, remarks) VALUES ($1, $2, $3, $4) RETURNING *',
            [session_id, barcode, status || 'ACCEPTED', remarks]
        );

        res.status(201).json(newScan.rows[0]);
    } catch (error) {
        console.error('Error scanning PCB:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Get Recent Sessions
export const getSessions = async (req: Request, res: Response) => {
    try {
        const result = await pool.query(`
            SELECT s.*, 
            (SELECT COUNT(*)::int FROM impedance_scans sc WHERE sc.session_id = s.id) as scan_count,
            b.batch_number
            FROM impedance_sessions s
            LEFT JOIN iqc_batches b ON s.batch_id = b.id
            ORDER BY s.started_at DESC
            LIMIT 50
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching sessions:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Get Scans for a Session
export const getSessionScans = async (req: Request, res: Response) => {
    const { session_id } = req.params;
    try {
        const result = await pool.query(
            'SELECT * FROM impedance_scans WHERE session_id = $1 ORDER BY scanned_at DESC',
            [session_id]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching session scans:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
