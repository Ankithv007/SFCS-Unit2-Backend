import { Request, Response } from 'express';
import pool from '../config/db';
import bcrypt from 'bcryptjs';

export const getEmployees = async (req: Request, res: Response) => {
    try {
        const result = await pool.query('SELECT id, name, user_id, is_active FROM employees ORDER BY created_at DESC');
        res.status(200).json(result.rows);
    } catch (err) {
        console.error("Error fetching backend employees:", err);
        res.status(500).json({ error: "Failed to fetch employees" });
    }
};

export const createEmployee = async (req: Request, res: Response) => {
    const { name, user_id, password } = req.body;
    try {
        const salt = await bcrypt.genSalt(5);
        const hashedPassword = await bcrypt.hash(password, salt);

        const result = await pool.query(
            'INSERT INTO employees (name, user_id, password) VALUES ($1, $2, $3) RETURNING id, name, user_id, is_active',
            [name, user_id, hashedPassword]
        );
        res.status(201).json(result.rows[0]);
    } catch (err: any) {
        console.error("Error creating backend employee:", err);
        if (err.code === '23505') {
            return res.status(400).json({ error: "Employee code already exists" });
        }
        res.status(500).json({ error: "Failed to create employee" });
    }
};

export const updateEmployee = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { name, user_id, password } = req.body;
    try {
        if (password) {
            const salt = await bcrypt.genSalt(5);
            const hashedPassword = await bcrypt.hash(password, salt);
            await pool.query(
                'UPDATE employees SET name = $1, user_id = $2, password = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4',
                [name, user_id, hashedPassword, id]
            );
        } else {
            await pool.query(
                'UPDATE employees SET name = $1, user_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
                [name, user_id, id]
            );
        }
        res.status(200).json({ message: "Employee updated successfully" });
    } catch (err: any) {
        console.error("Error updating backend employee:", err);
        if (err.code === '23505') {
            return res.status(400).json({ error: "Employee code already exists" });
        }
        res.status(500).json({ error: "Failed to update employee" });
    }
};

export const toggleEmployeeStatus = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const result = await pool.query(
            'UPDATE employees SET is_active = NOT is_active, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING id, is_active',
            [id]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Employee not found" });
        }
        res.status(200).json(result.rows[0]);
    } catch (err) {
        console.error("Error toggling employee status:", err);
        res.status(500).json({ error: "Failed to toggle status" });
    }
};

export const deleteEmployee = async (req: Request, res: Response) => {
    const { id } = req.params;
    const userRole = (req as any).user?.role;
    const lowerRole = (userRole || '').toString().toLowerCase().replace(/\s/g, '');
    if (lowerRole !== 'admin' && lowerRole !== 'superadmin') {
        return res.status(403).json({ error: 'You do not have permission to delete this record.' });
    }
    try {
        const result = await pool.query('DELETE FROM employees WHERE id = $1 RETURNING *', [id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Employee not found" });
        }
        res.status(200).json({ message: 'Record deleted successfully.' });
    } catch (err) {
        console.error("Error deleting employee:", err);
        res.status(500).json({ error: "Failed to delete employee" });
    }
};

export const loginEmployee = async (req: Request, res: Response) => {
    const { userId, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM employees WHERE user_id = $1', [userId]);
        const employee = result.rows[0];

        if (!employee) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        const isMatch = await bcrypt.compare(password, employee.password);
        if (!isMatch) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        if (!employee.is_active) {
            return res.status(403).json({ error: "Account deactivated" });
        }

        // Do not return password hash
        const { password: _, ...employeeData } = employee;
        res.status(200).json({ message: "Login successful", employee: employeeData });
    } catch (err) {
        console.error("Error logging in backend employee:", err);
        res.status(500).json({ error: "Login failed" });
    }
};
