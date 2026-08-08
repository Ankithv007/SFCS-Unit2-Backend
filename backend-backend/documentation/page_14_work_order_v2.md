# Documentation: SMT Manufacturing Execution System (MES)

## PAGE 14: WORK ORDER ENHANCEMENTS (V2)

### 1. PAGE NAME
**Work Order Management & Traceability Enhancements**
*   **What is it?** This page documents recent updates to the SMT Work Order module, transition to dynamic RBAC permissions, and the high-performance Excel report download and stream features.
*   **Why does it exist?** It provides enhanced security through backend-governed permissions and streamlines work order statistics exports, eliminating memory overhead on large production batches.

---

### 2. BUSINESS PURPOSE
*   **Dynamic Security:** Replaces hardcoded role restrictions with granular backend permission controls, ensuring least-privilege principles.
*   **Production Auditability:** Allows production planners and managers to download detailed traceability reports in Excel format to analyze cycle times and yield.
*   **What if it didn't exist?** Rigid role checks would prevent custom department configurations, and generating reports for large batches would trigger memory leaks or API timeouts.

---

### 3. USER ROLES
| Role | Permissions on this Page |
| :--- | :--- |
| **Line Operator** | Can view work orders assigned to their line; cannot edit or export data. |
| **Supervisor** | Can view, search, and export work order excel reports. |
| **Administrator** | Can edit customer barcodes, update statuses, and delete test records. |
| **Super Admin** | Full privileges including override locks and modifying schema/rules. |

---

### 4. COMPLETE WORKFLOW
1.  **Work Order Selection:** The planner views active/pending work orders.
2.  **Report Trigger:** User clicks "Export Excel" on the Work Order Tracking page.
3.  **Authentication & Verification:** Backend validates `smt_work_order.can_export` permission.
4.  **Data Retrieval & Streaming:** The system fetches the work order details, serial numbers, and inspection history from database, compiles it into an Excel worksheet, and streams the buffer back.
5.  **Audit Logging:** Log records that the user exported the tracking details of the Work Order.

---

### 5. UI SECTION EXPLANATION
*   **Work Order Grid:** Shows active work orders with status tags (`Pending`, `In Progress`, `Completed`).
*   **Traceability Export Button:** Standard blue button on the tracking page to download the `.xlsx` file.
*   **Customer Barcode Editor:** Interactive modal allowing authorized supervisors to change or fix mis-scanned customer serial numbers.

---

### 6. DATABASE DESIGN
*   **Table:** `smt_work_orders` (Tracks the main Work Order entity).
*   **Audit Table:** `admin_audit_logs` (Tracks changes made to customer barcodes).
*   *Note: Detailed serial scans are linked to `smt_serial_numbers` and history in `smt_inspections`.*

---

### 7. BACKEND LOGIC
*   **Controller:** `backend-smt/src/controllers/smtTrackController.ts`
*   **Endpoint:** `GET /api/export/wo/:woId` (`downloadWorkOrderExcel`)
*   **Features:**
    *   Utilizes `exceljs` library to compile work order metadata.
    *   Sets headers to `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.
    *   Streams output directly to the response buffer to prevent high memory usage.

---

### 8. FRONTEND LOGIC
*   **Component:** `src/pages/smt/work-order/WorkOrder.tsx`
*   **Service call:** Fetches `/api/export/wo/:woId` as `blob` and triggers browser file save.
*   **State Management:** Tracks loading state during Excel compilation.

---

### 9. STATUS FLOW
1.  **Pending:** Newly created Work Order.
2.  **In Progress:** Barcodes have been generated or first printing scan has begun.
3.  **Completed:** Quantity requirements matched and all units processed at the SMT FG stage.

---

### 10. VALIDATION RULES
*   **Permission Guards:** Enforced via `requirePermission('smt_work_order', 'can_view/can_create/can_edit/can_delete/can_export')`.
*   **Excel Limits:** Checks that the work order exists and contains serial numbers before generating file.

---

### 11. AUDIT TRAIL / TRACEABILITY
*   **Excel File Logging:** Record details of user, timestamp, work order ID, and count of records exported.
*   **Customer Barcode Edits:** Logs old values, new values, performing employee code, and timestamp in `admin_audit_logs`.

---

### 12. ERROR SCENARIOS
*   **Unauthenticated Request:** 401 Unauthorized returned by `authenticateToken`.
*   **Insufficient Permissions:** 403 Forbidden returned by `requirePermission`.
*   **Work Order Empty:** 404 Not Found if no serial numbers exist for that work order.

---

### 13. REAL-TIME INDUSTRY SCENARIO
A quality audit requires proof of SMT step completion for a batch of 1000 mainboards. The manager navigates to the Work Order page, searches the ID, and clicks Export. Within seconds, a fully formatted spreadsheet is generated showing exactly when each serial passed Printing, Pre-AOI, Post-AOI, and SMT FG, along with the operator names.

---

### 14. DEVELOPMENT CHALLENGES
*   **Performance Bottleneck:** Large batches of 5000+ units with multi-stage inspection history were timing out.
*   **Solution:** Rewrote SQL queries with indexed LEFT JOINs and utilized streaming Excel generation instead of load-in-memory buffers.

---

### 15. FUTURE IMPROVEMENTS
*   **Format Selection:** Support PDF and JSON exports on the same page.
*   **Auto-Emailing:** Enable scheduled delivery of daily reports to SMT department supervisors.

---

### 16. SIMPLE SUMMARY
*   **Explanation:** Provides robust, permission-garded SMT Work Order security and details the high-performance Excel streaming endpoint for exporting work order inspection logs.
*   **Commits:** `716cd7b`, `982d214`, `5de583e`, `e53571e`
