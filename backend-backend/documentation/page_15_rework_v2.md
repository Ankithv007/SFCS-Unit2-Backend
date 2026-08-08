# Documentation: SMT Manufacturing Execution System (MES)

## PAGE 15: REWORK MODULE (V2)

### 1. PAGE NAME
**Rework & Repair Management Enhancements**
*   **What is it?** This page documents recent updates to the SMT Rework module, including persistent failure metrics, repair tracking UI fixes, and table layout standardization.
*   **Why does it exist?** It ensures defective boards are correctly logged, repaired, and revalidated, while keeping production metrics accurate by preserving historical fail counts.

---

### 2. BUSINESS PURPOSE
*   **Defect Statistics Preservation:** Standardizes yield rates by ensuring failure events are never overwritten or cleared, even after a unit successfully passes rework.
*   **UI Quality:** Resolves displaying incorrect Post-AOI defect details on the repair workbench and removes legacy squeegee columns from tables to optimize screen real estate.
*   **What if it didn't exist?** Factory yield rates would look artificially high because repaired units would overwrite their initial failure logs, skewing quality metrics.

---

### 3. USER ROLES
| Role | Permissions on this Page |
| :--- | :--- |
| **Rework Operator** | Can scan defective boards, log repair actions, and submit units for revalidation. |
| **Quality Inspector** | Can audit repair details and inspect revalidated units. |
| **Supervisor** | Can view rework queues, failure statistics, and export logs. |

---

### 4. COMPLETE WORKFLOW
1.  **Defect Registration:** A board fails inspection at the Post-AOI station, registering a defect code (e.g., "Bridge").
2.  **Rework Session Start:** The operator scans the board at the Rework station.
3.  **Repair Action:** The operator fixes the physical defect and logs the action taken (e.g., "Resoldered Pin 12") in the UI.
4.  **Database Commit:** The system creates a rework pass log in `smt_inspections` and updates the unit's active status.
5.  **Revalidation Routing:** The unit is routed back to Post-AOI for re-inspection.

---

### 5. UI SECTION EXPLANATION
*   **Active Defect List:** Table displaying recently failed serial numbers with their defect description and original scanning operator.
*   **Rework Form:** Clean panel containing the scanned barcode, target repair details, and comments.
*   *Note: Squeegee Front/Rear columns have been removed from the Pre-AOI, Post-AOI, and Rework tables for a more compact and focused layout.*

---

### 6. DATABASE DESIGN
*   **Primary Session Table:** `smt_rework_sessions`
*   **Inspection Logs:** `smt_inspections` (tracks both the failure and the subsequent PASS/FAIL rework scans).
*   *Traceability:* Links rework sessions to work orders, stencils, and solder paste.

---

### 7. BACKEND LOGIC
*   **Controller:** `backend-smt/src/controllers/reworkController.ts`
*   **Endpoints:**
    *   `POST /api/rework/sessions` (starts a rework session)
    *   `POST /api/rework/sessions/:id/scan` (validates scan and logs repair)
    *   `GET /api/rework/sessions/:id/post-aoi-failed` (retrieves registered failures)

---

### 8. FRONTEND LOGIC
*   **Component:** `src/pages/smt/rework/Rework.tsx`
*   **Display Logic:** Utilizes state hooks to filter pending and completed repairs.
*   **Grid Optimization:** Cleaned up active/completed data grids, removing `squeegee_front_number` and `squeegee_rear_number` columns.

---

### 9. STATUS FLOW
1.  **FAILED:** Registered defect from Post-AOI.
2.  **READY_FOR_RECHECK:** Rework action logged, waiting for Post-AOI pass.
3.  **REVALIDATED_PASS:** Unit passed Post-AOI after rework.
4.  **FAILED_AGAIN:** Unit failed Post-AOI inspection again.

---

### 10. VALIDATION RULES
*   **Defect Prerequisite:** A barcode cannot start rework unless its latest inspection status in `smt_inspections` is `FAIL` or `REWORK`.
*   **Status Check:** Prevent double logging of active rework passes.

---

### 11. AUDIT TRAIL / TRACEABILITY
*   **Defect History:** Maintains a chronological list of every defect, repair action, timestamp, operator ID, and revalidation status.
*   **Yield Reports:** Captures both initial failure rates and final throughput rates for compliance auditing.

---

### 12. ERROR SCENARIOS
*   **No Active Defect:** Operator scans a board that passed AOI. *System Alert: "Barcode does not have an active defect register."*
*   **Incomplete Form:** Submitting rework without typing remarks. *System Alert: "Action taken comments are required."*

---

### 13. REAL-TIME INDUSTRY SCENARIO
A batch of PCBA boards experiences a high solder bridging rate. The Post-AOI scanner marks them as failed. The Rework operator retrieves these boards, opens the Rework screen, and scans each. The screen immediately displays "Bridge Solder" as recorded by AOI. The operator performs desoldering, types "Bridging removed," and scans the board. The status updates, letting the board move back to AOI.

---

### 14. DEVELOPMENT CHALLENGES
*   **Metric Accuracy:** Ensuring that when a board is repaired and passes AOI on the second try, the system still registers the initial failure in the batch statistics.
*   **Solution:** Separated the unit's current stage status from historical inspection logs, checking count of `status = 'FAIL'` in inspections instead of counting active failures.

---

### 15. FUTURE IMPROVEMENTS
*   **Thermal Camera Integration:** Overlay thermal mapping data directly on the rework terminal UI to highlight fault zones.

---

### 16. SIMPLE SUMMARY
*   **Explanation:** Improves defect management by ensuring failure counts persist for accurate yield analysis, fixing repair details displays, and standardizing table layouts.
*   **Commits:** `bc5b076`, `b730fb6`, `e541698`
