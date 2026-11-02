import { spawnSync } from 'child_process';
import path from 'path';

const testFiles = [
    'tests/health.test.ts',
    'tests/workOrderCanonical.test.ts',
    'tests/transactionSafety.test.ts',
    'tests/archivalLossless.test.ts',
    'tests/stagePipeline.test.ts'
];

console.log('================================================================');
console.log('   SFCS RRH MICROSERVICE - PRODUCTION AUTOMATED TEST HARNESS    ');
console.log('================================================================\n');

let allPassed = true;

for (const file of testFiles) {
    console.log(`>>> Running Suite: ${file}`);
    const proc = spawnSync('npx', ['ts-node', file], {
        stdio: 'inherit',
        shell: true
    });
    if (proc.status !== 0) {
        allPassed = false;
        console.error(`FAILED: ${file} exited with code ${proc.status}\n`);
    } else {
        console.log(`PASSED: ${file}\n`);
    }
}

if (!allPassed) {
    console.error('CRITICAL: One or more test suites failed!');
    process.exit(1);
} else {
    console.log('================================================================');
    console.log('ALL INTEGRATION TEST SUITES PASSED SUCCESSFULLY! (100%)');
    console.log('================================================================');
    process.exit(0);
}
