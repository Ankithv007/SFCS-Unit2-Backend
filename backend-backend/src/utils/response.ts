import { Response } from 'express';

export const sendSuccess = (res: Response, message: string, data: any = {}, status: number = 200) => {
    return res.status(status).json({
        success: true,
        message,
        data
    });
};

export const sendError = (res: Response, message: string, status: number = 400) => {
    // Mask raw database errors for security and user experience
    let userMessage = message;
    
    const isDbError = /violates foreign key|violates check constraint|violates unique constraint|syntax error|relation .* does not exist/i.test(message);
    
    if (isDbError) {
        console.error("[DATABASE_ERROR_MASKED]:", message);
        userMessage = "Stage transition failed. Please contact administrator.";
    }

    return res.status(status).json({
        success: false,
        message: userMessage
    });
};
