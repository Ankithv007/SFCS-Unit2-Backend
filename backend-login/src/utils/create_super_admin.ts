import { pool } from '../config/db';
import bcrypt from 'bcrypt';

const createSuperAdmin = async () => {
    try {
        console.log('Creating Super Admin User...');

        const name = 'Admin';
        const email = 'admin@sfcs.com'; // Using a valid email format
        const password = 'Admin@007';
        const role = 'Super Admin';

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Check if exists
        const check = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

        if (check.rows.length > 0) {
            console.log('User already exists. Updating role and password...');
            await pool.query(`
                UPDATE users 
                SET role = $1, password = $2, status = 'active', is_verified = TRUE, name = $3
                WHERE email = $4
            `, [role, hashedPassword, name, email]);
        } else {
            console.log('Creating new user...');
            await pool.query(`
                INSERT INTO users (name, email, password, role, status, is_verified)
                VALUES ($1, $2, $3, $4, 'active', TRUE)
            `, [name, email, hashedPassword, role]);
        }

        console.log(`✅ Super Admin created successfully!`);
        console.log(`📧 Email: ${email}`);
        console.log(`🔑 Password: ${password}`);

    } catch (error) {
        console.error('Error creating super admin:', error);
    } finally {
        pool.end();
    }
};

createSuperAdmin();
