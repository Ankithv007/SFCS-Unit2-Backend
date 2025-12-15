import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const testEmail = async () => {
    console.log('--- Email Debugger ---');
    console.log(`Host: ${process.env.EMAIL_HOST}`);
    console.log(`Port: ${process.env.EMAIL_PORT}`);
    console.log(`Secure: ${process.env.EMAIL_SECURE}`);
    console.log(`User: ${process.env.EMAIL_USER}`);

    // Do not log password, but check if it exists
    if (!process.env.EMAIL_PASS) {
        console.error('ERROR: EMAIL_PASS is missing in .env');
        return;
    } else {
        console.log('Password: [PRESENT]');
    }

    const transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: Number(process.env.EMAIL_PORT),
        secure: process.env.EMAIL_SECURE === 'true',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
        },
        debug: true, // Enable low-level debug logs
        logger: true // Log to console
    });

    try {
        console.log('Attempting to verify connection...');
        await transporter.verify();
        console.log('✅ Connection Successful! Credentials are correct.');

        console.log('Attempting to send test email...');
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: process.env.EMAIL_USER, // Send to yourself
            subject: 'Test Email from Debugger',
            html: '<h1>It Works!</h1><p>Your email configuration is correct.</p>',
        });
        console.log('✅ Test Email Sent Successfully!');
    } catch (error: any) {
        console.error('❌ Connection Failed:', error.message);
        if (error.response) {
            console.error('Server Response:', error.response);
        }
    }
};

testEmail();
