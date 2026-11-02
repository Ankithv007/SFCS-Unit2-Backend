# Documentation: SMT Manufacturing Execution System (MES)

## PAGE 20: SMT FINISHED GOODS (FG) ENHANCEMENTS

### 1. PAGE NAME
**SMT Finished Goods (FG) Partial Processing & Side-Lock Override**
*   **What is it?** This page documents updates to the SMT Finished Goods (FG) module, specifically the side-lock override logic for double-sided PCBAs.
*   **Why does it exist?** It enables the factory to scan, package, and log Top-side Finished Goods even if the Bottom-side processes are not yet completed.

---

### 2. BUSINESS PURPOSE
*   **Production Flexibility:** Avoids production delays by allowing partial packaging and delivery of completed Top-side boards.
*   **Lead-Time Reduction:** Speeds up order delivery for batches where only Top-side component assembly is immediately required.
*   **What if it didn't exist?** Operators would be blocked from scanning any double-sided PCBA boards at SMT FG until the bottom side went through printing, reflow, and inspection, stalling delivery schedules.

---

### 3. USER ROLES
| Role | Permissions on this Page |
| :--- | :--- |
| **Line Operator** | Can select eligible work orders, open FG sessions, and scan completed barcodes. |
| **Supervisor** | Can view packaging session history and authorize partial shipping overrides. |
| **Quality Inspector** | Can audit inspection history for partially processed batches. |

---

### 4. COMPLETE WORKFLOW
1.  **Work Order Selection:** The operator selects a double-sided Work Order.
2.  **Top-Side Processing:** The PCB panels pass through Top-side SMD assembly and clear Post-AOI.
3.  **Finished Goods Scan:** The operator initiates the SMT FG session.
4.  **Override Evaluation:** The backend helper detects a double-sided board but permits FG entry if the barcode successfully passed all Top-side inspection gates.
5.  **FG Completion:** The system registers the Top-side scan, prints packing labels, and updates session statistics.

---

### 5. UI SECTION EXPLANATION
*   **FG Workspace Panel:** Interface to open packaging runs.
*   **Auto-Populated Scans Table:** Grid showing scanned serial numbers, timestamps, and active status.
*   **Side Resolution Indicators:** Visual badges (`TOP`, `BOTTOM`) displaying the completion status of each board side.

---

### 6. DATABASE DESIGN
#### Table: `smt_fg_sessions`
*   `id` (SERIAL PRIMARY KEY)
*   `work_order_id` (INT REFERENCES `smt_work_orders`)
*   `session_status` (VARCHAR - e.g., 'Open', 'Closed')
*   `created_by` / `created_by_name` (VARCHAR)
*   `created_at` / `closed_at` (TIMESTAMP)

#### Table: `smt_fg_scans`
*   `id` (SERIAL PRIMARY KEY)
*   `session_id` (INT REFERENCES `smt_fg_sessions` ON DELETE CASCADE)
*   `serial_number` (VARCHAR)
*   `scanned_by` / `employee_code` (VARCHAR)
*   `scanned_at` (TIMESTAMP)

---

### 7. BACKEND LOGIC
*   **Controller:** `backend-smt/src/controllers/fgController.ts`
*   **Helper Module:** `backend-smt/src/utils/smtHelper.ts` (`checkSidesResolved` or `checkBottomCompleted`)
*   **Logic:**
    *   Bypasses standard double-sided blockages by evaluating the target side parameters.
    *   If the target session is specified for `Top` side, it validates that all printing and AOI steps for the Top side are complete, ignoring incomplete bottom side history.

---

### 8. FRONTEND LOGIC
*   **Component:** `src/pages/smt/finished-goods/SmtFg.tsx`
*   **State Management:** Connects to the FG API and lists passed/failed scans with color-coded tags.

---

### 9. STATUS FLOW
1.  **Open:** Active Finished Goods packaging session.
2.  **Closed:** Session finalized, packaging report generated.

---

### 10. VALIDATION RULES
*   **Stage Routing Enforcement:** Barcodes scanned at SMT FG must have a `PASS` status recorded in the latest Post-AOI inspection log.
*   **Partial Override Rules:** Bypasses Bottom-side checks *only* if the session is explicitly configured for Top-side processing.

---

### 11. AUDIT TRAIL / TRACEABILITY
*   **Scan Logging:** Logs the unique serial number, target side, scanning operator, employee code, and exact millisecond timestamp.
*   **Label Integrity:** Links the printed packaging label back to the exact operator who logged the FG override.

---

### 12. ERROR SCENARIOS
*   **Pre-requisite Missing:** Barcode scanned at FG did not pass Post-AOI. *System Alert: "Unit has not passed Post-AOI inspection."*
*   **Double Scanning:** Scanning the same serial twice in a session. *System Alert: "Serial number already registered in this packaging run."*

---

### 13. REAL-TIME INDUSTRY SCENARIO
A batch of 500 router boards is run through SMT Line 1. The customer requests immediate partial shipment of the first 200 Top-side assembled boards. The operator sets the SMT FG interface to "Top Side Only" and scans the barcodes. The system verifies that the Top side passed AOI, overrides the bottom-side lock, records the scans, and prints the shipment barcode labels.

---

### 14. DEVELOPMENT CHALLENGES
*   **Side Locking Complexity:** The standard tracking engine blocked all processes for double-sided boards if the bottom side was incomplete to prevent routing errors.
*   **Solution:** Refactored the validation helper `checkBottomCompleted` in `smtHelper.ts` to accept an override parameter that explicitly permits Top-side validation bypass during FG scans.

---

### 15. FUTURE IMPROVEMENTS
*   **Auto Box Quantity Tracking:** Integrate weighing scales to automatically close FG sessions when box weight thresholds are met.

---

### 16. SIMPLE SUMMARY
*   **Explanation:** Finished Goods scan module that allows double-sided PCBA panels to be processed and packaged immediately after completing their Top-side assembly.
*   **Commits:** `522d168`
