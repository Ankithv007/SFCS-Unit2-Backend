# Documentation: Backend Manufacturing Execution System (MES)

## PAGE 10: REWORK

### 1. PAGE NAME
**Rework Management**
*   **What is it?** This page handles the Repairing and reworking boards that failed earlier tests or inspections. in the backend MES workflow.
*   **Why does it exist?** It ensures proper tracking, accountability, and status progression of production batches as they move through the Rework stage.

---

### 2. BUSINESS PURPOSE
*   **Traceability:** Ensures every unit passing through Rework is logged with exact timestamps and operator IDs.
*   **Quality Control:** Prevents defective units from proceeding to the next stage without passing Rework.
*   **Production Visibility:** Allows supervisors to see real-time WIP (Work In Progress) at the Rework station.
*   **What if it didn't exist?** The factory would lose visibility into where bottlenecks are occurring and units might skip critical Rework procedures.

---

### 3. USER ROLES
| Role | Permissions on this Page |
| :--- | :--- |
| **Line Operator** | Can scan barcodes to register and process units through Rework. |
| **Quality Inspector** | Can flag units as defective or requiring rework. |
| **Supervisor** | Can view total throughput, active batches, and override certain locks. |
| **Admin** | Full access including deleting test records if a system error occurred. |

---

### 4. COMPLETE WORKFLOW

#### Standard Processing
1.  **Select/Scan Batch:** User views the pending batches list and selects a Work Order/Batch to process.
2.  **Physical Scan:** User uses a barcode scanner to scan the physical unit at the Rework station.
3.  **Validation:** The backend verifies if the unit passed the PREVIOUS required stage. If not, it rejects the scan.
4.  **Status Update:** If valid, the system processes the unit, updating its status to `COMPLETED` or `PASSED` for Rework.
5.  **Audit:** System logs `scanned_by` and `scanned_at` in the traceability tables.

---

### 5. UI SECTION EXPLANATION
*   **Active Batch Selection:** Dropdown or table to select the current working batch.
*   **Scanning Interface:**
    *   **Scan Input:** Auto-focused input field designed for rapid hardware barcode scanners.
    *   **Live Progress Bar:** Visual representation of `Completed / Total Quantity`.
    *   **Recent Scans Table:** Shows the last 10-20 scanned items with their pass/fail status.
*   **Error/Alert Modals:** Pops up immediately if an invalid scan occurs (e.g., "Unit failed previous stage").

---

### 6. DATABASE DESIGN
**Primary Table:** `rework_batches`

| Column | Type | Purpose | Example |
| :--- | :--- | :--- | :--- |
| `id` | SERIAL | Internal Primary Key | `1024` |
| `work_order_id` | INT | Link to `work_orders` | `5` |
| `batch_number` | VARCHAR | Link to Work Order | `WO2024051300001` |
| `status` | VARCHAR | Current stage | `pending`, `active`, `completed` |
| `created_by` | VARCHAR | User who initiated | `Op_1` |
| `created_at` | TIMESTAMP | Entry time | `2024-05-13 09:00:00` |

*   *Note: For detailed unit tracking, individual scans are also logged in a global traceability or scan history table.*

---

### 7. BACKEND LOGIC
*   **Controller:** `src/controllers/reworkController.ts`
*   **Fetch API (`GET /api/backend/rework`):** Retrieves all batches currently queued for Rework.
*   **Processing API (`POST /api/backend/rework/scan`):**
    *   Verifies the unit barcode exists.
    *   Checks the unit's current status in the database.
    *   Updates the unit's status for the Rework stage.
    *   Uses SQL Transactions (`BEGIN` / `COMMIT`) to ensure both the batch table and traceability tables update simultaneously.

---

### 8. FRONTEND LOGIC
*   **Component:** `src/pages/backend/Rework.tsx`
*   **Auto-Focus Utility:** Uses React `useRef` to keep the scanner input focused to prevent missed scans.
*   **API Integration:** Uses `axios` or `fetch` to communicate with the `rework` endpoints.
*   **State Management:** Local React state (`useState`) manages the list of recent scans and updates the UI instantaneously upon a successful backend response.

---

### 9. STATUS FLOW
1.  **Pending:** The batch has been created but no units have been scanned at Rework yet.
2.  **In Progress:** Units are currently being scanned and processed.
3.  **Completed:** All units in the batch have successfully passed the Rework stage.

---

### 10. VALIDATION RULES
*   **Sequence Enforcement:** A unit cannot be scanned at Rework if it hasn't completed the prerequisite stages.
*   **Duplicate Scan Check:** Scanning the same unit twice throws an "Already Processed" error.
*   **Capacity Limit:** Cannot scan more units than defined in the original Work Order.

---

### 11. AUDIT TRAIL / TRACEABILITY
*   **Action Logging:** Every successful scan and failed attempt is logged.
*   **Accountability:** The exact `user_id` or `operator_name` is tied to every record, ensuring full accountability for quality issues found later in the field.

---

### 12. ERROR SCENARIOS
*   **Wrong Sequence:** Operator scans a unit that skipped a previous test. *System Alert: "Unit failed prerequisite routing."*
*   **Already Scanned:** Operator double-scans. *System Alert: "Unit already processed at Rework."*
*   **Network Failure:** If the connection drops during a scan, the frontend prevents further scanning until connection is restored, ensuring no data loss.

---

### 13. REAL-TIME INDUSTRY SCENARIO
*   **Scenario:** A batch of 500 units arrives at the Rework station.
*   **The Action:** The operator scans the route card, opening the batch on screen. They then scan each unit rapidly. The screen flashes green for each success.
*   **Mistake Prevention:** If a defective unit from a rework bin is accidentally mixed in and scanned, the screen flashes red and an error sound plays, preventing the defective unit from moving forward.

---

### 14. DEVELOPMENT CHALLENGES
*   **High-Speed Scanning:** Ensuring the UI and backend can handle scans happening every 1-2 seconds without race conditions. *Solution: Optimized database indexes and debouncing on the frontend.*
*   **Complex Routing Logic:** Determining if a unit is allowed at Rework requires checking multiple previous tables. *Solution: Utilizing a centralized traceability table or optimized JOIN queries.*

---

### 15. FUTURE IMPROVEMENTS
*   **Machine Integration:** Connect the Rework backend directly to the physical machines (via SECS/GEM or PLC) to automatically pull pass/fail data without manual scanning.
*   **Analytics Dashboard:** Add a real-time yield rate chart specifically for the Rework station.

---

### 16. SIMPLE SUMMARY
*   **Explanation:** This page is the digital checkpoint for the Rework process.
*   **Quick Workflow:** Select Batch -> Scan Units -> Verify Pass -> Move to Next Station.
*   **Key Business Importance:** It guarantees that the Rework step was actually performed and provides the data needed for quality audits.
