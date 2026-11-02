# SFCS Production Requirement — Stencil Blocking, Search Status & Assignment Prevention
## Implementation Plan Document

**Document Title:** Stencil Blocking, Search Status & Assignment Prevention Implementation Plan  
**Filename:** `STENCIL_BLOCKING_IMPLEMENTATION_PLAN.md`  
**Target Modules:** Stencil Rack Management (`stencil_rack_locations`), Stencil Search / Barcode Scan, and Stencil Lifecycle Management (`smt_stencil_lifecycle`)  
**Document Version:** 2.0 (Updated with Mandatory Stored-Only Blocking Eligibility Rule)  
**Execution Status:** Validated & Approved for Implementation  

---

## 1. Current Implementation

### 1.1 Database Architecture & Schema
Inspection of the PostgreSQL database `smt_db` and migrations (`043_create_stencil_rack_management.sql`, `044_decouple_stencil_master.sql`, `045_add_stencil_rack_number.sql`, `046_update_lifecycle_maintenance.sql`, `048_drop_stencil_master.sql`, `050_add_work_order_to_stencil_checkout.sql`, `051_add_work_order_side_to_stencil_checkout.sql`) confirms:

1. **`stencil_rack_locations` Table (Single Source of Truth for Physical Stencils):**
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
   - `rack_id UUID REFERENCES stencil_racks(id) ON DELETE CASCADE`
   - `row_number INTEGER NOT NULL`, `column_number INTEGER NOT NULL`
   - `location_code VARCHAR(100) UNIQUE NOT NULL` (e.g. `RACK-100-R01-C01`)
   - `status VARCHAR(50) DEFAULT 'EMPTY' CHECK (status IN ('EMPTY', 'STORED', 'CHECKED_OUT'))`
   - `job_number VARCHAR(100)`
   - `stencil_rack_number VARCHAR(100)` (Physical identifier/barcode, unique across active slots)
   - `stencil_name VARCHAR(255)`, `revision VARCHAR(50)`, `thickness_mills NUMERIC(5,2)`
   - `manufacturing_date DATE`, `side VARCHAR(50) CHECK (side IN ('TOP', 'BOTTOM', 'TOP/BOTTOM'))`
   - `remarks TEXT`
   - `checked_out_by_code VARCHAR(100)`, `checked_out_by_name VARCHAR(255)`, `checked_out_by_dept VARCHAR(255)`, `checked_out_by_role VARCHAR(255)`, `checked_out_at TIMESTAMP`
   - `checked_out_work_order_id VARCHAR(255)`, `checked_out_work_order_number VARCHAR(255)`
   - `checked_out_work_order_side VARCHAR(50)`, `checked_out_machine VARCHAR(255)`, `checked_out_line VARCHAR(255)`, `checked_out_remarks TEXT`
   - `created_by`, `created_by_name`, `updated_by`, `updated_by_name`, `updated_at`

2. **`stencil_racks` Table (Physical Rack Furniture / Cabinets):**
   - `id UUID PRIMARY KEY`, `name VARCHAR(100) UNIQUE`, `rows INTEGER`, `columns INTEGER`
   - `status VARCHAR(50) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE'))`

3. **`smt_stencil_lifecycle_states` Table (Print Cycle & Overhaul Thresholds):**
   - `stencil_record_id UUID UNIQUE REFERENCES stencil_rack_locations(id)`
   - `target_life_cycle INTEGER DEFAULT 60000`, `cycle_number INTEGER DEFAULT 1`, `total_lifetime_prints BIGINT DEFAULT 0`
   - `lifecycle_status VARCHAR(50) DEFAULT 'ACTIVE' CHECK (lifecycle_status IN ('ACTIVE', 'MAINTENANCE', 'SCRAPPED'))`

4. **`smt_stencil_lifecycle` Table (Work Order Assignment Records):**
   - `id UUID PRIMARY KEY`, `stencil_record_id UUID REFERENCES stencil_rack_locations(id)`
   - `work_order_id VARCHAR(255) NOT NULL`, `sides VARCHAR(50)`, `qty_life_cycle INTEGER`, `balance_life_cycle INTEGER`
   - `status VARCHAR(50) DEFAULT 'Available'`

5. **`stencil_rack_movement_history` Table (Historical Audit Trail):**
   - Tracks all transactions: `CREATED`, `ASSIGNED`, `RECEIVED`, `RETURNED`, `RELOCATED`, `UPDATED`.

6. **`audit_log` Table (Central Security & Audit Trail):**
   - Records actor, action, previous value, new value, timestamp, and metadata.

---

### 1.2 Stencil Search & Scanning Workflows
Currently, stencil identification is performed via:
1. **Search Form in Stencil Rack Management (`StencilRackManagement.tsx`):**
   - Queries `GET /api/smt/stencil-rack/stencil-info/:jobNumber` (`getStencilInfoByJob` in `stencilRackController.ts`).
   - Resolves stencil by `stencil_rack_number`, `job_number`, or `stencil_name`.
2. **Scanner Input in Stencil Scan (`StencilScan.tsx`):**
   - Operator scans barcode (`scannedJobNumber`), which queries `GET /api/smt/stencil-rack/stencil-info/:jobNumber`.

---

### 1.3 Checkout and Work Order Assignment Workflows
1. **Physical Checkout (`scanReceive` in `stencilRackController.ts`):**
   - Route: `POST /api/smt/stencil-rack/scan/receive`
   - Requires `location.status === 'STORED'`. Sets `status = 'CHECKED_OUT'` and `checked_out_work_order_id`.
2. **Lifecycle Work Order Assignment (`createLifecycleRecord` in `stencilLifecycleController.ts`):**
   - Route: `POST /api/smt/stencil-lifecycle/create`
   - Requires `stencil.status === 'CHECKED_OUT'`. Inserts assignment into `smt_stencil_lifecycle`.

---

## 2. Root Cause Analysis

1. **Decoupling Omission:** In migration `016`, `stencil_master` had an operational status column: `status VARCHAR(20) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'SCRAPPED'))`. When migration `044` decoupled stencils into `stencil_rack_locations`, only physical occupancy status was preserved: `status CHECK (status IN ('EMPTY', 'STORED', 'CHECKED_OUT'))`. The operational active/blocked status was dropped.
2. **Rack vs Stencil Status Conflation:** The parent rack table `stencil_racks` maintained a `status` column (`ACTIVE`/`INACTIVE`), and `StencilRackManagement.tsx` only implemented Active/Inactive toggling on the **rack shelf**, not on **individual stencil records**.
3. **Checked-Out Form Lockout:** In `StencilRackManagement.tsx` (lines 1066–1072), whenever a stencil is in `CHECKED_OUT` state, all input fields are disabled and action buttons (except "Cancel") are hidden.

---

## 3. Mandatory Blocking Eligibility Rules

The server and frontend strictly enforce this exact rule matrix:

| Stencil State | Block Action | Checkout (`scanReceive`) | Work-Order Assignment (`createLifecycleRecord`) |
|---|---|---|---|
| `EMPTY` | **Reject** — no stencil exists | Not applicable | Not applicable |
| `STORED`, unblocked | **Allow** authorized user to block | Allowed under existing compatibility rules | Existing lifecycle rules apply |
| `STORED`, blocked | **Show Unblock action** | **Strictly Rejected** (HTTP 400) | **Strictly Rejected** (HTTP 400) |
| `CHECKED_OUT`, unblocked | **Reject — blocking not applicable** | Already checked out | Existing lifecycle eligibility rules apply |
| `CHECKED_OUT`, blocked legacy/inconsistent | Preserve existing data; do not alter | **Reject** new checkout operations | **Reject** new assignments |

### Rule Details:
1. **Blocking Allowed ONLY in `STORED` State:**
   - A stencil can be blocked only while it is physically stored in the rack (`status = 'STORED'`).
   - Blocking is **NOT APPLICABLE** to a stencil that is already checked out (`status = 'CHECKED_OUT'`).
2. **Server Enforcement of Checked-Out Block Attempt:**
   - When a user attempts to block a `CHECKED_OUT` stencil, backend immediately rejects the request with HTTP 400:
     `"Blocking is not applicable: this stencil is already checked out. Return it to the rack before blocking."`
3. **Preservation of Checked-Out Stencils:**
   - The system **never** automatically returns, relocates, clears, or changes the physical status of a checked-out stencil to make blocking possible.
   - Its existing work-order, holder, machine, line, checkout timestamp, and lifecycle records remain 100% intact.
   - If the stencil is returned to `STORED` via `scanReturn`, an authorized user may then block it through the normal workflow.

---

## 4. Exact Proposed Changes

### 4.1 Database Impact (`064_add_blocking_to_stencil_rack_locations.sql`)
Add a dedicated, non-breaking blocking flag and metadata to `stencil_rack_locations`:

```sql
-- Migration: 064_add_blocking_to_stencil_rack_locations.sql
-- Purpose: Add authoritative blocking status and audit columns to stencil records

ALTER TABLE stencil_rack_locations 
ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT FALSE NOT NULL,
ADD COLUMN IF NOT EXISTS blocked_reason TEXT NULL,
ADD COLUMN IF NOT EXISTS blocked_by_code VARCHAR(100) NULL,
ADD COLUMN IF NOT EXISTS blocked_by_name VARCHAR(255) NULL,
ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMP NULL;
```

**Technical Justification:**
- Preserves 100% of existing checkout metadata, holder details, and history in `stencil_rack_locations` without breaking the `status` check constraint.
- All existing stencils default to `is_blocked = false`.

### 4.2 Backend Impact
1. **`stencilRackController.ts`:**
   - Implement `toggleStencilBlock`:
     - Checks `smt_stencil_rack` `can_edit` permission (blocks `Operator`).
     - Acquires row lock `FOR UPDATE`.
     - Validates:
       - If `location.status === 'EMPTY'`: Reject (`Cannot block an empty location.`).
       - If blocking and `location.status === 'CHECKED_OUT'`: Reject with `"Blocking is not applicable: this stencil is already checked out. Return it to the rack before blocking."`.
       - If blocking and `location.status === 'STORED'`: Update `is_blocked = true`, `blocked_reason`, `blocked_by_*`, `blocked_at`.
       - If unblocking: Update `is_blocked = false`, clear `blocked_reason`, `blocked_by_*`, `blocked_at`.
     - Records movement history with `action: 'BLOCKED'` or `'UNBLOCKED'`.
     - Records audit log in `audit_log`.
   - Update `getRackLocations` and `getStencilInfoByJob`: Return `is_blocked`, `blocked_reason`, `blocked_by_name`, `blocked_at`.
   - Update `scanReceive`: Within the checkout transaction, verify `if (location.is_blocked)` and reject with:  
     `"Checkout not allowed: this stencil is BLOCKED. Unblock it before checkout."`.
2. **`stencilLifecycleController.ts`:**
   - Update `getActiveStencils`: Filter out blocked stencils (`AND COALESCE(s.is_blocked, false) = false`).
   - Update `createLifecycleRecord`: Check `if (stencil.is_blocked)` and reject with:  
     `"Assignment blocked. Stencil is BLOCKED — NOT APPLICABLE FOR ASSIGNMENT."`.
3. **`smtRoutes.ts`:**
   - Register route `PATCH /stencil-rack/locations/:locationId/block` with `authenticateToken` and `requirePermission('smt_stencil_rack', 'can_edit')`.

### 4.3 Frontend Impact
1. **`StencilRackManagement.tsx`:**
   - Add `is_blocked`, `blocked_reason`, `blocked_by_name`, `blocked_at` to interfaces.
   - Matrix Grid Cells:
     - If `loc.is_blocked`: Display prominent red **BLOCKED** badge.
     - If `loc.status === 'STORED'` and unblocked: Display **Block** action button.
     - If `loc.status === 'STORED'` and blocked: Display **Unblock** action button.
     - If `loc.status === 'CHECKED_OUT'`: Do not offer a usable Block button; show informative tooltip: *"Blocking is not applicable: this stencil is already checked out. Return it to the rack before blocking."*
   - Modal Form:
     - Show authoritative Block/Unblock status and controls following the exact eligibility matrix.
2. **`StencilScan.tsx`:**
   - For blocked stencils, display **BLOCKED — NOT APPLICABLE FOR USE** prominently, display the reason, and disable the checkout action.
3. **`StencilLifecycleManagement.tsx`:**
   - Exclude blocked stencils from dropdown.
   - If a blocked stencil is referenced, show **BLOCKED — NOT APPLICABLE FOR ASSIGNMENT** and disable Create Record.

---

## 5. Concurrency, Security, and Audit

1. **Transaction Safety:** All block, unblock, checkout, and lifecycle operations use PostgreSQL row-level locks (`SELECT ... FOR UPDATE`) within explicit `BEGIN` / `COMMIT` transactions.
2. **Actor Identity:** Captured strictly from the authenticated JWT session context (`sessionUser`), never from client input.
3. **Audit History:** Every status transition writes to both `audit_log` and `stencil_rack_movement_history`.

---

## 6. Backward Compatibility

- All existing stencils default to `is_blocked = false`.
- Existing checked-out stencils, Work Orders, and active print runs remain completely intact.
- Unblocking restores full eligibility under standard compatibility rules.

---

## 7. Test Plan & Acceptance Criteria

1. Verify authorized user can block a `STORED` stencil.
2. Verify unauthorized user cannot block or unblock.
3. Verify blocking a `CHECKED_OUT` stencil is rejected with the exact required error message.
4. Verify empty slots cannot be blocked.
5. Verify searching by barcode, rack number, and job number displays **BLOCKED** status and reason.
6. Verify blocked stencil cannot be checked out via UI or API.
7. Verify blocked stencil cannot be assigned in lifecycle management via UI or API.
8. Verify unblocking restores normal checkout and assignment eligibility.
9. Verify all existing unblocked workflows operate with zero regression.
