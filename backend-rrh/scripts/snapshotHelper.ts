import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';

const dbName = process.env.DB_NAME || 'rrh_restore_db';

if (!dbName.startsWith('rrh_')) {
    console.error(`FATAL: Safe guard triggered. Database must start with 'rrh_'. Received: ${dbName}`);
    process.exit(1);
}

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || process.env.POSTGRES_USER || 'postgres',
    password: process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD || '',
    database: dbName,
});

const RRH_TABLES = [
    'rrh_work_orders',
    'rrh_excel_imports',
    'rrh_excel_sheets',
    'rrh_excel_rows',
    'rrh_excel_cells',
    'rrh_excel_merged_cells',
    'rrh_inventory',
    'rrh_existing_inventory',
    'rrh_replaced_inventory',
    'rrh_inward_sessions',
    'rrh_inward_scans',
    'rrh_inward_session_master_consumption',
    'rrh_ivi_sessions',
    'rrh_ivi_inspections'
];

async function captureSnapshot(outputFilePath: string) {
    const client = await pool.connect();
    const results: string[] = [];

    try {
        results.push(`================================================================`);
        results.push(`DATABASE SNAPSHOT: ${dbName}`);
        results.push(`TIMESTAMP: ${new Date().toISOString()}`);
        results.push(`================================================================\n`);

        for (const tableName of RRH_TABLES) {
            const tableExists = await client.query(`
                SELECT 1 FROM information_schema.tables 
                WHERE table_schema = 'public' AND table_name = $1
            `, [tableName]);

            if (tableExists.rowCount === 0) {
                results.push(`TABLE: ${tableName} (DOES NOT EXIST)`);
                continue;
            }

            const countRes = await client.query(`SELECT COUNT(*)::text as cnt FROM "${tableName}"`);
            const rowCount = countRes.rows[0]?.cnt || '0';
            results.push(`TABLE: ${tableName} | ROW_COUNT: ${rowCount}`);

            const colRes = await client.query(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_schema = 'public' AND table_name = $1 
                ORDER BY ordinal_position ASC
            `, [tableName]);

            for (const col of colRes.rows) {
                const colName = col.column_name;
                const md5Res = await client.query(`
                    SELECT md5(string_agg(COALESCE("${colName}"::text, 'NULL_VAL'), ',' ORDER BY id)) AS col_md5 
                    FROM "${tableName}"
                `);
                const colHash = md5Res.rows[0]?.col_md5 || 'EMPTY_TABLE';
                results.push(`  COLUMN: ${tableName}.${colName} = ${colHash}`);
            }
            results.push('');
        }

        fs.writeFileSync(outputFilePath, results.join('\n'), 'utf8');
        console.log(`Snapshot successfully written to: ${outputFilePath}`);
    } finally {
        client.release();
    }
}

async function diffSnapshots(beforeFile: string, afterFile: string, diffOutputFile: string) {
    const beforeContent = fs.readFileSync(beforeFile, 'utf8');
    const afterContent = fs.readFileSync(afterFile, 'utf8');

    const beforeLines = beforeContent.split('\n').filter(l => l.startsWith('  COLUMN:') || l.startsWith('TABLE:'));
    const afterLines = afterContent.split('\n').filter(l => l.startsWith('  COLUMN:') || l.startsWith('TABLE:'));

    const beforeMap = new Map<string, string>();
    for (const line of beforeLines) {
        const [k, v] = line.split(' = ');
        if (k && v) beforeMap.set(k.trim(), v.trim());
    }

    const afterMap = new Map<string, string>();
    for (const line of afterLines) {
        const [k, v] = line.split(' = ');
        if (k && v) afterMap.set(k.trim(), v.trim());
    }

    const diffs: string[] = [];
    diffs.push(`================================================================`);
    diffs.push(`CHECKSUM DIFF REPORT`);
    diffs.push(`BEFORE: ${beforeFile}`);
    diffs.push(`AFTER:  ${afterFile}`);
    diffs.push(`================================================================\n`);

    let exactMatches = 0;
    let mismatches = 0;

    for (const [colKey, beforeHash] of beforeMap.entries()) {
        const afterHash = afterMap.get(colKey);
        if (!afterHash) {
            diffs.push(`[MISSING AFTER] ${colKey} existed in before (${beforeHash}) but missing in after`);
            mismatches++;
        } else if (beforeHash !== afterHash) {
            diffs.push(`[HASH MISMATCH] ${colKey} differs! BEFORE=${beforeHash} AFTER=${afterHash}`);
            mismatches++;
        } else {
            exactMatches++;
        }
    }

    for (const [colKey, afterHash] of afterMap.entries()) {
        if (!beforeMap.has(colKey)) {
            diffs.push(`[NEW COLUMN] ${colKey} = ${afterHash}`);
        }
    }

    diffs.push(`\nSUMMARY: ${exactMatches} columns EXACT MATCH, ${mismatches} mismatches.`);
    fs.writeFileSync(diffOutputFile, diffs.join('\n'), 'utf8');
    console.log(diffs.join('\n'));

    if (mismatches > 0) {
        process.exit(1);
    }
}

async function showMigrationsAndIndexes(outputFile: string) {
    const client = await pool.connect();
    const lines: string[] = [];
    try {
        lines.push(`================================================================`);
        lines.push(`SCHEMA MIGRATIONS TABLE`);
        lines.push(`================================================================`);
        const migRes = await client.query(`SELECT id, migration_name, checksum, execution_time_ms, run_at FROM schema_migrations ORDER BY id ASC`);
        lines.push(JSON.stringify(migRes.rows, null, 2));

        lines.push(`\n================================================================`);
        lines.push(`INDEXES ON RRH TABLES`);
        lines.push(`================================================================`);
        const idxRes = await client.query(`
            SELECT tablename, indexname, indexdef 
            FROM pg_indexes 
            WHERE schemaname = 'public' AND tablename LIKE 'rrh_%'
            ORDER BY tablename, indexname
        `);
        lines.push(JSON.stringify(idxRes.rows, null, 2));

        fs.writeFileSync(outputFile, lines.join('\n'), 'utf8');
        console.log(`Migrations and indexes written to: ${outputFile}`);
    } finally {
        client.release();
    }
}

async function main() {
    const mode = process.argv[2];
    if (mode === 'snapshot') {
        const out = process.argv[3] || 'snapshot.txt';
        await captureSnapshot(out);
    } else if (mode === 'diff') {
        const before = process.argv[3];
        const after = process.argv[4];
        const out = process.argv[5] || 'diff.txt';
        await diffSnapshots(before, after, out);
    } else if (mode === 'inspect') {
        const out = process.argv[3] || 'inspect.txt';
        await showMigrationsAndIndexes(out);
    } else {
        console.log('Usage: npx ts-node scripts/snapshotHelper.ts [snapshot <file> | diff <before> <after> <out> | inspect <file>]');
    }
    await pool.end();
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
