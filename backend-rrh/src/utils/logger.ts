export const createLogger = (context: string) => {
    return {
        info: (msg: string) => console.log(`[${new Date().toISOString()}] [INFO] [${context}] ${msg}`),
        error: (msg: string) => console.error(`[${new Date().toISOString()}] [ERROR] [${context}] ${msg}`),
        warn: (msg: string) => console.warn(`[${new Date().toISOString()}] [WARN] [${context}] ${msg}`)
    };
};
