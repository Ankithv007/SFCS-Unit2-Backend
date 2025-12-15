import fetch from 'node-fetch';

const BASE_URL = 'http://127.0.0.1:5001/api/auth';
const TEST_EMAIL = 'test.signup.flow@velankanigroup.com';
const TEST_NAME = 'Test Signup Flow';

const runTest = async () => {
    console.log('--- Starting Signup Flow Simulation ---');

    // 1. Check Email
    console.log(`1. Checking email: ${TEST_EMAIL}`);
    try {
        const checkRes = await fetch(`${BASE_URL}/check-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: TEST_EMAIL })
        });
        const checkData = await checkRes.json();
        console.log('   Check Email Response:', checkRes.status, checkData);

        if (checkData.exists && checkRes.status === 409) {
            console.log('   Email exists (active). Cannot proceed with signup test.');
            return;
        }
    } catch (err: any) {
        console.error('   ❌ Check Email Failed:', err.message);
        return;
    }

    // 2. Request OTP
    console.log(`2. Requesting OTP for: ${TEST_EMAIL}`);
    try {
        const otpRes = await fetch(`${BASE_URL}/request-signup-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: TEST_NAME, email: TEST_EMAIL })
        });
        const otpData = await otpRes.json();
        console.log('   Request OTP Response:', otpRes.status, otpData);

        if (otpRes.ok) {
            console.log('   ✅ OTP Request Successful!');
        } else {
            console.error('   ❌ OTP Request Failed!');
        }
    } catch (err: any) {
        console.error('   ❌ Request OTP Failed:', err.message);
    }

    console.log('--- Simulation Finished ---');
};

runTest();
