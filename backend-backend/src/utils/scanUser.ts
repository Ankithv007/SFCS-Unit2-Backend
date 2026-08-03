/**
 * Determines the Scanned By value from the authenticated user context.
 * Returns the Employee Code if available, otherwise Email Address, otherwise preserves existing fallback.
 */
export const determineScannedBy = (user: any, existingFallback?: string): string => {
    if (user) {
        // 1. Check employee_code (supporting both snake_case and camelCase)
        const empCode = user.employee_code || user.employeeCode;
        if (empCode && typeof empCode === 'string' && empCode.trim().length > 0) {
            return empCode.trim();
        }

        // 2. Check email
        const email = user.email || user.emailAddress;
        if (email && typeof email === 'string' && email.trim().length > 0) {
            return email.trim();
        }
    }

    // 3. Fallback to existing application behavior or default
    if (existingFallback && typeof existingFallback === 'string' && existingFallback.trim().length > 0) {
        return existingFallback.trim();
    }

    if (user) {
        const name = user.name || user.username || user.userId || user.user_id;
        if (name && typeof name === 'string' && name.trim().length > 0) {
            return name.trim();
        }
    }

    return 'system';
};
