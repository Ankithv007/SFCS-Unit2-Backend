# SMT Manufacturing Execution System (MES)

## VERSION 2.1: STENCIL PRINTING

### 1. Introduction
The Stencil Printing page tracks the very first physical step on the SMT assembly line, where solder paste is applied to raw printed circuit boards (PCBs) through a precision stencil. 

Before mounting components, raw boards must be scanned at the printer entry. This page logs each panel's barcode and verifies that the associated chemical solder paste jar is fully thawed and mixed, and that the stencil revision is approved for the current job. The primary users of this page are SMT Line Operators, Quality Inspectors, and Line Supervisors.

---

### 2. Business Purpose
Ensuring correct solder paste application is critical for overall yield on the assembly line.
* **Process Compliance:** Restricts operators from using expired paste or unapproved stencils, preventing cold solder joints or smear defects.
* **Batch Verification:** Links every print run directly to an active Work Order, ensuring that the correct board revision is running on the line.
* **Material Waste Reduction:** Immediately flags if an operator attempts to run boards under an incorrect order, preventing material scrap.
* **Data Security:** Protects historical printing logs from unauthorized modification, ensuring that process records are preserved.

---

### 3. Previous Workflow (Version 2.0)
In Version 2.0, the Stencil Printing page relied on standard HTML select dropdowns for Work Order selection and lacked role-based security:
* **Dropdown Selection Lag:** Operators had to search through long dropdown lists containing hundreds of historical work orders, causing delays and errors.
* **Unsecured Deletions:** Any operator on the line could delete print scan records, making it difficult for quality supervisors to trace batch issues or calculate yields.
* **Vague Feedback:** Permission errors or warning alerts were generic, which confused operators when a delete request failed.

---

### 4. What's New in Version 2.1
Version 2.1 introduces the standardized Work Order Selector and role-based security guards:
* **Standardized Work Order Selector:** Integrates the custom searchable combobox. Operators type any part of the Work Order ID or product name to quickly find the active order.
* **Prioritized Search Matching:** The selector dynamically sorts results, prioritizing exact matches and prefix matches at the top of the list.
* **Client-Side Delete Security Hardening:** Restricts the ability to delete print scan records strictly to the **Super Admin** role.
* **Clear Guard Notifications:** If an operator or supervisor attempts to delete a print record, a polite Toast message appears: *"Only Super Admin is authorized to delete records. Please contact your Super Admin if this record needs to be deleted."*
* **Auto-expansion on Focus:** Clicking the search selector immediately displays all active options.

---

### 5. User Workflow
1. **Accessing the Module:** The operator logs into the SMT Portal and navigates to **SMT -> Stencil Printing**.
2. **Selecting a Work Order:** The operator clicks the new **Work Order Number** search box.
3. **Fuzzy Searching:** The operator types the target ID (e.g. "17"). The system filters the list instantly, placing "WO2026061000017" at the top. The operator selects it.
4. **Scanning Barcodes:** The operator scans the PCB panel barcode, paste jar barcode, and stencil barcode. The system verifies status and records the entry.
5. **Handling Delete Requests:** If a print record was scanned in error and needs to be deleted:
   * A Super Admin must log in.
   * Clicking **Delete** removes the record.
   * If a standard operator clicks **Delete**, they are shown the warning Toast.

---

### 6. Benefits
* **Operator Benefits:** Faster search saves time and reduces selection errors.
* **Production Benefits:** Prevents line stoppages caused by duplicate or incorrect scan entries.
* **Supervisor Benefits:** Restricts destructive actions to admin-level staff, maintaining data security.
* **QA Benefits:** Ensures paste and stencil revision compliance for every board.
* **Traceability Benefits:** Keeps print logs mapped directly to the parent Work Order ID.
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
Version 2.1 improves the Stencil Printing module by introducing the unified `WorkOrderSelector` and security guards. Operators can configure printing runs with high accuracy, while print log data integrity is protected from unauthorized changes, ensuring clean traceability for every board built.
