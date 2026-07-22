const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

async function run() {
    const pool = new Pool({
        user: 'postgres',
        host: 'db',
        database: 'sfcs_auth',
        password: 'root',
        port: 5432,
    });

    try {
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash('Admin@007', salt);
        console.log('Hashed password:', hash);

        const res = await pool.query('UPDATE users SET password = $1 WHERE email = $2 RETURNING id, name', [hash, 'deepak@gamai.com']);
        console.log('Update result:', res.rows);
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
run();
