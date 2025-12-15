export const getOtpEmailTemplate = (otp: string, purpose: string) => {
    const title = purpose === 'signup' ? 'Verify Your Account' : 'Reset Your Password';
    const message = purpose === 'signup'
        ? 'Welcome to Shop Floor Control System! Please use the code below to verify your email address.'
        : 'We received a request to reset your password. Use the code below to proceed.';

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body { font-family: Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
            .header { background: #1a1a1a; color: #ffffff; padding: 20px; text-align: center; }
            .content { padding: 30px; text-align: center; color: #333333; }
            .otp-box { background: #f0f0f0; font-size: 32px; font-weight: bold; letter-spacing: 5px; padding: 15px; margin: 20px 0; border-radius: 4px; display: inline-block; color: #000; }
            .footer { background: #f4f4f4; padding: 15px; text-align: center; font-size: 12px; color: #666666; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>${title}</h1>
            </div>
            <div class="content">
                <p>${message}</p>
                <div class="otp-box">${otp}</div>
                <p>This code will expire in 10 minutes.</p>
                <p>If you didn't request this, you can safely ignore this email.</p>
            </div>
            <div class="footer">
                &copy; ${new Date().getFullYear()} Velankani Group. All rights reserved.
            </div>
        </div>
    </body>
    </html>
    `;
};
