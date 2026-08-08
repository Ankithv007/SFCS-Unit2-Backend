# Documentation: SMT Manufacturing Execution System (MES)

## PAGE 22: SOLDER PASTE MANAGEMENT

### 1. PAGE NAME
**Solder Paste Lifecycle & Inventory Control**
*   **What is it?** This page documents the Solder Paste Management module, which manages the inventory and processing history of solder paste containers.
*   **Why does it exist?** Solder paste is chemical-sensitive and must undergo strict refrigeration, thawing, and mixing before it can be applied to circuit boards.

---

### 2. BUSINESS PURPOSE
*   **Prevent Chemical Defects:** Enforces thawing limits to prevent water condensation (leading to solder spattering) and mixing limits to ensure viscosity.
*   **FIFO Rule Enforcement:** Reduces material waste by ensuring older solder paste containers are consumed before newer batches.
*   **What if it didn't exist?** Operators could mount cold or unmixed solder paste directly onto the stencil printer, resulting in solder voids, bridges, and rework.

---

### 3. USER ROLES
| Role | Permissions on this Page |
| :--- | :--- |
| **Material Handler** | Can register incoming cans, log refrigeration entry, and place cans in thawing bins. |
| **Line Operator** | Can start mixing cycles, scan cans onto active lines, and log empty containers. |
| **Quality Inspector** | Can view lifecycle history, audit expiration alerts, and override expired warnings. |

---

### 4. COMPLETE WORKFLOW
1.  **Refrigeration Entry:** Incoming solder paste cans are scanned and placed into storage (held between 2-10°C).
2.  **Thawing Initiation:** Handler retrieves a can and scans it out of the refrigerator, starting a 2-hour countdown timer.
3.  **Mixing Execution:** Once thawed, the operator places the can on the mixer, starting a 5-minute mixing log.
4.  **Printing Consumption:** The jar is mounted on the screen printer, starting an 8-hour line-exposure timer.
5.  **Splitting (Parent-Child):** Large containers can be split into smaller containers, inheriting original batch codes and expiration dates.
6.  **Discard:** Empty or expired cans are registered as consumed.

---

### 5. UI SECTION EXPLANATION
*   **FIFO Selection Dashboard:** Highlights the next eligible solder paste container to prevent older jars from expiring.
*   **Active Thaw Timers:** Visual radial progress bars showing remaining thaw time.
*   **Mixing Panel:** Toggle buttons to log mixing starts and finishes.
*   **Active Line Inventory:** Displays jars currently mounted on squeegees.

---

### 6. DATABASE DESIGN
#### Table: `solder_paste_cans`
*   `id` (SERIAL PRIMARY KEY)
*   `can_code` / `batch_number` (VARCHAR UNIQUE)
*   `expiry_date` (DATE)
*   `weight_grams` (NUMERIC)
*   `status` (VARCHAR - e.g., 'Refrigerated', 'Thawing', 'Mixed', 'Active', 'Consumed', 'Expired')
*   `parent_can_id` (INT - Self-reference for container splitting)
*   `created_at` (TIMESTAMP)

#### Table: `solder_paste_sessions`
*   `id` (SERIAL PRIMARY KEY)
*   `can_id` (INT REFERENCES `solder_paste_cans`)
*   `action_type` (VARCHAR - 'REFRIGERATE', 'THAW', 'MIX', 'LINE_MOUNT')
*   `start_time` / `end_time` (TIMESTAMP)
*   `line` (VARCHAR)
*   `work_order_id` (INT)
*   `elapsed_time_minutes` (INT)
*   `created_by` (VARCHAR)

---

### 7. BACKEND LOGIC
*   **Controller:** `backend-smt/src/controllers/spMasterController.ts`
*   **Validation Logic:**
    *   `getFifoCan` queries the oldest active can inside the refrigerator matching the product specifications.
    *   `startSession` checks that state transition rules are respected (e.g. cannot mix a can that is currently marked as Refrigerated).

---

### 8. FRONTEND LOGIC
*   **Component:** `src/pages/smt/solder-paste/SolderPaste.tsx`
*   **Countdown Logic:** Uses browser-level intervals to calculate remaining thaw minutes and mix seconds dynamically.

---

### 9. STATUS FLOW
1.  **Refrigerated:** Temperature-controlled storage.
2.  **Thawing:** Room-temperature exposure (minimum 2 hours, maximum 24 hours).
3.  **Mixed:** Agitated and homogenized (minimum 5 minutes).
4.  **Active:** Mounted on stencil printer.
5.  **Consumed / Expired:** Final states.

---

### 10. VALIDATION RULES
*   **Thaw Threshold:** A container cannot transition to Mixed unless it has thawed for at least 120 minutes.
*   **Exposure Limit:** Warns operator if a container remains mounted on the line for more than 480 minutes (8 hours).
*   **FIFO Warning:** Shows alert popup if operator scans a container that is newer than a matching refrigerated jar.

---

### 11. AUDIT TRAIL / TRACEABILITY
*   **Ancestry Mapping:** Split canisters map their `parent_can_id` back to the source container, ensuring batch-level trace.
*   **Activity Logs:** Every transition is written to `solder_paste_sessions` with operator signatures.

---

### 12. ERROR SCENARIOS
*   **Skipped Thawing:** Operator tries to mix a refrigerated can. *System Alert: "Can must thaw for at least 120 minutes."*
*   **Out of Temp:** A jar was left thawing for 30 hours. *System Alert: "Can exceeded maximum thaw window (24 hours). Mark as expired."*

---

### 13. REAL-TIME INDUSTRY SCENARIO
A production run is planned. The handler checks the Solder Paste dashboard. The system recommends Jar `SP-992` based on FIFO rules. The handler scans `SP-992` out of the refrigerator. Two hours later, a notification clears it. The operator mixes it for 5 minutes, mounts it on SMT Line 1, and scans it. The system allows board printing to proceed.

---

### 14. DEVELOPMENT CHALLENGES
*   **Container Splitting:** Production lines sometimes require portioning a large jar of solder paste into smaller dispensers. Maintaining batch tracing and safety limits across split jars was complex.
*   **Solution:** Built a recursive database join (`parent_can_id`) that automatically duplicates batch data and forces child canisters to expire when the parent's exposure timer runs out.

---

### 15. FUTURE IMPROVEMENTS
*   **Smart Refrigerators:** Integrate IoT scales and barcode cameras inside refrigerator racks to automate stock logging.

---

### 16. SIMPLE SUMMARY
*   **Explanation:** Inventory tracking module that monitors solder paste temperature cycles, logs thawing and mixing, enforces FIFO, and traces jar splits.
*   **Commits:** `cea4a50`, `b6f8f3e`
