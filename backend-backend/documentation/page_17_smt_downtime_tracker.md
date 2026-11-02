# Documentation: SMT Manufacturing Execution System (MES)

## PAGE 17: SMT DOWNTIME TRACKER

### 1. PAGE NAME
**SMT Line Downtime Tracking & Incident Logger**
*   **What is it?** This page documents the SMT Downtime Tracker module, which logs line stoppages and calculates Mean Time to Repair (MTTR) and Mean Time Between Failures (MTBF).
*   **Why does it exist?** It enables supervisors to identify production line bottlenecks, track equipment reliability, and audit technician response times.

---

### 2. BUSINESS PURPOSE
*   **Production Stoppage Auditing:** Classifies downtime reasons (e.g., Mechanical, Electrical, Feeder Fault, Material Shortage, Software Error) for Pareto analysis.
*   **Equipment Effectiveness (OEE):** Provides raw duration metrics needed to compute SMT line efficiency and availability metrics.
*   **What if it didn't exist?** Machine breakdowns would go undocumented, meaning maintenance managers would lack the data required to establish preventive maintenance schedules.

---

### 3. USER ROLES
| Role | Permissions on this Page |
| :--- | :--- |
| **Line Operator** | Can open new downtime incidents; cannot edit or delete closed logs. |
| **Technician / Engineer** | Can edit records to add repair action descriptions, technician names, and close incidents. |
| **Supervisor / Admin** | Can view dashboards, export reports, edit historical logs, and delete erroneous records. |

---

### 4. COMPLETE WORKFLOW
1.  **Breakdown Event:** A machine (e.g., Reflow Oven) halts production.
2.  **Incident Creation:** The operator creates a record by logging the line, machine name, downtime category, and start time.
3.  **Work Order Linking:** The operator optionally links the incident to the active Work Order.
4.  **Repair Execution:** The technician performs the physical repair.
5.  **Incident Closure:** The technician logs the end time, action taken, and marks the status as `Closed`.
6.  **Duration & Metrics Update:** The backend calculates the duration in minutes, refreshing the MTTR/MTBF dashboard gauges.

---

### 5. UI SECTION EXPLANATION
*   **Live Incident Form:** Form fields specifying: Shift, Line, Machine Name, Start Time, End Time, Category, Description, Action Taken, and Responsible Person.
*   **Active Downtime Grid:** Table listing currently unresolved (`Open`) incidents in red.
*   **Analytics Dashboard:** Visual representation of:
    *   *Total Downtime Duration* (Sum of durations).
    *   *Most Affected Machine* and *Most Frequent Category*.
    *   *Category Pareto Chart* & *Shift Breakdown* pie charts.

---

### 6. DATABASE DESIGN
#### Table: `smt_downtime_records`
*   `id` (SERIAL PRIMARY KEY)
*   `shift` (VARCHAR - e.g., 'A', 'B', 'C')
*   `line` (VARCHAR - SMT Line Identifier)
*   `machine_name` (VARCHAR - e.g., 'Printer', 'SPI', 'AOI', 'Pick & Place')
*   `start_time` (TIMESTAMP)
*   `end_time` (TIMESTAMP)
*   `duration` (NUMERIC - in minutes)
*   `downtime_category` (VARCHAR)
*   `downtime_description` (TEXT)
*   `action_taken` (TEXT)
*   `responsible_person` (VARCHAR - Technician Name)
*   `status` (VARCHAR - 'Open', 'Closed')
*   `remarks` (TEXT)
*   `created_by` / `created_by_name` (VARCHAR)
*   `updated_by` / `updated_by_name` (VARCHAR)
*   `work_order_id` (INT REFERENCES `smt_work_orders` ON DELETE SET NULL)
*   `created_at` / `updated_at` (TIMESTAMP)

---

### 7. BACKEND LOGIC
*   **Controller:** `backend-smt/src/controllers/smtDowntimeController.ts`
*   **Service:** `backend-smt/src/services/smtDowntimeService.ts`
*   **Key APIs:**
    *   `POST /api/downtime` (creates record, validates times)
    *   `PUT /api/downtime/:id` (updates record, computes duration)
    *   `GET /api/downtime/dashboard` (queries aggregates: SUM, AVG, GROUP BY machine/shift)

---

### 8. FRONTEND LOGIC
*   **Component:** `src/pages/smt/downtime-tracker/DowntimeTracker.tsx`
*   **Charts Integration:** Uses responsive charts to show breakdown metrics.
*   **Dynamic Binding:** Displays pending work orders in a dropdown.

---

### 9. STATUS FLOW
1.  **Open:** Machine is currently stopped. No end time logged.
2.  **Closed:** Machine is repaired and back in production. Duration is finalized.

---

### 10. VALIDATION RULES
*   **Chronology Guard:** `end_time` must be greater than `start_time`.
*   **Work Order Link check:** Cannot link downtime to a Work Order that is already marked as `Completed` or `Closed`. Only `Pending` or `In Progress` statuses are permitted.

---

### 11. AUDIT TRAIL / TRACEABILITY
*   **Created/Updated By:** Saves operator session details (`email` and `name`) to log fields.
*   **Edit History:** Modifying details of a closed downtime record updates the `updated_by` columns.

---

### 12. ERROR SCENARIOS
*   **Work Order Mismatch:** Linking an inactive work order returns 400 Bad Request: *"Work Order is completed. Only Pending or In Progress Work Orders can be linked."*
*   **Invalid Date Entry:** Blank or invalid date strings return: *"Invalid start time or end time."*

---

### 13. REAL-TIME INDUSTRY SCENARIO
During a night shift, the Squeegee blade on SMT Line 1 jams. The operator opens a downtime incident under category "Mechanical" for machine "Printer" and links it to the active Work Order `WO-998822`. The maintenance team is alerted. The technician replaces the blade mechanism, inputs "Replaced bent squeegee blade," logs the end time, and closes the incident. The system records 22 minutes of downtime, updating the shift OEE logs.

---

### 14. DEVELOPMENT CHALLENGES
*   **Work Order Consistency:** Ensuring users didn't link downtime to historical work orders, which would distort performance calculations.
*   **Solution:** Implemented checks in `smtDowntimeService.ts` verifying that `smt_production_status` is either `pending` or `in progress`.

---

### 15. FUTURE IMPROVEMENTS
*   **Auto Stoppage Alerts:** Send real-time Slack/WhatsApp alerts to maintenance engineers if an incident remains `Open` for more than 15 minutes.

---

### 16. SIMPLE SUMMARY
*   **Explanation:** Incident tracking tool that logs production line stoppages, validates timestamps, links records to active work orders, and visualizes MTTR/MTBF performance.
*   **Commits:** `c5a78f1`
