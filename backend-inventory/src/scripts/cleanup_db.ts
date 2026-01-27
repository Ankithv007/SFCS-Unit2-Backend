import { Pool } from 'pg';

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'inventory_db',
    password: 'root',
    port: 5432,
});

const tablesToDrop = [
    'impedance_batches',
    'impedance_test_results',
    'qc_inspections',
    'impedance_scans',
    'impedance_sessions',
    'qc_unit_inspection',
    'qc_unit_tpns',
    'qc_unit_pns',
    'qc_inspection_checklist_result',
    'warehouse_batches',
    'warehouse_scans',
    'shifts',
    'iqc_batches',
    'iqc_components'
];

async function dropTables() {
    try {
        for (const table of tablesToDrop) {
            try {
                await pool.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
                console.log(`Dropped table: ${table}`);
            } catch (err) {
                console.error(`Error dropping table ${table}:`, err);
            }
        }
        console.log('Cleanup complete.');
    } catch (err) {
        console.error('Error during cleanup:', err);
    } finally {
        await pool.end();
    }
}

dropTables();
