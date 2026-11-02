import assert from 'assert';
import jwt from 'jsonwebtoken';
import { determineScannedBy, isValidIdentity } from '../src/utils/scanUser';
import { authenticateToken, AuthRequest } from '../src/middleware/authMiddleware';
import { ScanProcessingService } from '../src/services/scans/ScanProcessingService';
import { AuditService } from '../src/services/audit/AuditService';

async function runTests() {
    console.log('=== Running Production Audit Identity Tests ===\n');

    // 1. Test isValidIdentity filtering
    console.log('1. Testing isValidIdentity filter:');
    assert.strictEqual(isValidIdentity('dummy@example.com'), false, 'dummy@example.com must be invalid');
    assert.strictEqual(isValidIdentity('dummy'), false, 'dummy must be invalid');
    assert.strictEqual(isValidIdentity('Dummy User'), false, 'Dummy User must be invalid');
    assert.strictEqual(isValidIdentity('unknown@example.com'), false, 'unknown@example.com must be invalid');
    assert.strictEqual(isValidIdentity('test@example.com'), false, '@example.com must be invalid');
    assert.strictEqual(isValidIdentity('system'), false, 'system must be invalid');
    assert.strictEqual(isValidIdentity(''), false, 'empty string must be invalid');
    assert.strictEqual(isValidIdentity('   '), false, 'whitespace must be invalid');
    assert.strictEqual(isValidIdentity(null), false, 'null must be invalid');
    assert.strictEqual(isValidIdentity(undefined), false, 'undefined must be invalid');
    assert.strictEqual(isValidIdentity('VEP01120'), true, 'VEP01120 must be valid');
    assert.strictEqual(isValidIdentity('Ankith'), true, 'Ankith must be valid');
    assert.strictEqual(isValidIdentity('ankith@velankani.com'), true, 'Real email must be valid');
    console.log('  ✓ isValidIdentity correctly rejects all dummy/placeholder values and accepts valid identities.');

    // 2. Precedence: Employee Code > Name > Email
    console.log('\n2. Testing identity resolution precedence:');
    // Case A: Employee code present
    const userWithAll = {
        employee_code: 'VEP01120',
        name: 'John Doe',
        email: 'john.doe@velankani.com'
    };
    assert.strictEqual(determineScannedBy(userWithAll), 'VEP01120', 'Should prefer employee_code when present');
    console.log('  ✓ (Code > Name > Email): Resolved to employee code "VEP01120"');

    // Case B: Employee code missing, Name present
    const userWithName = {
        employee_code: null,
        name: 'Jane Smith',
        email: 'jane.smith@velankani.com'
    };
    assert.strictEqual(determineScannedBy(userWithName), 'Jane Smith', 'Should use name when employee_code is absent');
    console.log('  ✓ (Name > Email): Resolved to verified name "Jane Smith"');

    // Case C: Employee code and Name missing, Email present
    const userWithEmailOnly = {
        employee_code: null,
        name: '',
        email: 'operator@velankani.com'
    };
    assert.strictEqual(determineScannedBy(userWithEmailOnly), 'operator@velankani.com', 'Should use email when code and name are absent');
    console.log('  ✓ (Email fallback): Resolved to email "operator@velankani.com"');

    // Case D: Dummy email in context
    const userWithDummy = {
        employee_code: null,
        name: 'Dummy User',
        email: 'dummy@example.com'
    };
    assert.strictEqual(determineScannedBy(userWithDummy), '', 'Dummy email and name must never be returned');
    console.log('  ✓ Dummy user in context is rejected (returns empty string)');

    // Case E: Impersonation test - client sends arbitrary scanned_by in payload
    assert.strictEqual(
        determineScannedBy(userWithAll, 'HACKER_ATTEMPT'),
        'VEP01120',
        'Should ignore client payload fallback and preserve authenticated identity'
    );
    console.log('  ✓ Client cannot impersonate another employee by modifying request fields');

    // Case F: Missing identity
    assert.strictEqual(determineScannedBy(null), '', 'Null user must return empty string');
    assert.strictEqual(determineScannedBy({}), '', 'Empty user object must return empty string');
    console.log('  ✓ Missing identity never produces a fabricated or dummy identity');

    // 3. Test authenticateToken middleware
    console.log('\n3. Testing authenticateToken middleware:');
    const secret = process.env.JWT_SECRET || 'sfcs_unit2_secure_jwt_secret_2026_production_grade_99';

    // 3A: Unauthenticated request (no token, no X-Backend-User-Id)
    let status401Received = false;
    let json401Msg = '';
    const fakeReqUnauth: any = {
        headers: {},
        query: {}
    };
    const fakeResUnauth: any = {
        status: (code: number) => {
            if (code === 401) status401Received = true;
            return {
                json: (data: any) => { json401Msg = data.message; }
            };
        }
    };
    let nextCalledUnauth = false;
    await authenticateToken(fakeReqUnauth, fakeResUnauth, () => { nextCalledUnauth = true; });
    assert.strictEqual(status401Received, true, 'Unauthenticated request must receive 401 status');
    assert.strictEqual(nextCalledUnauth, false, 'Unauthenticated request must NOT proceed to next()');
    console.log('  ✓ Unauthenticated request rejected with HTTP 401: ' + json401Msg);

    // 3B: Valid JWT token with employee code
    const validToken = jwt.sign(
        { id: 42, employee_code: 'VEP01120', name: 'Real Operator', email: 'real@velankani.com', role: 'OPERATOR' },
        secret
    );
    const fakeReqAuth: any = {
        headers: { authorization: `Bearer ${validToken}` },
        query: {}
    };
    let nextCalledAuth = false;
    await authenticateToken(fakeReqAuth, {} as any, () => { nextCalledAuth = true; });
    assert.strictEqual(nextCalledAuth, true, 'Valid JWT request must proceed to next()');
    assert.strictEqual(fakeReqAuth.user.employee_code, 'VEP01120', 'Decoded user must have employee_code');
    assert.strictEqual(determineScannedBy(fakeReqAuth.user), 'VEP01120', 'Scanned by must resolve to VEP01120');
    console.log('  ✓ Valid JWT token decoded and resolved to employee code: "VEP01120"');

    // 4. Test ScanProcessingService and AuditService rejection of dummy / empty identities
    console.log('\n4. Testing ScanProcessingService & AuditService defense:');
    let scanProcessingBlocked = false;
    try {
        await ScanProcessingService.processStageScan('PTH', {
            work_order_id: 1,
            barcode: 'TEST-BARCODE',
            status: 'ACCEPTED',
            scanned_by: 'dummy@example.com'
        });
    } catch (err: any) {
        if (err.errorCode === 'UNAUTHENTICATED_SCAN') {
            scanProcessingBlocked = true;
        }
    }
    assert.strictEqual(scanProcessingBlocked, true, 'ScanProcessingService must block dummy@example.com');
    console.log('  ✓ ScanProcessingService blocked dummy@example.com with UNAUTHENTICATED_SCAN error');

    let auditServiceBlocked = false;
    try {
        await AuditService.logScanEvent('TEST-BARCODE', 1, 1, 'ACCEPTED', 'dummy@example.com');
    } catch (err: any) {
        if (err.message && err.message.includes('Audit violation')) {
            auditServiceBlocked = true;
        }
    }
    assert.strictEqual(auditServiceBlocked, true, 'AuditService must block dummy@example.com');
    console.log('  ✓ AuditService blocked dummy@example.com with Audit violation error');

    console.log('\n>>> ALL 11 TESTS PASSED SUCCESSFULLY! <<<');
}

runTests().then(() => {
    process.exit(0);
}).catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
