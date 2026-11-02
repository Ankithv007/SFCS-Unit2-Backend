export const createLogger = (serviceName: string) => {
    const prefix = `[${serviceName.toUpperCase()}]`;

    return {
        info: (message: string, ...args: any[]) => {
            console.log(`${prefix} ${message}`, ...args);
        },
        error: (message: string, ...args: any[]) => {
            console.error(`${prefix} ERROR: ${message}`, ...args);
        },
        warn: (message: string, ...args: any[]) => {
            console.warn(`${prefix} WARNING: ${message}`, ...args);
        }
    };
};
