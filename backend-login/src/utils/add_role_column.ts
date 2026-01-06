import { pool } from '../config/db';

const addRoleColumn = async () => {
    try {
        console.log('Adding role column to users table...');

        await pool.query(`
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'User';
        `);

        console.log('Successfully added role column.');

        // Optional: Update existing users to have 'User' role if it was null (though default handles new ones)
        await pool.query(`
            UPDATE users SET role = 'User' WHERE role IS NULL;
        `);
        console.log('Updated existing users to default role "User".');

    } catch (error) {
        console.error('Error adding role column:', error);
    } finally {
        pool.end();
    }
};

addRoleColumn();
