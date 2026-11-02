# SMT Manufacturing Execution System (MES)

## VERSION 2.1: MSD TRACKER

### 1. Introduction
The Moisture Sensitive Device (MSD) Tracker page monitors the ambient environmental exposure of sensitive electronic components. 

When MSDs are removed from moisture barrier bags, their exposure clocks start ticking. If a component exceeds its floor-life threshold before reflow, it can trap moisture and delaminate during soldering. The primary users of this page are SMT operators, Material Handlers, and QA Inspectors.

---

### 2. Business Purpose
Active tracking of MSD exposure limits is vital to prevent micro-crack defects.
* **Defect Prevention:** Prevents delamination (popcorn effect) during reflow soldering.
* **Process Compliance:** Automatically alerts operators when components reach their maximum exposure limit and must be returned to dry storage or baking ovens.
* **Audit Trail Integrity:** Logs mount, dismount, and baking activities for QA reviews.
* **Process Compliance:** Ensures all component runs are registered against active Work Orders.

---

### 3. Previous Workflow (Version 2.0)
In Version 2.0, the MSD Tracker page had several limitations:
* **Dropdown Selection Lag:** Selecting Work Orders required scrolling through long, unsorted lists, causing delays.
* **Vague Feedback:** Error responses during mount/dismount setups were generic.

---

### 4. What's New in Version 2.1
Version 2.1 introduces the standardized Work Order Selector:
* **Standardized Work Order Selector:** Integrates the custom searchable combobox. Operators type any part of the Work Order ID or product name to quickly find the active order.
* **Prioritized Search Matching:** The selector dynamically sorts results, prioritizing exact matches and prefix matches at the top of the list.
* **Auto-expansion on Focus:** Clicking the search selector immediately displays all active options.

---

### 5. User Workflow
1. **Accessing the Module:** The operator logs into the SMT Portal and navigates to **SMT -> MSD Tracker**.
2. **Selecting a Work Order:** The operator clicks the new **Work Order Number** search box.
3. **Fuzzy Searching:** The operator types the target ID (e.g. "17"). The system filters the list instantly, placing "WO2026061000017" at the top. The operator selects it.
4. **Mounting Components:** The operator scans the component reel barcode and confirms mounting.
5. **Monitoring Exposure:** The system displays the exposure time. The operator checks progress.
6. **Dismounting Components:** The operator clicks **Dismount** to stop the exposure timer and logs the action.

---

### 6. Benefits
* **Operator Benefits:** Faster search saves time and reduces selection errors.
* **Production Benefits:** Prevents line stoppages caused by incorrect component configurations.
* **Supervisor Benefits:** Ensures moisture limits are tracked per batch.
* **QA Benefits:** Ensures component conformity for every run.
* **Traceability Benefits:** Keeps MSD logs mapped directly to the parent Work Order ID.
* **Productivity Improvements:** Minimizes setup delays when starting new runs.
* **Error Reduction:** Search filtering prevents selecting the wrong product line.
* **Time Savings:** Reduces search time from minutes to milliseconds.
* **Ease of Use:** Sleek glassmorphic inputs make data entry straightforward.

---

### 7. User Experience Improvements
* **Easier to use:** The combobox behaves like a modern search engine, removing the need for manual list scrolling.
* **Faster:** Results filter dynamically as the operator types.
* **More consistent:** Dropdown styles match the global SMT design system.
* **More reliable:** Auto-calculations ensure correct exposure logs.
* **More user-friendly:** Informative error notifications guide operators on what step to take next.

---

### 8. Summary
Version 2.1 improves the MSD Tracker module by introducing the unified `WorkOrderSelector`. Operators can configure component runs with high accuracy, while print log data integrity is protected from unauthorized changes, ensuring clean traceability for every board built.
