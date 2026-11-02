export const createLogger = (context: string) => {
    return {
        info: (msg: string, ...args: any[]) => console.log(`[${new Date().toISOString()}] [INFO] [${context}] ${msg}`, ...args),
        error: (msg: string, ...args: any[]) => console.error(`[${new Date().toISOString()}] [ERROR] [${context}] ${msg}`, ...args),
        warn: (msg: string, ...args: any[]) => console.warn(`[${new Date().toISOString()}] [WARN] [${context}] ${msg}`, ...args)
    };
};
