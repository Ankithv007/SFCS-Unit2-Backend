const { Pool } = require('pg');

async function test() {
    const pool = new Pool({
        user: 'postgres',
        host: 'db',
        database: 'sfcs_auth',
        password: 'root',
        port: 5432,
    });

    try {
        const depts = await pool.query("SELECT * FROM departments");
        console.log('DEPARTMENTS:');
        console.table(depts.rows);

        const deptUsers = await pool.query("SELECT * FROM department_users");
        console.log('DEPARTMENT USERS:');
        console.table(deptUsers.rows);
    } catch(e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
test();
