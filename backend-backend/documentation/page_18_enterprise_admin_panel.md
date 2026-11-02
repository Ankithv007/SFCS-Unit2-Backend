# Documentation: SMT Manufacturing Execution System (MES)

## PAGE 18: ENTERPRISE ADMIN PANEL

### 1. PAGE NAME
**Enterprise Admin Panel & User Directory**
*   **What is it?** This page documents the system's administrative control panel, which handles user registration, department assignments, and system-wide configurations.
*   **Why does it exist?** It provides a secure, postgres-backed dashboard for managing enterprise identities, access controls, and operational permissions.

---

### 2. BUSINESS PURPOSE
*   **Central Identity Management:** Standardizes employee credentials and line access rights, ensuring only authorized operators perform critical steps.
*   **Postgres-Only Truth:** Bypasses legacy web storage (localStorage), relying strictly on transactional database tables for user data integrity.
*   **What if it didn't exist?** Administrators would have to manually add and edit users through SQL terminal commands, risking data inconsistency.

---

### 3. USER ROLES
| Role | Permissions on this Page |
| :--- | :--- |
| **Operator / Supervisor** | No access. Accessing this route returns 403 Forbidden. |
| **Administrator** | Can view, create, and edit users and departments. |
| **Super Admin** | Full privileges including role permission assignments, purging users, and editing system page configurations. |

---

### 4. COMPLETE WORKFLOW
1.  **Authentication:** The Administrator logs into the system and is routed to the Admin Panel.
2.  **Navigation:** The administrator selects the User Management tab.
3.  **User Creation:** Inputs employee details: Employee Code (unique), Name, password, and optionally email and department.
4.  **Save Action:** The frontend posts the payload. The backend hashes the password using `bcrypt` and writes to the DB.
5.  **Soft Deletion:** Removing a user sets `is_deleted = true`, preserving the row in postgres for audit references.

---

### 5. UI SECTION EXPLANATION
*   **Administrative Workspace:** A clean, tabbed panel containing:
    *   *User Directory:* Lists active users with search inputs.
    *   *Department Configurations:* Settings to create and map production departments.
    *   *Security / Permissions Grid:* Interface to map permission keys.
*   *Note: Redundant migration banners, localStorage backup alerts, and legacy migration triggers have been removed.*

---

### 6. DATABASE DESIGN
#### Table: `users`
*   `id` (SERIAL PRIMARY KEY)
*   `employee_code` (VARCHAR UNIQUE NOT NULL)
*   `name` (VARCHAR NOT NULL)
*   `email` (VARCHAR - Optional / Nullable)
*   `password_hash` (VARCHAR NOT NULL)
*   `role_id` (INT REFERENCES `roles`)
*   `department_id` (INT REFERENCES `departments`)
*   `is_active` (BOOLEAN DEFAULT true)
*   `is_deleted` (BOOLEAN DEFAULT false)
*   `deleted_at` (TIMESTAMP)
*   `version` (INT DEFAULT 1) - Used for optimistic concurrency control.
*   `created_at` / `updated_at` (TIMESTAMP)

#### Table: `departments`
*   `id` (SERIAL PRIMARY KEY)
*   `name` (VARCHAR UNIQUE NOT NULL)
*   `description` (TEXT)
*   `is_deleted` (BOOLEAN DEFAULT false)

---

### 7. BACKEND LOGIC
*   **Controller:** `backend-login/src/controllers/adminController.ts`
*   **Logic:**
    *   Enforces input validation on employee code uniqueness.
    *   Performs password salting and hashing.
    *   Uses optimistic concurrency checks: updates check `version` match, returning 409 Conflict if modified elsewhere.

---

### 8. FRONTEND LOGIC
*   **React Hook:** `src/hooks/useAdminPanel.ts`
*   **Page Component:** `src/pages/admin/AdminPanel.tsx`
*   **Features:**
    *   Bypasses client-side storage completely.
    *   Manages React states for active users list, pagination, and modals.

---

### 9. STATUS FLOW
1.  **Active:** User is enabled and can log into SMT line stations.
2.  **Inactive:** Login disabled temporarily.
3.  **Deleted (Soft Deleted):** Login disabled and marked deleted. Historical scans remain linked to this user's ID.

---

### 10. VALIDATION RULES
*   **Code Unique constraint:** Employee code cannot exist twice.
*   **Optional Email:** Schema allows NULL or blank values for email, removing email address requirements.
*   **Optimistic Concurrency:** Updates must send the record's current `version`.

---

### 11. AUDIT TRAIL / TRACEABILITY
*   **Change Log:** Updates to users, departments, and permission roles write audit rows to `admin_audit_logs`.
*   **Deletes:** Preserved in database with `deleted_at` timestamps for historical accountability.

---

### 12. ERROR SCENARIOS
*   **Duplicate Code:** Registering an existing employee code. *System Alert: "Employee code is already in use."*
*   **Concurrency conflict:** Two admins updating same user simultaneously. *System Alert: "Record modified by another administrator. Please refresh."*

---

### 13. REAL-TIME INDUSTRY SCENARIO
An SMT operator forgets their password during a shift change. They report to the supervisor. The supervisor contacts the administrator, who opens the Admin Panel, searches for the operator's code `EMP-402`, enters a new temporary password, and clicks Save. The database updates immediately, and the operator logs in at their station.

---

### 14. DEVELOPMENT CHALLENGES
*   **Legacy Storage Migration:** Previously, user config data was stored locally in localstorage. Moving this securely to Postgres without wiping out records or interrupting production was critical.
*   **Solution:** Executed a structured migration script, validated matching data rows, and safely removed legacy controllers and banners.

---

### 15. FUTURE IMPROVEMENTS
*   **Single Sign-On (SSO):** Integrate authentication with corporate Active Directory / LDAP servers.

---

### 16. SIMPLE SUMMARY
*   **Explanation:** A PostgreSQL-backed user directory that handles account registration, department mappings, and password resets securely.
*   **Commits:** `4c8a17c`, `7ca016e`, `650d0fef`
