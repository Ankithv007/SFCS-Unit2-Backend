# SMT Manufacturing Execution System (MES)

## VERSION 2.1: SMT FG SESSION MANAGER

### 1. Introduction
The SMT Finished Goods (FG) Session Manager is the packaging validation page where finished panels are grouped, verified, and boxed for shipment to final testing or warehousing. 

Before a physical box is sealed, the operator must verify that all boards scanned into the box match the target Work Order configurations. The primary users of this page are Packaging Operators, QA Officers, and Logistics Supervisors.

---

### 2. Business Purpose
Verifying packaging conformity is critical to prevent mixed shipments or incomplete customer boxes.
* **Shipping Gatekeeper:** Prevents wrong board versions or defective items from being boxed.
* **Session Integrity:** Automatically calculates box capacities and locks panels to active sessions.
* **Audit Trail Integrity:** Logs all scanning activities within each packaging session.
* **Process Compliance:** Ensures all boxing runs are registered against active Work Orders.

---

### 3. Previous Workflow (Version 2.0)
In Version 2.0, the SMT FG page had several limitations:
* **Dropdown Selection Lag:** Selecting Work Orders required scrolling through long, unsorted lists, causing delays.
* **Vague Feedback:** Error responses during session setups were generic.

---

### 4. What's New in Version 2.1
Version 2.1 introduces the standardized Work Order Selector:
* **Standardized Work Order Selector:** Integrates the custom searchable combobox. Operators type any part of the Work Order ID or product name to quickly find the active order.
* **Prioritized Search Matching:** The selector dynamically sorts results, prioritizing exact matches and prefix matches at the top of the list.
* **Auto-expansion on Focus:** Clicking the search selector immediately displays all active options.

---

### 5. User Workflow
1. **Accessing the Module:** The operator logs into the SMT Portal and navigates to **SMT -> SMT FG**.
2. **Selecting a Work Order:** The operator clicks the new **Work Order Number** search box.
3. **Fuzzy Searching:** The operator types the target ID (e.g. "17"). The system filters the list instantly, placing "WO2026061000017" at the top. The operator selects it.
4. **Initializing Session:** The operator enters the box capacity parameters and clicks **Start Session**.
5. **Scanning Barcodes:** The operator scans the PCB barcodes one by one. The system verifies status and records the entry.
6. **Closing Session:** Once the target count is reached, the operator clicks **Close Box** to generate the final packaging label.

---

### 6. Benefits
* **Operator Benefits:** Faster search saves time and reduces selection errors.
* **Production Benefits:** Prevents line stoppages caused by incorrect scan entries.
* **Supervisor Benefits:** Ensures boxing runs are accurately associated with production batches.
* **QA Benefits:** Ensures packaging conformity for every box.
* **Traceability Benefits:** Keeps boxing logs mapped directly to the parent Work Order ID.
* **Productivity Improvements:** Minimizes setup delays when starting new sessions.
* **Error Reduction:** Search filtering prevents selecting the wrong product line.
* **Time Savings:** Reduces search time from minutes to milliseconds.
* **Ease of Use:** Sleek glassmorphic inputs make data entry straightforward.

---

### 7. User Experience Improvements
* **Easier to use:** The combobox behaves like a modern search engine, removing the need for manual list scrolling.
* **Faster:** Results filter dynamically as the operator types.
* **More consistent:** Dropdown styles match the global SMT design system.
* **More reliable:** Auto-calculations ensure correct box capacities.
* **More user-friendly:** Informative error notifications guide operators on what step to take next.

---

### 8. Summary
Version 2.1 improves the SMT FG module by introducing the unified `WorkOrderSelector`. Operators can configure packaging runs with high accuracy, while print log data integrity is protected from unauthorized changes, ensuring clean traceability for every board built.
