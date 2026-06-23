# Documentation: SMT Manufacturing Execution System (MES)

## VERSION 2.0: WORK ORDER MANAGEMENT

### 1. PAGE NAME
**Work Order Management (SMT - Version 2.0)**
*   **What is it?** This is the master control and entry point for all SMT production runs. It allows planners to register Work Orders, define priorities, assign lines, specify product parameters, and trace real-time execution.
*   **Why does it exist?** SMT manufacturing requires absolute traceability and structured schedules. This page establishes a formal "Work Order ID" that serves as the root container for all downline process tracking (Stencil Printing, SPI, Placement, Reflow, AOI, QC, and Rework).

---

### 2. BUSINESS PURPOSE
*   **Controlled Production:** Restricts operators from scanning or running unapproved/arbitrary jobs.
*   **Resource Allocation:** Helps scheduling by assigning priority (High, Medium, Low) and routing to specific physical lines (Line-1, Line-2, etc.).
*   **Operator Traceability:** Fully integrated with `BackendAuthContext` so that every created work order is tagged to the authenticated operator's Name and Employee Code.
*   **Preventing Waste:** Panel calculations are computed dynamically on the page to prevent operators from running the wrong number of panels, avoiding substrate wastage.

---

### 3. USER ROLES
| Role | Permissions on this Page |
| :--- | :--- |
| **Production Planner** | Full creation, modification of work order priorities, and line assignments. |
| **SMT Supervisor** | View work order lists, monitor real-time completion status, and review audit logs. |
| **Super Admin** | Administrative privileges, including deletion of draft/inactive work orders (highly restricted). |
| **Operator** | View-only dashboard visibility to see the current active queues. |

---

### 4. COMPLETE WORKFLOW
1.  **Authorization:** Operator logs into the SMT Portal. The token provides context about their identity.
2.  **Access:** Navigates to **SMT -> Document Process -> Work Order**.
3.  **Form Input:**
    *   **Work Order ID:** Formulated by prefixing the date with the custom sequence (e.g., `WO2026062000001`).
    *   **Line Assignment:** Dropdown selection for the target physical line.
    *   **Priority:** Choose from High (Critical), Medium (Standard), or Low (Flexible).
    *   **Product Definition:** Product Name and detailed description.
    *   **Quantity Setup:** Input target PCB count and PCBs per panel. The frontend dynamically computes Panel Quantity.
4.  **Submission & Validation:**
    *   Client checks that no negative values or empty inputs are submitted.
    *   Backend checks for unique constraint violations on the Work Order ID.
5.  **Database Persistence:** Inserts record to `smt_work_orders` with the operator audit stamps.
6.  **UI Refresh:** Grid automatically refreshes, displaying the new work order ready for downline processing.

---

### 5. UI SECTION EXPLANATION
*   **Work Order Registration Form:** Sleek, responsive layout utilizing standard components.
*   **Panel Multiplier calculator:** Automatically calculates `Panel Qty = Total Qty / PCB per Panel` to avoid human math errors.
*   **Active Work Orders Grid:** Modern grid with sorting, search filtering, and priority color-coded pills:
    *   `High`: Red Badge
    *   `Medium`: Yellow Badge
    *   `Low`: Blue Badge
*   **Traceability column:** Displays the user name of the creator (e.g., "Created by: Admin").

---

### 6. DATABASE DESIGN
**Table Name:** `smt_work_orders`

| Column | Type | Nullable | Description / Constraint |
| :--- | :--- | :--- | :--- |
| `id` | VARCHAR(255) | NO | Primary Key (Work Order ID) |
| `area_id` | VARCHAR(50) | NO | Set to `'SMT'` |
| `line_id` | VARCHAR(50) | NO | Targeted production line |
| `priority` | VARCHAR(20) | NO | High, Medium, Low |
| `product_name` | VARCHAR(255) | NO | Target assembly product name |
| `quantity` | INTEGER | NO | Total individual PCBs |
| `panel_quantity` | INTEGER | NO | Calculated panels |
| `status` | VARCHAR(50) | NO | Defaults to `'Created'` |
| `created_by` | VARCHAR(255) | YES | Captured operator identity |
| `created_at` | TIMESTAMP | YES | Creation date and time |

---

### 7. BACKEND LOGIC (API)
*   **Endpoint:** `POST /api/smt/work-orders`
*   **Controller:** `smtController.ts -> createWorkOrder`
*   **Security:** Middleware reads JWT, verifies role permissions, and decodes the user's name/code into `req.user`.
*   **Transaction Integrity:** Database inserts are wrapped in transactions. If downstream constraints are broken, it performs a complete rollback.

---

### 8. FRONTEND LOGIC
*   **State Hook:** React `useState` tracks fields.
*   **Automatic calculations:** React `useEffect` calculates panel values on target quantity/multiplier inputs.
*   **Form Reset:** Fields clear on successful submission, showing a toast notification.

---

### 9. STATUS FLOW
1.  **Created:** Work order is defined and registered.
2.  **Active:** First serial number or process setup starts scanning.
3.  **Completed:** Scanned output matches the targeted quantity.
4.  **Closed:** Archived for historic traceability.

---

### 10. AUDIT TRAIL / TRACEABILITY
*   Every work order is linked to a creator.
*   No anonymous records are allowed.
*   Modification dates are timestamped automatically.

---

### 11. DEVELOPMENT NOTES & ISSUES FIXED
*   **Traceability Fix:** Replaced generic system placeholders with operator names captured via `BackendAuthContext` token payload.
*   **Validation:** Negative numbers in quantities are blocked on the input fields.
