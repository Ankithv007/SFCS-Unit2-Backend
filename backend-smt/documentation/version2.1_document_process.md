# SMT Manufacturing Execution System (MES)

## VERSION 2.1: DOCUMENT PROCESS (QMS)

### 1. Introduction
The Document Process (QMS) page links engineering documents (BOM revisions, Process Flow Charts, XY component placement files) to active Work Orders. 

Before a line can run, supervisors must upload and verify the correct engineering plans so operators can refer to them during manufacturing. The primary users of this page are Planners, QA Officers, and Line Supervisors.

---

### 2. Business Purpose
Ensuring correct technical specifications is critical to prevent assembly errors.
* **Revision Control:** Ensures only approved, active engineering documents are uploaded.
* **Process Consistency:** Provides operators with immediate access to correct build drawings.
* **Audit Trail Integrity:** Logs all upload activities for QA audits.
* **Process Compliance:** Ensures all uploaded documents are registered against active Work Orders.

---

### 3. Previous Workflow (Version 2.0)
In Version 2.0, the Document Process page had several limitations:
* **Dropdown Selection Lag:** Selecting Work Orders required scrolling through long, unsorted lists, causing delays.
* **Vague Feedback:** Error responses during file uploads were generic.

---

### 4. What's New in Version 2.1
Version 2.1 introduces the standardized Work Order Selector:
* **Standardized Work Order Selector:** Integrates the custom searchable combobox. Operators type any part of the Work Order ID or product name to quickly find the active order.
* **Prioritized Search Matching:** The selector dynamically sorts results, prioritizing exact matches and prefix matches at the top of the list.
* **Auto-expansion on Focus:** Clicking the search selector immediately displays all active options.

---

### 5. User Workflow
1. **Accessing the Module:** The planner logs into the SMT Portal and navigates to **SMT -> Document Process**.
2. **Selecting a Work Order:** The planner clicks the new **Work Order Number** search box.
3. **Fuzzy Searching:** The planner types the target ID (e.g. "17"). The system filters the list instantly, placing "WO2026061000017" at the top. The planner selects it.
4. **Uploading Files:** The planner selects the file category, attaches the document (PDF, XLS, CSV, ZIP), and clicks **Upload**.
5. **Verifying Revisions:** The system displays the upload history. The planner verifies the details.

---

### 6. Benefits
* **Operator Benefits:** Immediate access to correct technical plans.
* **Production Benefits:** Prevents line delays caused by missing specification files.
* **Supervisor Benefits:** Ensures configuration controls are followed on-line.
* **QA Benefits:** Hardens document revision tracking.
* **Traceability Benefits:** Keeps specification logs mapped directly to the parent Work Order ID.
* **Productivity Improvements:** Minimizes setup delays when starting new batches.
* **Error Reduction:** Search filtering prevents selecting the wrong product line.
* **Time Savings:** Reduces search time from minutes to milliseconds.
* **Ease of Use:** Sleek glassmorphic inputs make data entry straightforward.

---

### 7. User Experience Improvements
* **Easier to use:** The combobox behaves like a modern search engine, removing the need for manual list scrolling.
* **Faster:** Results filter dynamically as the operator types.
* **More consistent:** Dropdown styles match the global SMT design system.
* **More reliable:** Validation checks restrict unsupported file formats.
* **More user-friendly:** Informative error notifications guide operators on what step to take next.

---

### 8. Summary
Version 2.1 improves the Document Process module by introducing the unified `WorkOrderSelector`. Planners can configure document runs with high accuracy, while data integrity is protected from unauthorized changes, ensuring clean traceability for every board built.
