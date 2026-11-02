# SMT Manufacturing Execution System (MES)

## VERSION 2.1: STENCIL MASTER

### 1. Introduction
The Stencil Master page serves as the registration portal for physical stencils used on screen printers. 

Before a stencil can be used, its parameters (thickness, model name, manufacturing date, sides) must be logged in the system. The primary users of this page are SMT operators, QA Inspectors, and Line Supervisors.

---

### 2. Business Purpose
Ensuring correct stencil parameters is vital to prevent print defects.
* **Revision Control:** Ensures only approved stencils are registered.
* **Storage Location Tracking:** Helps operators locate stencils in storage cabinets.
* **Audit Trail Integrity:** Logs all registration activities for QA reviews.
* **Process Compliance:** Ensures all stencils are registered against active specifications.

---

### 3. Previous Workflow (Version 2.0)
In Version 2.0, the Stencil Master page had several limitations:
* **Obscure Audit Details:** The registration logs lacked structured display of creation stamps. Planners and supervisors could not easily see who generated a stencil without scanning lists.
* **Vague Feedback:** Error responses during registration setups were generic.

---

### 4. What's New in Version 2.1
Version 2.1 introduces several enhancements designed to improve visual clarity:
* **Detail Inspector Modal Layout:** Restructured the details view modal into clear, card-based blocks: Core Details, Production Details, Status, Audit Information, and Additional Information.
* **Status Change dropdown:** Clean status selector interface inside the edit view.
* **Hardened Auditing Blocks:** Added a structured "Audit Information" card showing creator metadata and creation timestamps.

---

### 5. User Workflow
1. **Accessing the Module:** The operator logs into the SMT Portal and navigates to **SMT -> Stencil Master**.
2. **Reviewing Existing Stencils:** The operator views the active stencils grid.
3. **Registering a New Stencil:** The operator fills out the registration form:
   * Selects model name.
   * Input thickness and manufacturing date.
   * Selects sides.
4. **Verifying Details:** The operator clicks the "Details" icon on any stencil. The structured cards pop up:
   * Review parameters under **Core Details**.
   * Review audit stamps under **Audit Information**.
5. **Editing Stencil Status:** If a stencil is worn out:
   * The operator clicks **Edit**.
   * Selects status (ACTIVE, INACTIVE, SCRAPPED).
   * Clicks **Save**.

---

### 6. Benefits
* **Operator Benefits:** Easy reference to stencil parameters.
* **Production Benefits:** Prevents line delays caused by incorrect stencil configurations.
* **Supervisor Benefits:** Clear visibility of audit logs.
* **QA Benefits:** Worn-out stencils are marked "SCRAPPED", blocking downline usage.
* **Traceability Benefits:** Keeps registration logs mapped directly to the parent Stencil ID.
* **Productivity Improvements:** Minimizes setup delays when starting new runs.
* **Error Reduction:** Search filtering prevents selecting the wrong stencil.
* **Time Savings:** Reduces search time from minutes to milliseconds.
* **Ease of Use:** Sleek glassmorphic inputs make data entry straightforward.

---

### 7. User Experience Improvements
* **Easier to use:** Card layouts group related data points logically, reducing eye strain.
* **Faster:** Edit controls are accessible directly within the grid.
* **More consistent:** Dropdown styles match the global SMT design system.
* **More reliable:** Status controls ensure only active stencils are used.
* **More user-friendly:** Informative error notifications guide operators on what step to take next.

---

### 8. Summary
Version 2.1 improves the Stencil Master module by introducing card-based inspectors, status controls, and structured audit blocks. Planners can configure stencil runs with high accuracy, while data integrity is protected from unauthorized changes, ensuring clean traceability for every board built.
