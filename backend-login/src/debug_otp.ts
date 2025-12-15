import { pool } from './config/db';
import { sendEmail } from './utils/emailService';
import dotenv from 'dotenv';

dotenv.config();

const runDebug = async () => {
    console.log('--- Starting OTP Debug ---');

    // 1. Test DB Connection
    try {
        console.log('1. Testing DB Connection...');
        const res = await pool.query('SELECT NOW()');
        console.log('   DB Connected! Server time:', res.rows[0].now);
    } catch (err: any) {
        console.error('   ❌ DB Connection Failed:', err.message);
        process.exit(1);
    }

    // 2. Check email_otps table
    try {
        console.log('2. Checking email_otps table...');
        const res = await pool.query("SELECT to_regclass('public.email_otps')");
        if (res.rows[0].to_regclass) {
            console.log('   Table email_otps exists.');
        } else {
            console.error('   ❌ Table email_otps DOES NOT EXIST!');
        }
    } catch (err: any) {
        console.error('   ❌ Error checking table:', err.message);
    }

    // 3. Test Email Sending (Optional - change email to test)
    const testEmail = process.env.EMAIL_USER; // Send to self
    if (testEmail) {
        try {
            console.log(`3. Sending Test Email to ${testEmail}...`);
            await sendEmail(testEmail, 'OTP Debug Test', '<p>This is a test email from the debug script.</p>');
            console.log('   Email sending function executed (check inbox).');
        } catch (err: any) {
            console.error('   ❌ Email Sending Failed:', err.message);
        }
    } else {
        console.log('   Skipping email test (EMAIL_USER not set).');
    }

    console.log('--- Debug Finished ---');
    process.exit(0);
};

runDebug();
