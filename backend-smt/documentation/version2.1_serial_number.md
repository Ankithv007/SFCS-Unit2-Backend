# SMT Manufacturing Execution System (MES)

## VERSION 2.1: SERIAL NUMBER GENERATION

### 1. Introduction
The Serial Number Generation module is the administrative control page where unique identification codes and barcodes are assigned to work orders before manufacturing begins on the shop floor. Every raw board or panel that enters the SMT line must bear a unique serial number barcode to track its journey.

This page allows planners to select a work order, view its target quantities, and initiate the generation of a corresponding block of serial numbers. It exists to guarantee that no board enters production without a unique, verified identity. The primary users of this page are Production Planners, QA Officers, and Line Supervisors who ensure barcode layouts are printed and ready for the first assembly stage (Stencil Printing).

---

### 2. Business Purpose
For a manufacturing plant, unique serialization is the foundation of quality assurance and regulatory compliance.
* **Identity Control:** Establishes a unique, immutable tracking key for every board, preventing duplicate codes from entering the line.
* **Yield & Throughput Audits:** By pre-generating serial numbers corresponding to exact work order quantities, supervisors can monitor completion rates and immediately notice if boards go missing.
* **Regulatory Compliance:** Enables complete historical lookups for end customers, ensuring that parts can be traced back to a specific manufacturing date and planner.
* **Component Waste Control:** Restricts operators from generating more serial numbers than the authorized work order quantity, preventing material overruns.

---

### 3. Previous Workflow (Version 2.0)
In Version 2.0, the serial number generation workflow had several limitations that impacted operators:
* **Dropdown Selection Lag:** Planners had to scroll through a standard, native HTML dropdown containing hundreds of active, completed, or historic work orders. This was slow and led to frequent selection mistakes where planners selected similar-looking codes.
* **Unsecured Deletions:** Any user role could accidentally trigger the deletion of a generated serial queue. If a queue was deleted while boards were actively being scanned on the line, it caused data gaps and line stoppages.
* **Vague Feedback:** Error responses and warnings during deletion or duplicate generation were generic, causing confusion for shop floor operators.

---

### 4. What's New in Version 2.1
Version 2.1 introduces standard navigation improvements and security enhancements:
* **Standardized Work Order Selector:** Integrates the searchable combobox component. Planners can type any part of the Work Order ID (such as the last few digits or the product name) to locate and select it instantly.
* **Prioritized Search Matching:** The selector dynamically sorts results so that exact matches and prefix matches appear at the very top of the list.
* **Security Hardening on Deletions:** Restricts the ability to delete generated serial number queues strictly to the **Super Admin** role. 
* **User-friendly Guard Notifications:** If a standard operator or supervisor clicks the delete button, a polite, clear Toast message explains the security constraints instead of showing a generic permission error.
* **Auto-expansion on Focus:** Clicking the search selector immediately displays all active options, even if an item is already selected.
* **Single Active Record Constraint for Customer Barcodes:** Restricts the system from creating duplicate Serial Generation Records for the same Work Order in Customer Barcode mode. All subsequent saves update the single master record.
* **Automatic Scan Resume:** Dynamically detects and loads existing scanned barcodes for a Work Order, allowing operators to seamlessly continue scanning partial batches.
* **Real-time Scanned Count & Completion Status:** Computes cumulative scanned/pending counts dynamically. When the scanned count matches the Work Order quantity, the record is automatically marked as Completed, and the Work Order is removed from the "New Session" dropdown while remaining visible in the records table.

---

### 5. User Workflow
1. **Accessing the Module:** The planner logs into the SMT Portal and navigates to **SMT -> Serial Number**.
2. **Selecting a Work Order:** The planner clicks the new **Work Order Number** search box and selects a Work Order (e.g., WO-1001).
3. **Choosing Barcode Source:** The planner selects **Customer Barcode** as the source.
4. **Resuming a Session (if applicable):** If a session was already started for this Work Order, the system automatically displays the **Resume Mode Active** banner, populates the input fields with previously saved settings, and loads all previously scanned barcodes.
5. **Scanning Barcodes:** The operator scans new barcodes. The system dynamically updates the cumulative **Scanned Count** and **Pending Count**. Duplicate barcodes (both new and historically saved) are automatically rejected.
6. **Saving Scans:** Clicking **Save** uploads only the newly scanned barcodes, appends them to the master record, and refreshes the list.
7. **Completing a Work Order:** When the cumulative Scanned Count equals the Work Order quantity:
   * The record status changes to **Completed**.
   * The Work Order is automatically removed from the active pending dropdown.
8. **Handling Delete Requests:** If a supervisor needs to delete a duplicate serial queue:
   * A Super Admin must log in.
   * Clicking **Delete** removes the records safely.
   * If a standard operator clicks **Delete**, they are shown the warning Toast: *"Only Super Admin is authorized to delete records. Please contact your Super Admin if this record needs to be deleted."*

---

### 6. Benefits
* **Operator Benefits:** Quick type-to-search saves time and reduces selection errors.
* **Production Benefits:** Prevents line stoppages caused by duplicate or missing serial runs.
* **Supervisor Benefits:** Restricts destructive actions to admin-level staff, maintaining data security.
* **QA Benefits:** Guarantees unique, clean serial histories for customer audits.
* **Traceability Benefits:** Keeps serial lists mapped directly to the parent Work Order ID.
* **Productivity Improvements:** Minimizes setup delays when starting new batches.
* **Error Reduction:** Search filtering prevents selecting the wrong product line.
* **Time Savings:** Reduces search time from minutes to milliseconds.
* **Ease of Use:** Sleek glassmorphic inputs make data entry straightforward.

---

### 7. User Experience Improvements
* **Easier to use:** The combobox behaves like a modern search engine, removing the need for manual list scrolling.
* **Faster:** Results filter dynamically as the planner types.
* **More consistent:** Dropdown styles match the global SMT design system.
* **More reliable:** Deletion blocks protect production data from accidental clicks.
* **More user-friendly:** Informative error notifications guide operators on what step to take next.

---

### 8. Summary
Version 2.1 transforms the Serial Number Generation module by introducing the unified `WorkOrderSelector` and security guards. Planners can configure serial runs with high accuracy, while the line's data integrity is protected from unauthorized changes, ensuring clean traceability for every board built.
