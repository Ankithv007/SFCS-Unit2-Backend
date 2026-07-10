# SMT Manufacturing Execution System (MES)

## VERSION 2.1: MATERIAL MANAGEMENT

### 1. Introduction
The Material Management page is the central dashboard that tracks component issues and returns for SMT lines. 

Operators use this page to view active Bills of Materials (BOMs), verify component reel quantities, and run barcode scans for material allocation or returns. The primary users of this page are Warehouse Operators, Material Planners, and Line Supervisors.

---

### 2. Business Purpose
Effective material management is critical to prevent component mix-ups and track assembly costs.
* **Inventory Control:** Keeps track of raw components issued to lines and residual parts returned to stock.
* **BOM Compliance:** Restricts operators from issuing incorrect parts to a Work Order, preventing line defects.
* **Audit Trail Integrity:** Logs all scanning activities within each material run.
* **Process Compliance:** Ensures all material runs are registered against active Work Orders.

---

### 3. Previous Workflow (Version 2.0)
In Version 2.0, the Material Management page had several limitations:
* **Dropdown Selection Lag:** Selecting Work Orders required scrolling through long, unsorted lists, causing delays.
* **Vague Feedback:** Error responses during scan setups were generic.

---

### 4. What's New in Version 2.1
Version 2.1 introduces the standardized Work Order Selector:
* **Standardized Work Order Selector:** Integrates the custom searchable combobox. Operators type any part of the Work Order ID or product name to quickly find the active order.
* **Prioritized Search Matching:** The selector dynamically sorts results, prioritizing exact matches and prefix matches at the top of the list.
* **Auto-expansion on Focus:** Clicking the search selector immediately displays all active options.

---

### 5. User Workflow
1. **Accessing the Module:** The operator logs into the SMT Portal and navigates to **SMT -> Material Management**.
2. **Selecting a Work Order:** The operator clicks the new **Work Order Number** search box.
3. **Fuzzy Searching:** The operator types the target ID (e.g. "17"). The system filters the list instantly, placing "WO2026061000017" at the top. The operator selects it.
4. **Verifying BOM:** The system displays the target BOM. The operator reviews details.
5. **Scanning Reel Barcodes:** The operator scans component reels. The system verifies status and records the entry.
6. **Closing Session:** Once the target count is reached, the operator clicks **Close Session** to update records.

---

### 6. Benefits
* **Operator Benefits:** Faster search saves time and reduces selection errors.
* **Production Benefits:** Prevents line stoppages caused by incorrect scan entries.
* **Supervisor Benefits:** Ensures material issue/return logs are accurately associated with production batches.
* **QA Benefits:** Ensures component conformity for every run.
* **Traceability Benefits:** Keeps material logs mapped directly to the parent Work Order ID.
* **Productivity Improvements:** Minimizes setup delays when starting new runs.
* **Error Reduction:** Search filtering prevents selecting the wrong product line.
* **Time Savings:** Reduces search time from minutes to milliseconds.
* **Ease of Use:** Sleek glassmorphic inputs make data entry straightforward.

---

### 7. User Experience Improvements
* **Easier to use:** The combobox behaves like a modern search engine, removing the need for manual list scrolling.
* **Faster:** Results filter dynamically as the operator types.
* **More consistent:** Dropdown styles match the global SMT design system.
* **More reliable:** Auto-calculations ensure correct quantities.
* **More user-friendly:** Informative error notifications guide operators on what step to take next.

---

### 8. Summary
Version 2.1 improves the Material Management module by introducing the unified `WorkOrderSelector`. Operators can configure material runs with high accuracy, while print log data integrity is protected from unauthorized changes, ensuring clean traceability for every board built.
