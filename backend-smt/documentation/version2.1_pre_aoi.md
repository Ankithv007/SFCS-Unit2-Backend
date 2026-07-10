# SMT Manufacturing Execution System (MES)

## VERSION 2.1: PRE AOI

### 1. Introduction
The Pre AOI (Automated Optical Inspection) page logs the inspection status of circuit boards after components have been placed, but before they enter the reflow oven. 

This inspection step is critical to identify component misalignments, missing parts, or polarity errors while the components can still be easily reworked. The primary users of this page are SMT operators, QA Inspectors, and Line Supervisors.

---

### 2. Business Purpose
Catching assembly errors before reflow soldering is key to reducing rework costs.
* **Cost Minimization:** Reworking a board before reflow takes seconds; repairing it after reflow is time-consuming and risks damaging the board.
* **Yield Optimization:** Identifying placement errors early helps engineers adjust placement machine programs.
* **Audit Trail Integrity:** Prevents unauthorized deletion of inspection records, preserving the history of board defects.
* **Process Compliance:** Ensures all inspected boards are recorded against an active, scheduled Work Order.

---

### 3. Previous Workflow (Version 2.0)
In Version 2.0, the Pre AOI page had several limitations:
* **Dropdown Selection Lag:** Selecting Work Orders required scrolling through long, unsorted lists, causing delays.
* **Unsecured Deletions:** Any user could delete inspection records, making it difficult for supervisors to trace yield rates.
* **Vague Feedback:** Error responses and warning alerts during deletion were generic.

---

### 4. What's New in Version 2.1
Version 2.1 introduces the standardized Work Order Selector and role-based security guards:
* **Standardized Work Order Selector:** Integrates the custom searchable combobox. Operators type any part of the Work Order ID or product name to quickly find the active order.
* **Prioritized Search Matching:** The selector dynamically sorts results, prioritizing exact matches and prefix matches at the top of the list.
* **Client-Side Delete Security Hardening:** Restricts the ability to delete inspection records strictly to the **Super Admin** role.
* **Clear Guard Notifications:** If an operator or supervisor attempts to delete a record, a polite Toast message appears: *"Only Super Admin is authorized to delete records. Please contact your Super Admin if this record needs to be deleted."*
* **Auto-expansion on Focus:** Clicking the search selector immediately displays all active options.

---

### 5. User Workflow
1. **Accessing the Module:** The operator logs into the SMT Portal and navigates to **SMT -> Pre AOI**.
2. **Selecting a Work Order:** The operator clicks the new **Work Order Number** search box.
3. **Fuzzy Searching:** The operator types the target ID (e.g. "17"). The system filters the list instantly, placing "WO2026061000017" at the top. The operator selects it.
4. **Scanning Barcodes:** The operator scans the PCB barcode. The system verifies status and records the entry.
5. **Handling Delete Requests:** If an inspection record was scanned in error and needs to be deleted:
   * A Super Admin must log in.
   * Clicking **Delete** removes the record.
   * If a standard operator clicks **Delete**, they are shown the warning Toast.

---

### 6. Benefits
* **Operator Benefits:** Faster search saves time and reduces selection errors.
* **Production Benefits:** Prevents line stoppages caused by duplicate or incorrect scan entries.
* **Supervisor Benefits:** Restricts destructive actions to admin-level staff, maintaining data security.
* **QA Benefits:** Ensures inspections are recorded against valid production runs.
* **Traceability Benefits:** Keeps inspection logs mapped directly to the parent Work Order ID.
* **Productivity Improvements:** Minimizes setup delays when starting new batches.
* **Error Reduction:** Search filtering prevents selecting the wrong product line.
* **Time Savings:** Reduces search time from minutes to milliseconds.
* **Ease of Use:** Sleek glassmorphic inputs make data entry straightforward.

---

### 7. User Experience Improvements
* **Easier to use:** The combobox behaves like a modern search engine, removing the need for manual list scrolling.
* **Faster:** Results filter dynamically as the operator types.
* **More consistent:** Dropdown styles match the global SMT design system.
* **More reliable:** Deletion blocks protect print count data from accidental clicks.
* **More user-friendly:** Informative error notifications guide operators on what step to take next.

---

### 8. Summary
Version 2.1 improves the Pre AOI module by introducing the unified `WorkOrderSelector` and security guards. Operators can configure printing runs with high accuracy, while print log data integrity is protected from unauthorized changes, ensuring clean traceability for every board built.
