# SMT Manufacturing Execution System (MES)

## VERSION 2.1: STENCIL LIFE CYCLE MANAGEMENT

### 1. Introduction
The Stencil Life Cycle Management page monitors print count limits for physical stencils to ensure they are not used beyond their wear threshold. 

Each time a stencil is used, the system logs the print counts and calculates remaining prints. When a stencil approaches its wear limit, the system alerts operators to replace it. The primary users of this page are SMT operators, QA Inspectors, and Line Supervisors.

---

### 2. Business Purpose
Effective life cycle tracking is vital to prevent solder paste smearing defects.
* **Defect Prevention:** Prevents paste smearing due to stencil wear-and-tear.
* **Process Compliance:** Automatically alerts operators when stencils reach their maximum print limit and must be scrapped.
* **Audit Trail Integrity:** Logs print counts and lifecycle adjustments for QA reviews.
* **Process Compliance:** Ensures all lifecycle assignments are registered against active Work Orders.

---

### 3. Previous Workflow (Version 2.0)
In Version 2.0, the Stencil Life Cycle page had several limitations:
* **Dropdown Selection Lag:** Selecting Work Orders required scrolling through long, unsorted lists, causing delays.
* **Unsecured Deletions:** Any operator could delete lifecycle records, making it difficult for supervisors to trace print limits.
* **Vague Feedback:** Error responses during setups were generic.

---

### 4. What's New in Version 2.1
Version 2.1 introduces the standardized Work Order Selector and role-based security guards:
* **Standardized Work Order Selector:** Integrates the custom searchable combobox. Operators type any part of the Work Order ID or product name to quickly find the active order.
* **Prioritized Search Matching:** The selector dynamically sorts results, prioritizing exact matches and prefix matches at the top of the list.
* **Client-Side Delete Security Hardening:** Restricts the ability to delete lifecycle records strictly to the **Super Admin** role.
* **Clear Guard Notifications:** If an operator or supervisor attempts to delete a record, a polite Toast message appears: *"Only Super Admin is authorized to delete records. Please contact your Super Admin if this record needs to be deleted."*
* **Auto-expansion on Focus:** Clicking the search selector immediately displays all active options.

---

### 5. User Workflow
1. **Accessing the Module:** The operator logs into the SMT Portal and navigates to **SMT -> Stencil Life Cycle**.
2. **Selecting a Work Order:** The operator clicks the new **Work Order Number** search box.
3. **Fuzzy Searching:** The operator types the target ID (e.g. "17"). The system filters the list instantly, placing "WO2026061000017" at the top. The operator selects it.
4. **Scanning Stencil Barcode:** The operator scans the stencil barcode. The system verifies status and records print limits.
5. **Handling Delete Requests:** If a lifecycle record was scanned in error and needs to be deleted:
   * A Super Admin must log in.
   * Clicking **Delete** removes the record.
   * If a standard operator clicks **Delete**, they are shown the warning Toast.

---

### 6. Benefits
* **Operator Benefits:** Faster search saves time and reduces selection errors.
* **Production Benefits:** Prevents line delays caused by incorrect stencil configurations.
* **Supervisor Benefits:** Ensures print limits are tracked per batch.
* **QA Benefits:** Ensures component conformity for every run.
* **Traceability Benefits:** Keeps lifecycle logs mapped directly to the parent Work Order ID.
* **Productivity Improvements:** Minimizes setup delays when starting new runs.
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
Version 2.1 improves the Stencil Life Cycle module by introducing the unified `WorkOrderSelector` and security guards. Operators can configure component runs with high accuracy, while print log data integrity is protected from unauthorized changes, ensuring clean traceability for every board built.
