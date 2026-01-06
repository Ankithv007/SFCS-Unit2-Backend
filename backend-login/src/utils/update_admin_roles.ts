import { pool } from '../config/db';

const updateAdminRoles = async () => {
    try {
        console.log('Updating Admin Roles...');

        // 1. Update Ankith
        const ankithResult = await pool.query(`
            UPDATE users 
            SET role = 'Super Admin' 
            WHERE email = 'ankithbvsrvm@gmail.com'
            RETURNING *;
        `);

        if (ankithResult.rows.length > 0) {
            console.log(`✅ Updated Ankith (ankithbvsrvm@gmail.com) to Super Admin.`);
        } else {
            console.log(`⚠️ User 'ankithbvsrvm@gmail.com' not found.`);
        }

        // 2. Update Admin@007 (Checking Name or Email)
        const admin007Result = await pool.query(`
            UPDATE users 
            SET role = 'Super Admin' 
            WHERE name = 'Admin@007' OR email = 'Admin@007'
            RETURNING *;
        `);

        if (admin007Result.rows.length > 0) {
            console.log(`✅ Updated Admin@007 to Super Admin.`);
        } else {
            console.log(`⚠️ User 'Admin@007' not found.`);
        }

    } catch (error) {
        console.error('Error updating roles:', error);
    } finally {
        pool.end();
    }
};

updateAdminRoles();
