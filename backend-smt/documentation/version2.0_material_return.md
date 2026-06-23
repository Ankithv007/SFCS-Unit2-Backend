# Documentation: SMT Material Return

## VERSION 2.0: MATERIAL RETURN

### 1. PAGE NAME & PATH
**Material Return (SMT - Version 2.0)**
*   **Path:** `SMT -> Material Mgmt -> Material Return` (`/smt/material-management/return`)
*   **What is it?** This page controls the return of surplus or unused raw components from SMT line production back to the main warehouse inventory.

---

### 2. BUSINESS PURPOSE
*   **Production Clean-up:** Accounts for leftover parts after a production run is complete or closed.
*   **Audit Compliance:** Verifies that returned parts match quantities issued minus actual PCB utilization (scrap/wastage).
*   **Loss Tracking:** Compares requested versus returned values to locate discrepancies.

---

### 3. USER ROLES
| Role | Permissions on this Page |
| :--- | :--- |
| **SMT Operator / Lead** | Select eligible work orders, enter return counts, edit component-level remarks. |
| **Warehouse Inspector** | Validate quantities, accept return loads, update status. |
| **Super Admin** | Administrative rights including record deletion. |

---

### 4. COMPLETE WORKFLOW
1.  **Eligibility Filter:** The dropdown only displays SMT Work Orders with a completed/closed Material Request.
2.  **Duplicate Prevention:** Database checks prevent duplicate records: only one Return record is permitted per Material Request (`UNIQUE(material_management_id)`). If a record exists, the operator edits the existing form.
3.  **BOM Population:** Opens a snap-view of the BOM based on the source Material Request's active quantities.
4.  **Quantity entry & Validation:**
    *   Operators input the returned amount.
    *   System checks `Return Qty <= Issued Qty`. Values exceeding this limit trigger styling alerts and prevent submission.
5.  **Row Remarks Modal:**
    *   Rather than standard narrow inputs, operators edit remarks inside a dedicated popup modal.
    *   The row button displays `Edit Remark` or `View/Edit Remark` depending on status.
6.  **Saving changes:** Updates `material_return_items` on save.
7.  **Status Flow:** Planners transition return files through:
    `DRAFT` ──> `ACTIVE` ──> `COMPLETED` ──> `CLOSED`

---

### 5. UI SECTION EXPLANATION
*   **Material Return Dashboard Grid:** Rebuilt in Version 2.0 by removing redundant `Created By` and `Updated At` columns to maximize space.
*   **Remarks Modal Overlay:** An intuitive modal popup with a scrollable textarea for entering long remarks for individual components.
*   **Validation warnings:** Highlights input boxes in red if return quantities exceed issued quantities.

---

### 6. DATABASE DESIGN
**Table Name:** `material_return`

| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | UUID (PK) | Unique return record ID |
| `material_management_id`| UUID (UNIQUE) | Source Material Request ID (Enforces 1-to-1) |
| `work_order_id` | VARCHAR(255) | Work Order ID reference |
| `status` | VARCHAR(50) | `DRAFT`, `ACTIVE`, `COMPLETED`, `CLOSED` |

**Table Name:** `material_return_items`

| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | UUID (PK) | Row ID |
| `material_return_id` | UUID | Parent return record ID |
| `material_management_item_id`| UUID | Associated Material Request BOM Item |
| `return_qty` | NUMERIC | Real returned count |
| `remarks` | TEXT | Item comment |

---

### 7. BACKEND LOGIC (API)
*   **Endpoints:**
    *   `GET /api/smt/material-return/records` - Fetch return records.
    *   `POST /api/smt/material-return/create` - Check duplicate, fetch MM info, map and create return.
    *   `GET /api/smt/material-return/records/:id/export/excel` - Export Material Return report.
*   **Dynamic Delta:** Deltas are computed live: `Delta = Issued Qty - Return Qty`.

---

### 8. FRONTEND LOGIC
*   **React Memoization:** `BomRow` component prevents input lag in large grids.
*   **Modal State:** Tracks active rows for comment edits, saving changes directly to state.

---

### 9. EXCEL EXPORT FORMAT
*   **Sheet Layout:** Single sheet named `Material BOM Details`.
*   **Metadata Block (Rows 1–9):** Displays Work Order Number, PO Number, Product Name, Original WO Qty, Production Quantity, Current BOM Revision, Status, Created By, and Created Date.
*   **Blank rows (Rows 10–11):** Visual separation.
*   **BOM Table (Row 12 onwards):** Headers: Sl No, VEPL Part No, Description, Manufacturer, Mfr. Part No, Qty / Product, Required Qty, Issued Qty, Return Qty, Delta, Remarks.
*   **Formatting Details:**
    *   Header: Dark blue fill (`FF1E3A8A`), white bold text, centered.
    *   Content columns: Column widths defined strictly (10 to 40). WrapText is enabled for Description, Manufacturer, Mfr. Part No, and Remarks.
    *   Alignment: Text is left-aligned, numbers are right-aligned with `#,##0.00` formatting, Sl No is centered.
    *   Borders: Solid thin light-gray gridlines around all cells.
    *   Auto row height: Expanded dynamically based on cell text length.
