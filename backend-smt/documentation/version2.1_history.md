# SMT Manufacturing Execution System (MES)

## VERSION 2.1: SMT WORK ORDER HISTORY & DASHBOARD

### 1. Introduction
The SMT Work Order History & Dashboard serves as the central visual reporting node for all physical SMT lines. 

It compiles scan records from every stage of production—Printing, Pre AOI, Post AOI, Rework, Packaging, and Shipping—to present a comprehensive progress board. The primary users of this page are Production Managers, Line Supervisors, and Planning Leads.

---

### 2. Business Purpose
Maintaining real-time visibility into production progress is critical to meet shipment schedules.
* **Progress Tracking:** Tracks completed quantities and target balances for all active runs.
* **OEE Calculations:** Provides managers with metrics to evaluate machine utilization.
* **Process Optimization:** Highlights line bottlenecks (such as high rework rates at Post AOI).
* **Audit Trail Integrity:** Centralizes the permanent record history for quality audits.

---

### 3. Previous Workflow (Version 2.0)
In Version 2.0, the History Dashboard tracked yield stats across a longer production path including the SPI (Solder Paste Inspection) stage:
* **Overhead tracking:** Yield calculations depended on tracking SPI scans, which created data skew if board print runs were manually routed.
* **Process delays:** Calculating balance ratios took longer because of additional database queries.

---

### 4. What's New in Version 2.1
Version 2.1 introduces yield calculation optimizations following the decommissioning of the SPI station:
* **SPI-free Yield Aggregations:** Yield tracking and complete board history calculations have been refactored to transition directly from Stencil Printing to Pre AOI.
* **Status Badges Color Coding:** Restructured status codes for active, completed, or inactive lines for easier readability.
* **Date Range Defaults:** Auto-sets default search filters to the current date on page load to display the most relevant logs instantly.

---

### 5. User Workflow
1. **Accessing the Module:** The user logs into the SMT Portal and navigates to **SMT -> History/Dashboard**.
2. **Applying Filters:** The user selects the Date Range and Line ID.
3. **Reviewing Metrics:** The system displays the active grid:
   * Target Qty vs Completed Qty.
   * Balance Qty (remaining boards).
   * Yield ratios and active status indicators.
4. **Exporting Logs:** The user clicks the export button to download details.

---

### 6. Benefits
* **Operator Benefits:** Clear visibility into active shifts targets.
* **Production Benefits:** Accurate line balance reporting.
* **Supervisor Benefits:** Real-time feedback on throughput rates.
* **QA Benefits:** Simplified auditing with complete board journey logs.
* **Traceability Benefits:** Tracks boards from printing through packaging.
* **Productivity Improvements:** Eliminates manual progress tally sheets.
* **Error Reduction:** Automatically pulls scans from Post AOI to calculate yield, preventing reporting errors.
* **Time Savings:** Instant dashboard rendering.
* **Ease of Use:** Clear status colors allow immediate review.

---

### 7. User Experience Improvements
* **Easier to use:** Simple filter cards make applying queries straightforward.
* **Faster:** Reduced data query count loads reports instantly.
* **More consistent:** Uses identical status styles as other SMT modules.
* **More reliable:** Tracks direct transition printing to Pre AOI correctly.
* **More user-friendly:** Grid columns fit standard office monitors without sideways scrolling.

---

### 8. Summary
Version 2.1 refactors the Work Order History & Dashboard to align with the optimized SMT production line layout. By removing SPI scan steps and streamlining yield metrics calculations, it provides managers and supervisors with an accurate, high-performance scoreboard to drive daily operations.
