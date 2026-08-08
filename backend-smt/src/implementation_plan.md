# Implementation Plan - Redirect Stencil Lifecycle to Stencil Rack Master Source with Integrated Maintenance Workflow

The goal is to redirect the Stencil Lifecycle Management module to retrieve physical stencil details from the Stencil Rack Management database tables (`stencil_rack_locations`) instead of `stencil_master`, and extend the existing Stencil Lifecycle Management page to support in-place stencil maintenance and scrap operations.

All physical storage details will remain in `stencil_rack_locations` (managed by the Stencil Rack Management module), and all lifecycle details (Print Count, Target Life Cycle, Maintenance status, and Maintenance History) will be managed separately by the Stencil Lifecycle module in new database tables.

---

## Target Life Cycle Business Workflow

The Target Life Cycle (for example 60,000 prints) represents the maximum number of prints allowed before the stencil must undergo Maintenance. It does NOT mean the stencil is permanently expired.

1. **Configurable Target**: Every stencil has a configurable Target Life Cycle (defaulting to `60000` prints, retrieved from `system_configuration` table key `'stencil_target_lifecycle'`).
2. **Current Print Count**: During production, the system continuously calculates the current Print Count dynamically as the sum of prints from `smt_stencil_lifecycle` since `last_maintenance_date`.
3. **Limit Overrun Check**: If `Current Print Count + Work Order Quantity > Target Life Cycle`, the system rejects the Lifecycle assignment.
4. **Exact Target Reach**: If `Current Print Count + Work Order Quantity == Target Life Cycle`, the system allows the current Lifecycle assignment to complete successfully. Immediately after completion, the system automatically changes the Lifecycle Status to `MAINTENANCE`. The stencil can no longer be selected for new Lifecycle assignments.
5. **Maintenance Transition**: When the stencil reaches `MAINTENANCE`:
   - The stencil must be physically cleaned and inspected by the responsible engineer or technician.
   - **If the stencil passes inspection (Click "Complete Maintenance")**:
     - Reset the Print Count to 0 (by setting `last_maintenance_date = CURRENT_TIMESTAMP`).
     - Increase Maintenance Count by 1.
     - Update `last_maintenance_date` and `last_maintenance_by` (employee code and name from session).
     - Change Lifecycle Status back to `ACTIVE`.
     - The stencil becomes available for production again.
   - **If the stencil fails inspection or is physically damaged (Click "Scrap Stencil")**:
     - Change Lifecycle Status to `SCRAPPED`.
     - The stencil is permanently retired and can never return to `ACTIVE` status or be selected again.
6. **Immutable Logging**: Every Maintenance, Status Change, and Scrap operation must be recorded in append-only tables (`smt_stencil_maintenance_history`, `smt_stencil_lifecycle_status_history`) and the central `audit_log`. These records are append-only and cannot be modified or deleted.
7. **System Configuration**: Target Life Cycle must be configurable by the System Administrator. Existing stencil records must retain the Target Life Cycle that was assigned when they were first created, but allow per-stencil overrides in `smt_stencil_lifecycle_states.target_life_cycle`.

---

## Proposed Changes

### Database Migrations

#### [NEW] [046_update_lifecycle_maintenance.sql](file:///c:/New-sfcs-unit2/SFCS-Unit2-Backend/backend-smt/src/db/migrations/046_update_lifecycle_maintenance.sql)
1. **Drop old foreign key constraint** pointing to `stencil_master(id)` on `smt_stencil_lifecycle`.
2. **Add new foreign key constraint** pointing `stencil_record_id` in `smt_stencil_lifecycle` to `stencil_rack_locations(id)` ON DELETE RESTRICT.
3. **Create `smt_stencil_lifecycle_states` table** to store lifecycle-specific config and current status per physical stencil:
   - `id` UUID PRIMARY KEY DEFAULT gen_random_uuid()
   - `stencil_record_id` UUID UNIQUE NOT NULL REFERENCES stencil_rack_locations(id) ON DELETE RESTRICT
   - `stencil_rack_number` VARCHAR(100) UNIQUE NOT NULL
   - `target_life_cycle` INTEGER NOT NULL DEFAULT 60000
   - `lifecycle_status` VARCHAR(50) DEFAULT 'ACTIVE' CHECK (lifecycle_status IN ('ACTIVE', 'MAINTENANCE', 'SCRAPPED'))
   - `maintenance_count` INTEGER DEFAULT 0
   - `last_maintenance_date` TIMESTAMP
   - `last_maintenance_by_code` VARCHAR(100)
   - `last_maintenance_by_name` VARCHAR(255)
   - `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
   - `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
   - `created_by` VARCHAR(100)
   - `created_by_name` VARCHAR(255)
   - `updated_by` VARCHAR(100)
   - `updated_by_name` VARCHAR(255)
4. **Create `smt_stencil_maintenance_history` table** (strictly Append-Only, cannot be edited or deleted):
   - `id` UUID PRIMARY KEY DEFAULT gen_random_uuid()
   - `stencil_rack_number` VARCHAR(100) NOT NULL
   - `job_number` VARCHAR(100)
   - `maintenance_count` INTEGER NOT NULL
   - `previous_print_count` INTEGER NOT NULL
   - `reset_print_count` INTEGER NOT NULL DEFAULT 0
   - `lifecycle_status_before` VARCHAR(50) NOT NULL
   - `lifecycle_status_after` VARCHAR(50) NOT NULL
   - `maintenance_date` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
   - `performed_by_code` VARCHAR(100) NOT NULL
   - `performed_by_name` VARCHAR(255) NOT NULL
   - `performed_department` VARCHAR(100)
   - `performed_machine` VARCHAR(100)
   - `remarks` TEXT
   - `action` VARCHAR(50) NOT NULL CHECK (action IN ('Maintenance Completed', 'Scrapped'))
5. **Create `smt_stencil_lifecycle_status_history` table** (strictly Append-Only, cannot be edited or deleted):
   - `id` UUID PRIMARY KEY DEFAULT gen_random_uuid()
   - `stencil_rack_number` VARCHAR(100) NOT NULL
   - `previous_status` VARCHAR(50)
   - `new_status` VARCHAR(50) NOT NULL
   - `changed_by_code` VARCHAR(100) NOT NULL
   - `changed_by_name` VARCHAR(255) NOT NULL
   - `reason` VARCHAR(255) NOT NULL
   - `remarks` TEXT NOT NULL
   - `changed_date` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
6. **Optimize Production Indexes**:
   - `CREATE INDEX IF NOT EXISTS idx_smt_stencil_lifecycle_states_rack_num ON smt_stencil_lifecycle_states(stencil_rack_number);`
   - `CREATE INDEX IF NOT EXISTS idx_smt_stencil_lifecycle_states_record_id ON smt_stencil_lifecycle_states(stencil_record_id);`
   - `CREATE INDEX IF NOT EXISTS idx_smt_stencil_lifecycle_states_status ON smt_stencil_lifecycle_states(lifecycle_status);`
   - `CREATE INDEX IF NOT EXISTS idx_smt_stencil_maintenance_history_rack_num ON smt_stencil_maintenance_history(stencil_rack_number);`
   - `CREATE INDEX IF NOT EXISTS idx_smt_stencil_lifecycle_record_id ON smt_stencil_lifecycle(stencil_record_id);`
   - `CREATE INDEX IF NOT EXISTS idx_smt_stencil_lifecycle_work_order_id ON smt_stencil_lifecycle(work_order_id);`
   - `CREATE INDEX IF NOT EXISTS idx_smt_stencil_status_history_rack_num ON smt_stencil_lifecycle_status_history(stencil_rack_number);`

---

### Backend Components

#### [MODIFY] [stencilRackController.ts](file:///c:/New-sfcs-unit2/SFCS-Unit2-Backend/backend-smt/src/controllers/stencilRackController.ts)
- Wrap Assign and Relocation operations in database transactions (`BEGIN`, `COMMIT`, `ROLLBACK`) using row-level locking (`FOR UPDATE`).
- **Relocation Sync & Verification (`relocateStencil`)**:
  - Verify that the stencil (referenced by `stencil_rack_number` from the source location) does NOT have an active lifecycle assignment (status `'Running'` or `'Available'` in `smt_stencil_lifecycle`). If an active assignment exists, rollback and return HTTP 400:
    `"This stencil is currently assigned to an active Lifecycle and cannot be relocated."`
  - In the same transaction as relocation, update `smt_stencil_lifecycle_states`:
    - Set `stencil_record_id = target_location_id`, `updated_by = sessionUser.employee_code`, `updated_by_name = sessionUser.name`, `updated_at = CURRENT_TIMESTAMP` where `stencil_rack_number = fromLoc.stencil_rack_number`.
- **Assignment Sync (`assignStencil`)**:
  - Normalize `stencil_rack_number`: Trim leading and trailing spaces, replace multiple interior spaces with a single space. Reject if empty.
  - Perform case-insensitive duplicate validation on `stencil_rack_number`.
  - In the same transaction as assignment, update `smt_stencil_lifecycle_states`:
    - Set `stencil_record_id = locationId`, `updated_by = sessionUser.employee_code`, `updated_by_name = sessionUser.name`, `updated_at = CURRENT_TIMESTAMP` where `LOWER(stencil_rack_number) = LOWER($1)`.

#### [MODIFY] [stencilLifecycleController.ts](file:///c:/New-sfcs-unit2/SFCS-Unit2-Backend/backend-smt/src/controllers/stencilLifecycleController.ts)
- Wrap all state changes in database transactions with row-level locking (`FOR UPDATE`).
- Reuse existing lifecycle assignment statuses ('Running', 'Available', 'Completed', 'Expired').
- **Get Active Stencils (`getActiveStencils`)**:
  - Query active/stored stencils from `stencil_rack_locations` (where physical status is `'STORED'` or `'CHECKED_OUT'`).
  - Left join `smt_stencil_lifecycle_states` on `s.stencil_rack_number = states.stencil_rack_number`.
  - Calculate `print_count` dynamically: sum `qty_life_cycle` from `smt_stencil_lifecycle` where `stencil_id = s.stencil_rack_number` and `created_at > last_maintenance_date` (or epoch if none).
  - Calculate remaining health indicators and return:
    - `remaining_life`: `target_life_cycle - print_count`
    - `remaining_percentage`: `(remaining_life / target_life_cycle) * 100`
    - `health_indicator`: `'Green'` (0-80% consumed), `'Yellow'` (>80-90%), `'Orange'` (>90-99%), `'Red'` (>=100% or maintenance required).
  - Exclude `SCRAPPED` stencils from the dropdown list.
- **Create Lifecycle Record (`createLifecycleRecord`)**:
  - Query and lock `stencil_rack_locations` using `FOR UPDATE` inside transaction.
  - Validate physical status: if `'CHECKED_OUT'`, return 400 error:
    `"The selected stencil is currently checked out and cannot be assigned until it has been returned to the rack."`
  - Verify physical status: if not `'STORED'`, return 400 error.
  - Retrieve the stencil's lifecycle state from `smt_stencil_lifecycle_states`. If none exists:
    - Query `system_configuration` for key `'stencil_target_lifecycle'` (fallback to `60000` if not configured).
    - Automatically initialize and insert a new record for this Stencil Rack Number with the retrieved Target Life Cycle, status `'ACTIVE'`, and session audit values.
  - Validate lifecycle status: if `'MAINTENANCE'`, return 400 error:
    `"This stencil has reached its target life cycle and must complete Maintenance before it can be used again."`
  - Validate lifecycle status: if `'SCRAPPED'`, return 400.
  - Validate active assignment: Check if there is already an active assignment (status `'Running'` or `'Available'`) in `smt_stencil_lifecycle` for this `stencil_id = stencil.stencil_rack_number`. If so, return 400:
    `"The selected stencil already has an active lifecycle assignment."`
  - Compute current print count since `last_maintenance_date`.
  - Validate: `print_count + work_order_qty <= target_life_cycle`. If `new_print_count > target_life_cycle`, return 400 validation error.
  - If `print_count + work_order_qty == target_life_cycle`:
    - Automatically change `smt_stencil_lifecycle_states.lifecycle_status` to `'MAINTENANCE'`.
    - Record status transition log in `smt_stencil_lifecycle_status_history` (`ACTIVE` → `MAINTENANCE`, reason: `Target Life Cycle Reached`).
- **Delete Lifecycle Record (`deleteLifecycleRecord`)**:
  - Lock row using `FOR UPDATE`, soft delete the lifecycle record. If print count drops below the target limit and status is `'MAINTENANCE'`, reset status back to `'ACTIVE'`, and insert status transition log (`MAINTENANCE` → `ACTIVE`, reason: `Assignment Deleted`).
- **New Endpoints**:
  - `POST /api/smt/stencil-lifecycle/maintenance/complete`:
    - Authorize: User must have permission `smt_stencil_lifecycle` with action `can_edit`.
    - Lock row using `FOR UPDATE`.
    - Validate status: must be `'MAINTENANCE'`. If already `'ACTIVE'`, return HTTP 400:
      `"This stencil does not currently require Maintenance."`
    - Validate active assignment: verify there is NO active assignment (status `'Running'` or `'Available'`) in `smt_stencil_lifecycle` for this stencil. If so, return 400 error:
      `"Cannot perform Maintenance while the stencil has an active Lifecycle assignment."`
    - Validate mandatory fields: `remarks` and `maintenance_reason` (predefined options: Cleaning, Repair, Inspection Passed, Mesh Replacement, Other).
    - Session-based employee attribution (`sessionUser.employee_code`, `sessionUser.name`, `sessionUser.department`).
    - Transaction block: Resets current prints (sets `last_maintenance_date = CURRENT_TIMESTAMP`), increments `maintenance_count`, sets status to `'ACTIVE'`, inserts status history log (`MAINTENANCE` → `ACTIVE`), inserts history log, updates audit fields, and records standard audit log.
  - `POST /api/smt/stencil-lifecycle/maintenance/scrap`:
    - Authorize: User must have permission `smt_stencil_lifecycle` with action `can_edit`.
    - Lock row using `FOR UPDATE`.
    - Validate status: verify the stencil is not already `'SCRAPPED'`. If so, return HTTP 400:
      `"This stencil has already been scrapped."`
    - Validate active assignment: verify there is NO active assignment (status `'Running'` or `'Available'`) in `smt_stencil_lifecycle` for this stencil. If so, return 400 error:
      `"Cannot perform Maintenance while the stencil has an active Lifecycle assignment."`
    - Validate mandatory fields: `remarks` and `scrap_reason` (predefined options: Physical Damage, Tension Loss, Inspection Failed, Expired, Other).
    - Session-based employee attribution.
    - Transaction block: Sets lifecycle status to `'SCRAPPED'`, inserts status history log (`MAINTENANCE` → `SCRAPPED`), inserts history log, updates audit fields, and records standard audit log.
  - `GET /api/smt/stencil-lifecycle/maintenance/history/:rackNumber`:
    - Retrieves the maintenance logs for a specific stencil.
  - `GET /api/smt/stencil-lifecycle/status-history/:rackNumber`:
    - Retrieves the status change logs for a specific stencil.

- **Search / Pagination Support**:
  - Support filters and searches matching by `stencil_rack_number`, `job_number`, `stencil_name`, and `product_name` (as Model Name).

#### [MODIFY] [smtHelper.ts](file:///c:/New-sfcs-unit2/SFCS-Unit2-Backend/backend-smt/src/utils/smtHelper.ts)
- Update `getAutoPopulateDetailsHelper` to query `stencil_rack_locations` joined with `smt_stencil_lifecycle_states` to resolve all details correctly.

#### [MODIFY] [smtRoutes.ts](file:///c:/New-sfcs-unit2/SFCS-Unit2-Backend/backend-smt/src/routes/smtRoutes.ts)
- Define the new maintenance/status history routes. Include `requirePermission('smt_stencil_lifecycle', 'can_edit')` middleware on complete/scrap routes.

---

### Frontend Components

#### [MODIFY] [StencilLifecycleManagement.tsx](file:///c:/New-sfcs-unit2/SFCS-Unit2-Frontend/src/pages/smt/stencil-lifecycle-management/StencilLifecycleManagement.tsx)
- Enhance searchable dropdown selection and scan lookup:
  - Match by `stencil_name`, `job_number`, or `stencil_rack_number`.
  - Show warning toast if the scanned/typed stencil is `CHECKED_OUT`.
  - Show warning toast if the scanned/typed stencil is in `MAINTENANCE` status.
- Add **Maintenance Operations section**:
  - Rendered inside the existing page, below the selected stencil details, only visible when `selectedStencil.status === 'MAINTENANCE'`.
  - Exposes inputs for Employee Code, Employee Name (both read-only, populated automatically from logged-in user session), and Remarks (editable).
  - Exposes dropdowns for Predefined Maintenance Reason / Predefined Scrap Reason.
  - Exposes two buttons: `[ Approve & Complete Maintenance ]` and `[ Scrap Stencil ]`. Disable/hide buttons if the user does not possess `can_edit` on `smt_stencil_lifecycle`.
- Add **Maintenance History & Status History sections**:
  - Rendered below the Maintenance Operations card, displaying previous logs for the selected stencil.
- **Auto-Refresh**:
  - Refetch active stencils, reload selected stencil states, and refresh dropdown, history, and status immediately after Create, Delete, Maintenance Complete, Scrap, Relocation, or Assignment actions.

---

## Verification Plan

### Automated Verification
1. Run local frontend build to verify TypeScript and packaging:
   - Command: `npm run build` in `SFCS-Unit2-Frontend`
2. Rebuild all microservices in Docker:
   - Command: `docker-compose up -d --build`
3. Run the automated integration test suite:
   - Command: `docker exec -t sfcs-backend-smt node /app/test_rack_auth.js`

### Manual Test Cases (Verification Plan)
1. **Create Lifecycle**: Verify creating a new lifecycle assignment matches physical and active constraints.
2. **Delete Lifecycle**: Check soft deletion and status recovery when prints drop below target.
3. **Reach Target Life Cycle**: Verify exact matching prints triggers MAINTENANCE status.
4. **Maintenance Completion**: Verify ACTIVE state transition, print resetting, history inserts, status history logging, and audit logs.
5. **Scrap Stencil**: Confirm scrap state transitions, status history logging, and disabling further selection.
6. **Search by Job Number**: Search and scan lookup verification.
7. **Search by Stencil Rack Number**: Search and scan lookup verification.
8. **Relocate Stencil**: Relocation transaction and foreign key synchronization.
9. **Prevent Relocation During Active Lifecycle**: Verify block and HTTP 400 error message.
10. **Prevent Duplicate Stencil Rack Number**: Case-insensitive and trimmed spaces validation.
11. **Prevent Duplicate Maintenance**: Verify ACTIVE stencils block maintenance calls.
12. **Permission Validation**: Verify that non-authorized users see a read-only layout and cannot press buttons.
13. **Concurrent User Testing**: Lock validation during simultaneous edits.
14. **Docker Build Verification**: Docker microservices build successfully.
15. **Database Migration Verification**: Applying raw SQL schema updates.
16. **Rollback Verification**: Failed queries correctly roll back all modifications.
17. **Existing Data Compatibility**: Ensure existing locations and lifecycle logs remain intact.
18. **Audit Log Verification**: Check captured Endpoint, Method, IP, and status properties.
19. **Maintenance & Status History Verification**: Verify history tables are append-only with no update/delete capability.
20. **Performance Verification for Large Datasets**: Index check during queries with extensive logs.
21. **Remaining Life and Health Indicator**: Verify Green, Yellow, Orange, and Red health bands are correctly returned and displayed.
22. **Mandatory Scrap / Maintenance Reasons**: Ensure selections are mandatory and validate predefined lists with "Other".
