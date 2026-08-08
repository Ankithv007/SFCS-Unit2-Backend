# Documentation: SMT Manufacturing Execution System (MES)

## PAGE 19: ENTERPRISE PERMISSION SYSTEM

### 1. PAGE NAME
**Dynamic Role-Based Access Control (RBAC) System**
*   **What is it?** This page documents the dynamic permission engine, which manages access rights across all system submodules (e.g. Printing, AOI, MSD Tracker, BOM Split).
*   **Why does it exist?** It replaces rigid, hardcoded user role checks (e.g., `role === 'SUPER_ADMIN'`) with database-configured, granular capability checks.

---

### 2. BUSINESS PURPOSE
*   **Granular Security:** Restricts capability to read, write, edit, delete, or export data at the individual module level.
*   **Administrative Flexibility:** Enables managers to customize role profiles (e.g. allowing operators to scan but preventing them from deleting batches).
*   **What if it didn't exist?** Any change in role authorization requirements would require modifying the backend code, rebuilds, and redeployment.

---

### 3. USER ROLES
| Role | Permissions on this Page |
| :--- | :--- |
| **User Roles (All)** | Access levels are dynamically fetched and evaluated by the route middlewares. |
| **Administrator / Super Admin** | Full access to modify the permission matrix mapping roles to system pages. |

---

### 4. COMPLETE WORKFLOW
1.  **Request Resource:** A user triggers an action (e.g., clicks "Delete Serial Batch").
2.  **Middleware Interception:** The router routes the request through the `requirePermission` middleware specifying the target module and required action (e.g., `requirePermission('smt_serial_number', 'can_delete')`).
3.  **Database Lookup:** The middleware resolves the user's `role_id` and checks the permissions matrix table.
4.  **Evaluation:**
    *   If the flag is `true`, execution proceeds to the controller.
    *   If the flag is `false`, it returns a 403 Forbidden response.
5.  **Frontend Sync:** The client application requests the dynamic permissions schema upon login, hiding unauthorized buttons from the operator interface.

---

### 5. UI SECTION EXPLANATION
*   **Permissions Matrix Grid:** Column headers display Roles (Operator, Inspector, Planner, Admin, Super Admin). Rows represent System Pages. Cells contain checkable flags:
    *   `View` (Read)
    *   `Create` (Insert)
    *   `Edit` (Update)
    *   `Delete` (Delete)
    *   `Export` (Report download)

---

### 6. DATABASE DESIGN
#### Table: `roles`
*   `id` (SERIAL PRIMARY KEY)
*   `name` (VARCHAR UNIQUE)
*   `description` (TEXT)

#### Table: `system_pages`
*   `id` (SERIAL PRIMARY KEY)
*   `page_key` (VARCHAR UNIQUE) - e.g., `smt_work_order`, `bom_split`, `smt_downtime`
*   `display_name` (VARCHAR)
*   `description` (TEXT)
*   `category` (VARCHAR) - e.g., `SMT Line`, `Inventory`, `Admin`
*   `default_permissions` (JSONB)

#### Table: `role_permissions`
*   `id` (SERIAL PRIMARY KEY)
*   `role_id` (INT REFERENCES `roles` ON DELETE CASCADE)
*   `page_id` (INT REFERENCES `system_pages` ON DELETE CASCADE)
*   `can_view` / `can_create` / `can_edit` / `can_delete` / `can_export` (BOOLEAN DEFAULT false)

---

### 7. BACKEND LOGIC
*   **Middlewares:** `requirePermission(pageKey, action)` (found in `backend-smt/src/middleware/authMiddleware.ts` and login submodules).
*   **Dynamic Registry Seeding:** Database migrations automatically seed active system pages (like `bom_split` or `smt_downtime_records`) into the `system_pages` table and append default permissions.

---

### 8. FRONTEND LOGIC
*   **Component:** Permissions Grid inside `src/pages/admin/AdminPanel.tsx`.
*   **State Control:** Queries permissions array and renders checkable grids. Modifying checkboxes sends a PUT request to update authorization states.

---

### 9. STATUS FLOW
1.  **Authorized:** Access request matches dynamic boolean flag. Route completes.
2.  **Forbidden:** Access request fails evaluation. Access is blocked.

---

### 10. VALIDATION RULES
*   **Integrity Checks:** Foreign key constraints prevent orphans (e.g. roles cannot have permissions mapped to non-existent system pages).
*   **Cascade Delete:** Deleting a role or system page automatically drops matching permissions.

---

### 11. AUDIT TRAIL / TRACEABILITY
*   **Registry Logs:** DB migration inserts are tracked.
*   **Administrative Edits:** Any modification to role permissions writes an entry to `admin_audit_logs`, tracking the administrator who performed the update.

---

### 12. ERROR SCENARIOS
*   **Access Denied:** User role has no view authorization for BOM Split. *System Alert: "Access Denied: Insufficient permissions."*
*   **Expired Session:** JWT signature fails validation. *System Alert: "Session expired, please login again."*

---

### 13. REAL-TIME INDUSTRY SCENARIO
To prepare for a ISO quality audit, the plant manager decides that only the Quality Inspector role should be allowed to delete inspections. The Admin accesses the Admin Panel, pulls up the `Inspector` column, locates the `smt_printing` row, and unchecks `Delete`. The change commits immediately. Operators on the floor instantly lose their delete capability, securing audit integrity.

---

### 14. DEVELOPMENT CHALLENGES
*   **Avoid Breaking Defaults:** Deploying dynamic permissions on existing installations risked locking out active operators.
*   **Solution:** Built a multi-step migration (`003` & `004`) that checks for existing user roles, constructs the mapping tables, and executes a massive UPSERT script seeding default `true` permissions to preserve original access configurations.

---

### 15. FUTURE IMPROVEMENTS
*   **Temporal Permissions:** Support auto-expiry of elevated permissions (e.g., temporarily granting Supervisor access to a Line Operator for 8 hours).

---

### 16. SIMPLE SUMMARY
*   **Explanation:** A dynamic authorization database system that checks user role capabilities on every SMT route request, replacing hardcoded role validation.
*   **Commits:** `ec8c713`, `c2da906`, `22ce649`
