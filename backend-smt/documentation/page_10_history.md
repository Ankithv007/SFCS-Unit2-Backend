# Documentation: SMT Manufacturing Execution System (MES)

## PAGE 10: SMT WORK ORDER HISTORY & DASHBOARD

### 1. PAGE NAME
**SMT Work Order History / Dashboard**
*   **What is it?** This is the "Brain" of the SMT department. It is a centralized reporting dashboard where supervisors and managers can see every work order (WO) that has ever been processed on the line.
*   **Why does it exist?** Production doesn't happen in a vacuum. Management needs to know: "How many boards did we finish today?", "Which line is the fastest?", and "Are we behind schedule?" This page answers those questions with real-time data.

---

### 2. BUSINESS PURPOSE
*   **Production Transparency:** Provides a "Single Source of Truth" for production numbers, preventing arguments over manual tally sheets.
*   **Capacity Planning:** Helps managers see if a production line is overloaded or under-utilized.
*   **Performance Tracking:** Measures the "Balance Quantity" (what's left to do) so the factory can prioritize urgent orders.
*   **What if it didn't exist?** Management would have to physically walk down to the factory floor and count boards manually, leading to massive delays in reporting and decision-making.

---

### 3. USER ROLES
| Role | Permissions on this Page |
| :--- | :--- |
| **Production Manager** | Views high-level progress across all lines to report to customers. |
| **Line Supervisor** | Monitors their specific line (e.g., SMT-1) to ensure targets are met. |
| **Data Analyst** | Exports the data to calculate OEE (Overall Equipment Effectiveness). |

---

### 4. COMPLETE WORKFLOW
1.  **Select Filters:** User chooses the **Date Range** (e.g., Yesterday to Today) and the **Line ID** (e.g., SMT-2).
2.  **Submit Request:** The system queries the database for all Work Orders matching those criteria.
3.  **Analyze Results:**
    *   **Completed Qty:** Total boards that passed the final inspection.
    *   **Balance Qty:** Boards remaining to reach the target.
    *   **Status:** Is the WO still running (ACTIVE) or finished (COMPLETED)?
4.  **Deep Dive:** The user can see exactly who created the WO and the exact second it was started.

---

### 5. UI SECTION EXPLANATION
*   **Filter Card:** Uses a clean, professional grey-scale design to keep the focus on the data. Includes date pickers and line selection dropdowns.
*   **Status Badges:**
    *   **ACTIVE (Green):** Currently running on the machines.
    *   **COMPLETED (Blue):** All boards finished and shipped to the next department.
    *   **INACTIVE (Grey):** Paused or cancelled.
*   **Data Grid:** A high-density table showing 10 critical columns of information, optimized for viewing on large office monitors.

---

### 6. DATABASE DESIGN
**Table:** `smt_work_orders` (Primary) & `smt_inspections` (for completion counts)

| Column | Type | Purpose |
| :--- | :--- | :--- |
| `work_order_id` | VARCHAR | Unique ID |
| `completed_qty` | INTEGER | Calculated from successful final scans |
| `balance_qty` | INTEGER | `Total - Completed` |
| `status` | VARCHAR | Current lifecycle state |

---

### 7. BACKEND LOGIC
*   **Complex Aggregation:** The backend doesn't just "read" a number; it calculates the `completed_qty` in real-time by counting how many serial numbers for that WO reached the "Post AOI" stage with a "PASS" status.

---

### 8. FRONTEND LOGIC
*   **Auto-fill Defaults:** When the page loads, it automatically sets the "From" and "To" dates to **Today**, showing the user the most relevant information immediately.
*   **Dynamic Styling:** Uses a `getStatusStyle` function to automatically color-code rows based on their production status, allowing for "At-a-glance" monitoring.

---

### 9. STATUS FLOW
1.  **ACTIVE:** The WO is visible at every scanning station (Printing, AOI, etc.).
2.  **COMPLETED:** The WO is hidden from the scanning stations to prevent accidental over-production.
3.  **INACTIVE:** Archived for historical reference.

---

### 10. VALIDATION RULES
*   **Date Logic:** Prevents the "To Date" from being earlier than the "From Date" (Standard business logic).
*   **Read-only Area:** The "Area ID" is locked to "SMT" to ensure users don't accidentally view data from Assembly or Packing.

---

### 11. AUDIT TRAIL / TRACEABILITY
*   **Run-Time Logging:** Every WO is timestamped with `run_date_time`. This allows the company to prove to auditors exactly when a specific batch was manufactured.

---

### 12. ERROR SCENARIOS
*   **"No data found":** Happens if no work orders were started during the selected date range.
*   **"Connection Error":** Displayed if the reporting server is temporarily overloaded.

---

### 13. REAL-TIME INDUSTRY SCENARIO
*   **Scenario:** A customer calls and asks, "Where is my order for 500 Motherboards (WO #999)?"
*   **The Action:** The Manager opens the Dashboard, filters for WO #999, and sees: `Total: 500`, `Completed: 450`, `Balance: 50`. 
*   **Communication:** The Manager tells the customer, "We are 90% finished; the last 50 boards are currently in final inspection."

---

### 14. DEVELOPMENT CHALLENGES
*   **Performance Optimization:** As the factory grows, the "History" table will have millions of rows. The backend uses indexed queries to ensure the dashboard loads in under 1 second.

---

### 15. FUTURE IMPROVEMENTS
*   **Excel Export:** Add a button to download the history as a `.xlsx` file for offline reporting.
*   **Live Charts:** Add a Pie Chart showing the ratio of "Good" boards vs "Reworked" boards.

---

### 16. SIMPLE SUMMARY
*   **Explanation:** The "Factory Scoreboard". It shows exactly how much work has been done and what is left.
*   **Quick Workflow:** Set Dates -> Click Submit -> Review Results.
*   **Key Business Importance:** Enables data-driven management and customer transparency.
