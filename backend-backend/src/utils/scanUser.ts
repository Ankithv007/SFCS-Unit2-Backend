/**
 * Checks whether an identity string is valid and not a placeholder, mock, or dummy.
 */
export const isValidIdentity = (val: any): boolean => {
    if (!val || typeof val !== 'string') return false;
    const trimmed = val.trim();
    if (trimmed.length === 0) return false;

    const lower = trimmed.toLowerCase();
    // Reject dummy, test, and placeholder identities
    if (
        lower === 'dummy@example.com' ||
        lower === 'dummy' ||
        lower === 'dummy user' ||
        lower === 'unknown@example.com' ||
        lower === 'unknown' ||
        lower === 'unknown user' ||
        lower === 'system' ||
        lower === 'null' ||
        lower === 'undefined' ||
        lower === 'n/a' ||
        lower === 'na' ||
        lower === '-' ||
        lower.includes('@example.com') ||
        lower.endsWith('example.com')
    ) {
        return false;
    }

    return true;
};

/**
 * Determines the Scanned By value from the trusted authenticated user context.
 * Strict resolution order:
 * 1. Verified Employee Code (e.g., 'VEP01120')
 * 2. Verified Employee Name (e.g., 'John Doe')
 * 3. Verified Employee Email (e.g., 'john.doe@velankani.com')
 * 
 * Never returns dummy@example.com or fabricates an identity.
 * Unverified client payload values in req.body are not trusted for audit compliance.
 */
export const determineScannedBy = (user?: any, _untrustedFallback?: string): string => {
    if (user && typeof user === 'object') {
        // 1. Prefer verified employee code (supporting snake_case, camelCase, and user_id from employees table)
        const empCode = user.employee_code || user.employeeCode || user.emp_code || user.user_id;
        if (isValidIdentity(empCode)) {
            return empCode.toString().trim();
        }

        // 2. Otherwise, use verified employee name
        const name = user.name || user.username || user.full_name || user.fullName;
        if (isValidIdentity(name)) {
            return name.toString().trim();
        }

        // 3. Otherwise, use verified employee email address
        const email = user.email || user.emailAddress;
        if (isValidIdentity(email)) {
            return email.toString().trim();
        }
    }

    // No valid verified identity could be determined from authentication context
    return '';
};

