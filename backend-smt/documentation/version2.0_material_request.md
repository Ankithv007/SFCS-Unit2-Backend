# Documentation: SMT Material Requests

## VERSION 2.0: MATERIAL REQUESTS

### 1. PAGE NAME & PATH
**Material Requests (SMT - Version 2.0)**
*   **Path:** `SMT -> Material Mgmt -> Material Requests` (`/smt/material-management/requests`)
*   **What is it?** This page initiates component requests from the warehouse for active SMT production runs based on approved BOM layouts.

---

### 2. BUSINESS PURPOSE
*   **Controlled component dispatching:** Standardizes material issues, preventing floor operators from retrieving excess or incorrect parts from raw stock.
*   **Wastage Control:** Tracks required quantity versus issued quantity to establish a clear audit log of component utilization.
*   **Traceability:** Tagged with the operator context (Employee ID and Name) through the `BackendAuthContext` token.

---

### 3. USER ROLES
| Role | Permissions on this Page |
| :--- | :--- |
| **Production Planner** | Create new requests, map them to work orders/QMS, and edit quantities. |
| **Warehouse Manager** | View open requests, update the "Issued Quantity" column, and approve status transitions. |
| **Super Admin** | Full access, including deletion of draft requests. |
| **Operator** | View-only access to verify active component issues. |

---

### 4. COMPLETE WORKFLOW
1.  **Selection:** Planners select an active SMT Work Order and its approved QMS master record.
2.  **Creation:** The system reads the QMS BOM items list and initializes a Material Request in `DRAFT` status.
3.  **Component Issuance:** Warehouse staff edit the **Issued Qty** column as components are physically retrieved.
4.  **BOM Synchronization:** If the QMS BOM changes, clicking the **Sync BOM** button imports new component items without wiping previous issue data.
5.  **Audit Logs:** Every change to the Issued Qty logs a history entry detailing the operator name, previous values, and new values.
6.  **Status Flow:** Planners transition the request status through:
    `DRAFT` ──> `ACTIVE` ──> `COMPLETED` ──> `CLOSED`

---

### 5. UI SECTION EXPLANATION
*   **BOM Grid Workspace:** Displays detailed component cards with search filters for VEPL Part No or Manufacturer.
*   **Sync BOM Button:** Located in the workspace header, pulls newer revisions dynamically.
*   **Alternating Status Actions:** Allows moving records to `ACTIVE` to lock draft edits, or `COMPLETED`/`CLOSED` once fully issued.

---

### 6. DATABASE DESIGN
**Table Name:** `material_management`

| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | UUID (PK) | Unique identifier |
| `work_order_id` | VARCHAR(255) | Link to `smt_work_orders` |
| `qms_id` | INTEGER | Link to QMS Master configuration |
| `status` | VARCHAR(50) | `DRAFT`, `ACTIVE`, `COMPLETED`, `CLOSED` |

**Table Name:** `material_management_items`

| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | UUID (PK) | Item ID |
| `material_management_id`| UUID | Linked request record (FK) |
| `vepl_part_no` | VARCHAR(255) | Component identifier |
| `required_qty` | NUMERIC | Calculated target requirement |
| `issued_qty` | NUMERIC | Real quantity issued from warehouse |
| `delta_qty` | NUMERIC | Computed as `Required - Issued` |

**Table Name:** `material_management_item_history`
*   Logs changes with: `material_management_item_id`, `previous_issued_qty`, `new_issued_qty`, `changed_by` (operator name), and `timestamp`.

---

### 7. BACKEND LOGIC (API)
*   **Endpoints:**
    *   `GET /api/smt/material-management/records` - Lists requests.
    *   `POST /api/smt/material-management/create` - Creates request.
    *   `POST /api/smt/material-management/records/:id/sync-bom` - Synchronizes BOM.
    *   `GET /api/smt/material-management/records/:id/export/excel` - Custom Excel export.

---

### 8. FRONTEND LOGIC
*   **Dynamic Deltas:** Delta is calculated dynamically: `Delta = Required Qty - Issued Qty`.
*   **Validation:** Negative issued quantities are blocked.

---

### 9. EXCEL EXPORT FORMAT
*   **Sheet Layout:** Single sheet named `Material BOM Details`.
*   **Metadata Block (Rows 1–9):** Displays Work Order Number, PO Number, Product Name, Original WO Qty, Production Quantity, Current BOM Revision, Status, Created By, and Created Date.
*   **Blank rows (Rows 10–11):** Clean visual separation.
*   **BOM Table (Row 12 onwards):** Headers: Sl No, VEPL Part No, Description, Manufacturer, Mfr. Part No, Qty / Product, Required Qty, Issued Qty, Delta.
*   **Formatting Details:**
    *   Header: Dark blue fill (`FF1E3A8A`), white bold text, centered.
    *   Content columns: Column widths defined strictly (10 to 40). WrapText is enabled for Description, Manufacturer, and Mfr. Part No to prevent clipping. 
    *   Alignment: Text is left-aligned, numbers are right-aligned with `#,##0.00` formatting, Sl No is centered.
    *   Borders: Solid thin light-gray gridlines around all cells.
    *   Auto-expanded row heights to avoid overlapping text.
