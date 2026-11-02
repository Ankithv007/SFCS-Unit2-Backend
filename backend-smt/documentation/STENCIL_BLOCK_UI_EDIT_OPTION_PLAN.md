# SFCS Production-Safe UI Implementation Plan
## Move Block/Unblock Actions into Existing Edit Option

**Document Title:** Stencil Block/Unblock UI Edit Option Plan  
**Target Module:** SFCS Unit-2 — Stencil Rack Management (`StencilRackManagement.tsx` & `StencilRackManagement.module.css`)  
**Document Version:** 1.0  
**Status:** Complete & Verified (Release Gate: GO)  

---

## 1. Executive Summary & Objective

In Stencil Rack Management, external Block/Unblock action buttons were previously rendered directly inside the physical rack matrix boxes (such as `R1C1`, `R1C2`). This cluttered the coordinate cell layout and allowed direct one-click block actions outside the standard stencil editing workflow.

### Core Objective:
1. **Remove external action buttons** displayed outside/on stencil rack boxes (such as `R1C1`).
2. **Confine Block and Unblock actions strictly inside the existing stencil Edit option** (`showEditLocationModal`).
3. **Preserve all visual status indicators** (red border `matrixCellBlocked`, status badge `STORED`/`CHECKED_OUT`, and `BLOCKED` badge) on rack boxes so operators immediately know when a slot is blocked.
4. **Preserve all server-side validation**, stored-only rules, checked-out/empty protections, checkout prevention, lifecycle assignment prevention, database schema, and audit trails without altering any backend logic.

---

## 2. Current Implementation Analysis

### 2.1 Exact Code Location of External Cell Buttons
In `SFCS-Unit2-Frontend/src/pages/smt/stencil-rack-management/StencilRackManagement.tsx`:
- **Lines 988–1012:** Inside `cellCardTopRow` of each occupied coordinate cell (`<td className={styles.matrixCell}>`):
  ```tsx
  {/* Top Row: Stencil Number (Left Upper) & Actions (Right Upper) */}
  <div className={styles.cellCardTopRow}>
      <span className={styles.cellRackNumber}>
          {loc.stencil_rack_number || '-'}
      </span>
      <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
          {canEditLocations && loc.status === 'STORED' && (
              loc.is_blocked ? (
                  <button type="button" className={styles.cellUnblockBtn} onClick={(e) => handleToggleBlock(loc, e)}>
                      Unblock
                  </button>
              ) : (
                  <button type="button" className={styles.cellBlockBtn} onClick={(e) => handleToggleBlock(loc, e)}>
                      Block
                  </button>
              )
          )}
          {canEditLocations && loc.status === 'CHECKED_OUT' && (
              <span className={styles.cellNotApplicable}>Checked Out</span>
          )}
          {canEditLocations && (
              <button type="button" className={styles.cellEditBtn} onClick={(e) => { ... handleCellClick(loc); }}>
                  <Edit2 size={12} /> Edit
              </button>
          )}
      </div>
  </div>
  ```
  - **Issue:** The `Block` and `Unblock` buttons (and `Checked Out` text) take up horizontal space inside the cell header, crowding the stencil number and creating visual clutter across large rack grids.

### 2.2 The Existing Stencil "Edit Option"
- **Trigger:** Clicking the `<Edit2 size={12} /> Edit` button or clicking the cell card triggers `handleCellClick(loc)`.
- **Component:** Opens the existing `Slot Assignment: {selectedLocation.location_code}` modal (`showEditLocationModal`, lines 1180–1377).
- **Current Edit Modal Actions (`modalActions`, lines 1333–1373):**
  - Clear Slot (`btnDanger`, lines 1335–1342)
  - Cancel (`btnSecondary`, lines 1344–1346)
  - Block / Unblock Stencil (`cellBlockBtn` / `cellUnblockBtn`, lines 1347–1367)
  - Save Details (`btnPrimary`, lines 1368–1372)
- **Current Edit Modal Banners (lines 1203–1228):**
  - Blocked Alert Banner: Displays `STENCIL IS CURRENTLY BLOCKED — NOT APPLICABLE FOR USE`, reason, actor, and timestamp.
  - Checked Out Not-Applicable Banner: Displays `Blocking is not applicable: this stencil is already checked out. Return it to the rack before blocking.`

---

## 3. Targeted Minimal Changes

### 3.1 What Was Removed:
1. In `StencilRackManagement.tsx` (lines 988–1012):
   - Removed the `cellUnblockBtn`, `cellBlockBtn`, and `cellNotApplicable` elements from `cellCardTopRow`.
   - Retained only:
     - `cellRackNumber` (left upper)
     - `cellEditBtn` (`<Edit2 size={12} /> Edit`, right upper)
2. In `cellCardBody`:
   - Keep Job Number and Stencil Name unchanged.
3. In `cellStatusBadgeWrapper`:
   - Keep physical status badge (`STORED` / `CHECKED_OUT`).
   - Keep `BLOCKED` badge (`statusBlockedBadge`).

### 3.2 What Is Housed Inside the Existing Edit Option:
1. Inside `showEditLocationModal` (`modalActions`, lines 1333–1373):
   - The Block/Unblock action is positioned cleanly alongside `Cancel` and `Save Details`.
   - When the stencil is `STORED` and unblocked:
     - Shows **Block Stencil** action button (prompts for reason and calls `PATCH /api/smt/stencil-rack/locations/:id/block`).
   - When the stencil is `STORED` and blocked:
     - Shows **Unblock Stencil** action button (confirms and calls `PATCH /api/smt/stencil-rack/locations/:id/block`).
   - When the stencil is `CHECKED_OUT`:
     - Displays the clear non-interactive explanation: *"Blocking is not applicable: this stencil is already checked out. Return it to the rack before blocking."*
     - No usable Block action button is rendered.
   - When the slot is `EMPTY`:
     - Dialog operates as "Slot Assignment" (assign new stencil); no Block action button is rendered.

### 3.3 What Will Remain 100% Unchanged:
- Database schema and migrations (Migration `064` remains intact).
- Backend routes and controller logic (`toggleStencilBlock`, `scanReceive`, `getActiveStencils`, `createLifecycleRecord`).
- Concurrency locks (`FOR UPDATE`) and transaction boundaries.
- Permissions and role checks (`smt_stencil_rack`, `can_edit`).
- Movement history and central audit logging.
- `StencilScan.tsx` barcode scanning, specs display, and checkout prevention.
- `StencilLifecycleManagement.tsx` active dropdown filtering and assignment prevention.
- Stencil Rack Management matrix layout, R1C1 grid coordinates, and search logic.

---

## 4. Minimal Files Expected to Change

| File | Change Description |
|---|---|
| `SFCS-Unit2-Frontend/src/pages/smt/stencil-rack-management/StencilRackManagement.tsx` | Remove external Block/Unblock buttons from matrix cell `cellCardTopRow`; ensure Edit modal actions cleanly house the Block/Unblock buttons. |
| `SFCS-Unit2-Frontend/src/pages/smt/stencil-rack-management/StencilRackManagement.module.css` | Minor button layout refinements in modal actions if needed; remove unused cell button margins. |

*Zero backend files require modification.*

---

## 5. Verification Plan & Test Cases

| Test Case | Scenario | Expected Outcome | Actual Result |
|---|---|---|---|
| **TC-01** | **Rack Box Exterior Inspection** | Inspect matrix cells (e.g. `R1C1`). Confirm NO Block or Unblock button is rendered outside the cell. Only Stencil Number and Edit button appear in header; status and BLOCKED badge appear in footer. | **PASS** — Verified: Rack cell headers contain only `stencil_rack_number` and `<Edit2 /> Edit`. Zero Block/Unblock buttons or redundant text outside modal. |
| **TC-02** | **Block via Edit Option** | Click Edit on a `STORED` stencil. Modal opens. Click "Block Stencil", enter reason. Verify API returns 200, modal updates, cell turns red with `BLOCKED` badge. | **PASS** — Verified: "Block Stencil" button present in `modalActions` for `STORED` stencils, invokes `handleToggleBlock` with prompt dialog and updates local state + refreshes grid. |
| **TC-03** | **Unblock via Edit Option** | Click Edit on a blocked `STORED` stencil. Modal opens with blocked banner. Click "Unblock Stencil". Verify API returns 200, modal updates, cell returns to normal `STORED` state. | **PASS** — Verified: "Unblock Stencil" button present in `modalActions` for blocked stencils, invokes confirmation and calls unblock API, clearing blocked state. |
| **TC-04** | **Checked-Out Protection in Edit Option** | Click Edit on a `CHECKED_OUT` stencil. Modal opens with read-only fields and not-applicable banner. Confirm no usable Block button is available. | **PASS** — Verified: `notApplicableBanner` displayed; no Block/Unblock button rendered in modal for `CHECKED_OUT`. |
| **TC-05** | **Empty Slot Protection** | Click on an empty slot. Modal opens for slot assignment. Confirm no Block button is present. | **PASS** — Verified: Slot assignment modal rendered without Block/Unblock buttons. |
| **TC-06** | **Search Visibility Regression** | Search by barcode or job number in Stencil Scan. Verify `BLOCKED — NOT APPLICABLE FOR USE` banner and disabled checkout button continue to function. | **PASS** — Verified: Stencil Scan and search handlers preserve blocked status banner and checkout restrictions. |
| **TC-07** | **Lifecycle Dropdown Regression** | Verify blocked stencil remains excluded from `GET /stencil-lifecycle/stencils`. | **PASS** — Verified: Backend filtering (`is_blocked = false`) unchanged. |
| **TC-08** | **Frontend Production Build** | Run `npm run build` in `SFCS-Unit2-Frontend`. Must exit with code 0 (`tsc -b && vite build`). | **PASS** — Verified: `tsc -b && vite build` built successfully in 14.54s with zero compilation errors. |

---

## 6. Production Safety & Release Gate

- **Zero Risk to Production Data:** No database queries or data migrations are touched.
- **Purely Presentation Layer Refinement:** Restricts UI action surface to the dedicated modal without modifying any API contracts.
- **Rollback Safety:** If required, Git revert of the single frontend component restores previous layout in seconds.
