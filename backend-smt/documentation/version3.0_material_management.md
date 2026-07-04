# Documentation: SMT Material Management (Unified)

## VERSION 3.0: UNIFIED WORKFLOW

### 1. PAGE NAME & PATH
**Material Management (SMT - Version 3.0)**
*   **Path:** `SMT -> Material Mgmt` (`/smt/material-management`)
*   **Work With BOM Path:** `/smt/material-management/bom-view/:id`
*   **What is it?** This consolidated page controls the entire lifecycle of SMT material management. Operators can select active work orders, view the BOM dashboard, and perform real-time continuous barcode scans for both Material Issue and Material Return from a single, unified view.

---

### 2. BUSINESS PURPOSE
*   **Single-Step Operations:** Eliminates split request/return interfaces. Operators manage issues and returns for a Work Order in one screen.
*   **Continuous Scanning:** Supports high-speed barcode scanning via the Global Material Scanner panel with Request/Return Lock modes.
*   **ACID Transaction Safety:** Uses full database transactions and row-level locking (`FOR UPDATE`) to prevent race conditions or incorrect quantities during concurrent scans.
*   **Accurate Delta Auditing:** Computes real-time issued/returned deltas and updates metrics immediately.

---

### 3. USER ROLES
| Role | Permissions on this Page |
| :--- | :--- |
| **SMT Operator / Lead** | Perform barcode scans, execute Material Return, and view status. |
| **Warehouse Manager / Planner** | Create Material Management records, sync BOM revisions, and transition statuses. |
| **Super Admin** | Full access, including record modifications and database locks management. |

---

### 4. COMPLETE WORKFLOW
1.  **Selection:** Operators navigate to `SMT -> Material Mgmt` and choose an active SMT Work Order.
2.  **Creation:** Planners create the Material Management record, generating the BOM table.
3.  **Work With BOM:** Opening the record details loads the BOM dashboard containing the Global Material Scanner.
4.  **Material Issuance (Request Mode):**
    - Set the lock mode to **Request Lock**.
    - Scan components continuously. Successfully scanned rows scroll into view and highlight in green for 2 seconds.
5.  **Material Return (Return Mode):**
    - Set the lock mode to **Return Lock**.
    - Scan components to process returns. System validates that the UID was previously issued before processing.
6.  **Real-Time Statistics:** The page updates **Total Request Scanned** and **Total Return Scanned** ratios live.
7.  **Excel Export:** Exports BOM data without Scan action buttons. It lists each UID and its associated quantities directly under the component row.

---

### 5. DATABASE DESIGN
**Table Name:** `material_management`
*   Represents the Work Order master record.

**Table Name:** `material_management_items`
*   Stores individual BOM rows with `required_qty`, `issued_qty`, `return_qty`, `delta_qty`, and `return_delta`.

**Table Name:** `issued_material_details`
*   Tracks individual issued UIDs, quantities, operator names, and timestamps.

**Table Name:** `returned_material_details`
*   Tracks returned UIDs, quantities, remaining balances, and timestamps.

---

### 6. BACKEND LOGIC (API)
*   `GET /api/smt/material-management/records` - Lists all records.
*   `POST /api/smt/material-management/create` - Initializes a new record.
*   `POST /api/smt/material-management/global-scan` - Centralized, backend-driven API for continuous Issue & Return barcode scans with transactional concurrency protection.
*   `GET /api/smt/material-management/records/:id/export/excel` - Unified Excel export formatting.

---

### 7. FRONTEND LOGIC & UX
*   **Global Scanner Panel:** Floating scan pane with auto-focus, action locks, status feedback, and quick keyboard interaction.
*   **Visual Highlights:** Uses high-performance state updates to scroll target rows into view and flash green CSS animations upon scan success.
*   **Dynamic Redirections:** Gracefully redirects legacy paths (`/requests` and `/return`) back to the unified routes.
