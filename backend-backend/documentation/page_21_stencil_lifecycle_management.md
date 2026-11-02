# Documentation: SMT Manufacturing Execution System (MES)

## PAGE 21: STENCIL LIFECYCLE MANAGEMENT

### 1. PAGE NAME
**Stencil Lifecycle & Squeegee Management**
*   **What is it?** This page documents the Stencil Lifecycle Management module, which monitors physical stencils and squeegee blades used in SMT printing.
*   **Why does it exist?** It prevents printing defects (e.g., solder bridging or voids) by enforcing wash intervals, tension checks, and squeegee tracking.

---

### 2. BUSINESS PURPOSE
*   **Tooling Lifecycle Auditing:** Measures print strokes and washes to ensure stencils do not exceed wear limits.
*   **Traceability Mapping:** Links physical squeegee blades (front and rear) and stencils to printed PCB serial numbers.
*   **What if it didn't exist?** Engineers wouldn't know when a stencil was last washed or checked for tension, leading to solder volume defects.

---

### 3. USER ROLES
| Role | Permissions on this Page |
| :--- | :--- |
| **Line Operator** | Can log stencil mounting, wash cycles, and dismounting actions. |
| **Maintenance Engineer** | Can enter tension calibration readings and register new stencils. |
| **Supervisor / Admin** | Can modify wash limits, edit records, and delete legacy configs. |

---

### 4. COMPLETE WORKFLOW
1.  **Registry:** Stencils are registered in the master database with parameters (thickness, wash limit).
2.  **Mounting Setup:** Operator mounts the stencil and inputs squeegee blade IDs (`squeegee_front_number`, `squeegee_rear_number`).
3.  **Operation Scans:** Printed PCB panels are logged, incrementing the stencil's raw stroke count.
4.  **Cleaning Alert:** The system alerts the operator to wash the stencil after a preset count (e.g. 50 strokes).
5.  **Tension Calibration:** Periodically, a technician measures the stencil tension (in N/cm) and records it.

---

### 5. UI SECTION EXPLANATION
*   **Stencil Master Grid:** Directory of stencils showing active statuses (`Ready`, `Mounted`, `Retired`).
*   **Lifecycle History Grid:** Real-time log showing washing events, mounting times, and operator names.
*   **Squeegee Input Panel:** UI modal in printing sessions to capture front and rear blade codes.

---

### 6. DATABASE DESIGN
#### Table: `smt_stencil_master`
*   `id` (SERIAL PRIMARY KEY)
*   `stencil_code` / `stencil_name` (VARCHAR UNIQUE)
*   `thickness` (NUMERIC)
*   `apertures` (INT)
*   `tension` (NUMERIC) - Tension reading in N/cm.
*   `wash_cycles_limit` (INT) - Default wash threshold.
*   `total_wash_cycles` (INT DEFAULT 0)
*   `status` (VARCHAR - 'Ready', 'Mounted', 'Retired')
*   `created_at` (TIMESTAMP)

#### Table: `smt_stencil_lifecycle`
*   `id` (SERIAL PRIMARY KEY)
*   `stencil_id` (INT REFERENCES `smt_stencil_master`)
*   `action_type` (VARCHAR - e.g., 'MOUNT', 'UNMOUNT', 'WASH', 'TENSION_CHECK')
*   `line` (VARCHAR)
*   `operator_id` (VARCHAR)
*   `remarks` (TEXT)
*   `created_at` (TIMESTAMP)

#### Alterations to Printing Tables:
*   `squeegee_front_number` (VARCHAR - Optional)
*   `squeegee_rear_number` (VARCHAR - Optional)
*   *Note: Constraint changed to NULL via migration 039 to support legacy printing logs.*

---

### 7. BACKEND LOGIC
*   **Controller:** `backend-smt/src/controllers/stencilLifecycleController.ts`
*   **Logic:**
    *   Tracks print strokes by joining printing scans with mounted stencil sessions.
    *   Saves squeegee codes during printing setup.
    *   Updates stencil statuses during cleaning and dismounting.

---

### 8. FRONTEND LOGIC
*   **Component:** `src/pages/smt/stencil/StencilLifecycle.tsx`
*   **Features:**
    *   Forms to log mounting and dismounting.
    *   Validation modals displaying tension alerts.

---

### 9. STATUS FLOW
1.  **Ready:** Available for production in the tooling crib.
2.  **Mounted:** Currently attached to a screen printer.
3.  **Washed:** Cleaned and ready for reuse.
4.  **Retired:** Exceeded tension limits or stroke cycles.

---

### 10. VALIDATION RULES
*   **Tension Lock:** Blocks mounting if tension is measured below 20 N/cm.
*   **Status Lock:** Prevents mounting a stencil that is already marked as `Mounted` on another line.
*   **Squeegee Format:** Optional validation of squeegee barcodes.

---

### 11. AUDIT TRAIL / TRACEABILITY
*   **Calibration History:** Logs every tension check with technician ID and date-time.
*   **Traceability Joining:** Links PCB inspection failures to the physical stencil and squeegee used.

---

### 12. ERROR SCENARIOS
*   **Low Tension Warning:** Entering tension = 18 N/cm. *System Alert: "Tension check failed. Stencil must be retired."*
*   **Already Mounted:** Attempting to mount an active stencil. *System Alert: "Stencil is currently active on Line 2."*

---

### 13. REAL-TIME INDUSTRY SCENARIO
An SMT operator mounts stencil `ST-40` on Line 1. The screen printer interface requests squeegee numbers. The operator scans squeegees `SQ-22` and `SQ-23`. The system registers the session. After 100 printed panels, the system alerts: "Stencil cleaning required." The operator removes the stencil, washes it, logs "Washed ST-40" in the UI, and resumes production.

---

### 14. DEVELOPMENT CHALLENGES
*   **Database Constraints:** Initial schemas made squeegee fields NOT NULL. This caused API crashes when processing legacy work orders that had no squeegee details.
*   **Solution:** Executed migration `039` to drop the NOT NULL constraints, making squeegee tracking backwards compatible.

---

### 15. FUTURE IMPROVEMENTS
*   **RFID Integration:** Utilize RFID tags on stencils and squeegee blades to automatically mount tooling without manual entry.

---

### 16. SIMPLE SUMMARY
*   **Explanation:** Tooling log system that manages print stencils, tracks washes, alerts operators on cleanings, and links squeegees to SMT print cycles.
*   **Commits:** `8f145da`, `4b9b116`, `b6f8f3e`
