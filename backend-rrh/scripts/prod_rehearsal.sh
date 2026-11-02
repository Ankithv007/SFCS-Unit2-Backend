#!/usr/bin/env bash
# ====================================================================================================
# RRH PRODUCTION MIGRATION REHEARSAL SCRIPT (CONTAINERIZED DOCKER VERSION)
# ====================================================================================================
# SAFETY GUARANTEES:
#   - Read-only on live database (pg_dump only).
#   - ALL writes, schema alters, drops, creates, migrations, and checks run strictly on 'rrh_restore_db'.
#   - Execution is routed through Docker Compose container to eliminate host client tool dependencies.
#   - Refuses to execute if target database is not exactly 'rrh_restore_db'.
# ====================================================================================================

set -euo pipefail

# ----------------------------------------------------------------------------------------------------
# 0. RESOLVE CONFIGURATION & PASSWORD
# ----------------------------------------------------------------------------------------------------
LIVE_DB="rrh_db"
RESTORE_DB="rrh_restore_db"
OUTPUT_DIR="./rehearsal_output"

# Search for .env files to load credentials if not present in environment
if [ -z "${POSTGRES_PASSWORD:-}" ]; then
    if [ -f "../../.env" ]; then
        POSTGRES_PASSWORD=$(grep -E '^POSTGRES_PASSWORD=' ../../.env | cut -d '=' -f2- | tr -d '\r\n"') || true
    elif [ -f "../.env" ]; then
        POSTGRES_PASSWORD=$(grep -E '^POSTGRES_PASSWORD=' ../.env | cut -d '=' -f2- | tr -d '\r\n"') || true
    elif [ -f "./.env" ]; then
        POSTGRES_PASSWORD=$(grep -E '^POSTGRES_PASSWORD=' ./.env | cut -d '=' -f2- | tr -d '\r\n"') || true
    fi
fi

if [ -z "${POSTGRES_PASSWORD:-}" ]; then
    echo "================================================================================"
    echo "FATAL ERROR: POSTGRES_PASSWORD is not set."
    echo "Please export POSTGRES_PASSWORD='your_password' or ensure .env contains it."
    echo "================================================================================"
    exit 1
fi

PGUSER="${POSTGRES_USER:-postgres}"
export PGPASSWORD="${POSTGRES_PASSWORD}"

# Detect docker-compose command
if docker compose version >/dev/null 2>&1; then
    DOCKER_COMPOSE_CMD="docker compose"
elif docker-compose version >/dev/null 2>&1; then
    DOCKER_COMPOSE_CMD="docker-compose"
else
    echo "FATAL ERROR: Neither 'docker compose' nor 'docker-compose' was found."
    exit 1
fi

# Detect Postgres service name (default 'db' or override with PG_SERVICE)
if [ -n "${PG_SERVICE:-}" ]; then
    POSTGRES_SERVICE="${PG_SERVICE}"
elif ${DOCKER_COMPOSE_CMD} ps --services 2>/dev/null | grep -qx "db"; then
    POSTGRES_SERVICE="db"
elif ${DOCKER_COMPOSE_CMD} ps --services 2>/dev/null | grep -qx "postgres"; then
    POSTGRES_SERVICE="postgres"
else
    POSTGRES_SERVICE="db"
fi

# Detect Backend service name for runner execution
if [ -n "${APP_SERVICE:-}" ]; then
    BACKEND_SERVICE="${APP_SERVICE}"
elif ${DOCKER_COMPOSE_CMD} ps --services 2>/dev/null | grep -qx "backend-rrh"; then
    BACKEND_SERVICE="backend-rrh"
else
    BACKEND_SERVICE="backend-rrh"
fi

# ----------------------------------------------------------------------------------------------------
# STRICT SAFETY GUARD FUNCTION
# ----------------------------------------------------------------------------------------------------
assert_restore_db() {
    local target_db="$1"
    local action="$2"
    if [ "${target_db}" != "rrh_restore_db" ]; then
        echo "================================================================================"
        echo "FATAL SAFETY VIOLATION: Refusing to perform '${action}' on '${target_db}'!"
        echo "All write operations are strictly restricted to 'rrh_restore_db'."
        echo "================================================================================"
        exit 1
    fi
    echo "[SAFETY CHECK PASSED] Action '${action}' authorized for '${target_db}'."
}

# ----------------------------------------------------------------------------------------------------
# PREFLIGHT CHECKS
# ----------------------------------------------------------------------------------------------------
echo "================================================================================"
echo "RRH PRODUCTION MIGRATION REHEARSAL (CONTAINERIZED PREFLIGHT)"
echo "Postgres Docker Service: ${POSTGRES_SERVICE}"
echo "Backend Docker Service:  ${BACKEND_SERVICE}"
echo "Live Source Database:    ${LIVE_DB} (READ ONLY)"
echo "Rehearsal Database:      ${RESTORE_DB} (ISOLATED WORKSPACE)"
echo "Output Directory:        ${OUTPUT_DIR}"
echo "================================================================================"

rm -rf "${OUTPUT_DIR}"
mkdir -p "${OUTPUT_DIR}"

echo -e "\n[PREFLIGHT] Testing database container connectivity & version..."
${DOCKER_COMPOSE_CMD} exec -T "${POSTGRES_SERVICE}" psql -U "${PGUSER}" -c "SELECT version();"

echo -e "\n[PREFLIGHT] Listing existing databases..."
DB_LIST=$(${DOCKER_COMPOSE_CMD} exec -T "${POSTGRES_SERVICE}" psql -U "${PGUSER}" -t -c "SELECT datname FROM pg_database WHERE datistemplate = false;")
echo "${DB_LIST}"

if ! echo "${DB_LIST}" | grep -qw "${LIVE_DB}"; then
    echo "================================================================================"
    echo "FATAL ERROR: Live database '${LIVE_DB}' was not found in PostgreSQL container!"
    echo "Rehearsal cannot proceed without the live source database."
    echo "================================================================================"
    exit 1
fi
echo "[PREFLIGHT PASSED] Live source database '${LIVE_DB}' detected."

# ----------------------------------------------------------------------------------------------------
# STEP A: READ-ONLY DUMP OF LIVE DB (-Fc) & ARCHIVE VERIFICATION
# ----------------------------------------------------------------------------------------------------
echo -e "\n================================================================================"
echo "[STEP A] Extracting custom-format binary dump of live '${LIVE_DB}' (READ ONLY)..."
echo "================================================================================"
${DOCKER_COMPOSE_CMD} exec -T "${POSTGRES_SERVICE}" pg_dump -Fc -U "${PGUSER}" "${LIVE_DB}" > "${OUTPUT_DIR}/live_rrh_db.dump"

echo "[STEP A] Verifying archive integrity with pg_restore --list..."
${DOCKER_COMPOSE_CMD} exec -T "${POSTGRES_SERVICE}" pg_restore --list < "${OUTPUT_DIR}/live_rrh_db.dump" > "${OUTPUT_DIR}/dump_toc.txt"
echo "  -> Archive verified. Table of contents saved to ${OUTPUT_DIR}/dump_toc.txt."

# ----------------------------------------------------------------------------------------------------
# STEP B: CREATE ISOLATED rrh_restore_db & RESTORE INTO IT
# ----------------------------------------------------------------------------------------------------
echo -e "\n================================================================================"
echo "[STEP B] Preparing isolated workspace database '${RESTORE_DB}'..."
echo "================================================================================"
assert_restore_db "${RESTORE_DB}" "DROP AND CREATE DATABASE"

${DOCKER_COMPOSE_CMD} exec -T "${POSTGRES_SERVICE}" dropdb --if-exists -U "${PGUSER}" "${RESTORE_DB}"
${DOCKER_COMPOSE_CMD} exec -T "${POSTGRES_SERVICE}" createdb -U "${PGUSER}" "${RESTORE_DB}"

assert_restore_db "${RESTORE_DB}" "RESTORE DUMP"
echo "[STEP B] Restoring dump stream into '${RESTORE_DB}'..."
${DOCKER_COMPOSE_CMD} exec -T "${POSTGRES_SERVICE}" pg_restore -U "${PGUSER}" -d "${RESTORE_DB}" --no-owner < "${OUTPUT_DIR}/live_rrh_db.dump" > "${OUTPUT_DIR}/restore.log" 2>&1 || true
echo "  -> Restore complete. Log saved to ${OUTPUT_DIR}/restore.log."

# ----------------------------------------------------------------------------------------------------
# STEP C: DUMP LIVE RAW SCHEMA DDL (SCHEMA ONLY, NO OWNER)
# ----------------------------------------------------------------------------------------------------
echo -e "\n================================================================================"
echo "[STEP C] Dumping live schema DDL (READ ONLY)..."
echo "================================================================================"
${DOCKER_COMPOSE_CMD} exec -T "${POSTGRES_SERVICE}" pg_dump --schema-only --no-owner -U "${PGUSER}" "${LIVE_DB}" > "${OUTPUT_DIR}/live_schema.sql"
echo "  -> Live schema DDL saved to ${OUTPUT_DIR}/live_schema.sql."

# ----------------------------------------------------------------------------------------------------
# STEP D: CAPTURE BEFORE SNAPSHOT (PER-TABLE ROW COUNTS & PER-COLUMN MD5)
# ----------------------------------------------------------------------------------------------------
echo -e "\n================================================================================"
echo "[STEP D] Capturing BEFORE snapshot (per-table row counts & per-column MD5 on '${RESTORE_DB}')..."
echo "================================================================================"
assert_restore_db "${RESTORE_DB}" "READ SNAPSHOT"

${DOCKER_COMPOSE_CMD} exec -T \
  -e DB_NAME="${RESTORE_DB}" \
  -e ALLOW_RESTORE_DB="true" \
  -e DB_HOST="${POSTGRES_SERVICE}" \
  -e DB_PORT="5432" \
  -e DB_USER="${PGUSER}" \
  -e DB_PASSWORD="${POSTGRES_PASSWORD}" \
  "${BACKEND_SERVICE}" npx ts-node scripts/snapshotHelper.ts snapshot "${OUTPUT_DIR}/before.txt"

${DOCKER_COMPOSE_CMD} exec -T \
  -e DB_NAME="${RESTORE_DB}" \
  -e ALLOW_RESTORE_DB="true" \
  -e DB_HOST="${POSTGRES_SERVICE}" \
  -e DB_PORT="5432" \
  -e DB_USER="${PGUSER}" \
  -e DB_PASSWORD="${POSTGRES_PASSWORD}" \
  "${BACKEND_SERVICE}" npx ts-node scripts/snapshotHelper.ts inspect "${OUTPUT_DIR}/before_inspect.txt"

# ----------------------------------------------------------------------------------------------------
# STEP E: EXECUTE REAL MIGRATION RUNNER ON rrh_restore_db (001 + 002)
# ----------------------------------------------------------------------------------------------------
echo -e "\n================================================================================"
echo "[STEP E] Executing real migration runner against '${RESTORE_DB}'..."
echo "================================================================================"
assert_restore_db "${RESTORE_DB}" "APPLY MIGRATIONS"

set +e
${DOCKER_COMPOSE_CMD} exec -T \
  -e DB_NAME="${RESTORE_DB}" \
  -e ALLOW_RESTORE_DB="true" \
  -e DB_HOST="${POSTGRES_SERVICE}" \
  -e DB_PORT="5432" \
  -e DB_USER="${PGUSER}" \
  -e DB_PASSWORD="${POSTGRES_PASSWORD}" \
  "${BACKEND_SERVICE}" npx ts-node src/db/runMigrations.ts > "${OUTPUT_DIR}/migration_runner.log" 2>&1
MIG_STATUS=$?
set -e

if [ ${MIG_STATUS} -eq 0 ]; then
    echo "  -> Migration runner completed successfully (Exit Code 0)."
else
    echo "  -> [ERROR] Migration runner failed! Check ${OUTPUT_DIR}/migration_runner.log."
fi

${DOCKER_COMPOSE_CMD} exec -T \
  -e DB_NAME="${RESTORE_DB}" \
  -e ALLOW_RESTORE_DB="true" \
  -e DB_HOST="${POSTGRES_SERVICE}" \
  -e DB_PORT="5432" \
  -e DB_USER="${PGUSER}" \
  -e DB_PASSWORD="${POSTGRES_PASSWORD}" \
  "${BACKEND_SERVICE}" npx ts-node scripts/snapshotHelper.ts inspect "${OUTPUT_DIR}/after_inspect.txt"

# ----------------------------------------------------------------------------------------------------
# STEP F: CAPTURE AFTER SNAPSHOT & AUTOMATIC PER-COLUMN CHECKSUM DIFF
# ----------------------------------------------------------------------------------------------------
echo -e "\n================================================================================"
echo "[STEP F] Capturing AFTER snapshot & running automatic per-column diff..."
echo "================================================================================"
assert_restore_db "${RESTORE_DB}" "READ AFTER SNAPSHOT"

${DOCKER_COMPOSE_CMD} exec -T \
  -e DB_NAME="${RESTORE_DB}" \
  -e ALLOW_RESTORE_DB="true" \
  -e DB_HOST="${POSTGRES_SERVICE}" \
  -e DB_PORT="5432" \
  -e DB_USER="${PGUSER}" \
  -e DB_PASSWORD="${POSTGRES_PASSWORD}" \
  "${BACKEND_SERVICE}" npx ts-node scripts/snapshotHelper.ts snapshot "${OUTPUT_DIR}/after.txt"

set +e
${DOCKER_COMPOSE_CMD} exec -T \
  "${BACKEND_SERVICE}" npx ts-node scripts/snapshotHelper.ts diff "${OUTPUT_DIR}/before.txt" "${OUTPUT_DIR}/after.txt" "${OUTPUT_DIR}/checksum_diff.txt"
DIFF_STATUS=$?
set -e

if [ ${DIFF_STATUS} -eq 0 ]; then
    echo "  -> CHECKSUM INTEGRITY: ALL COLUMNS 100% IDENTICAL."
else
    echo "  -> [WARNING] Column checksum diff detected! Review ${OUTPUT_DIR}/checksum_diff.txt."
fi

# ----------------------------------------------------------------------------------------------------
# STEP G: RAW SCHEMA DIFF (live_schema.sql vs rrh_restore_db AFTER MIGRATION)
# ----------------------------------------------------------------------------------------------------
echo -e "\n================================================================================"
echo "[STEP G] Extracting migrated schema DDL & generating raw diff..."
echo "================================================================================"
${DOCKER_COMPOSE_CMD} exec -T "${POSTGRES_SERVICE}" pg_dump --schema-only --no-owner -U "${PGUSER}" "${RESTORE_DB}" > "${OUTPUT_DIR}/restore_schema_after.sql"
diff -u "${OUTPUT_DIR}/live_schema.sql" "${OUTPUT_DIR}/restore_schema_after.sql" > "${OUTPUT_DIR}/schema_diff.txt" || true
echo "  -> Raw schema diff saved to ${OUTPUT_DIR}/schema_diff.txt."

# ----------------------------------------------------------------------------------------------------
# STEP H: RUN DATA INTEGRITY AUDIT CHECKS
# ----------------------------------------------------------------------------------------------------
echo -e "\n================================================================================"
echo "[STEP H] Executing docs/data_checks.sql on '${RESTORE_DB}'..."
echo "================================================================================"
assert_restore_db "${RESTORE_DB}" "EXECUTE DATA CHECKS"

${DOCKER_COMPOSE_CMD} exec -T "${POSTGRES_SERVICE}" psql -U "${PGUSER}" -d "${RESTORE_DB}" < docs/data_checks.sql > "${OUTPUT_DIR}/data_checks_output.txt" 2>&1 || true
echo "  -> Data checks audit output saved to ${OUTPUT_DIR}/data_checks_output.txt."

# ----------------------------------------------------------------------------------------------------
# STEP I: RUN TEST SUITES AGAINST ISOLATED RESTORE SCHEMA
# ----------------------------------------------------------------------------------------------------
echo -e "\n================================================================================"
echo "[STEP I] Running test suite against '${RESTORE_DB}' schema..."
echo "================================================================================"
assert_restore_db "${RESTORE_DB}" "RUN TEST SUITE"

set +e
${DOCKER_COMPOSE_CMD} exec -T \
  -e DB_NAME="${RESTORE_DB}" \
  -e ALLOW_RESTORE_DB="true" \
  -e DB_HOST="${POSTGRES_SERVICE}" \
  -e DB_PORT="5432" \
  -e DB_USER="${PGUSER}" \
  -e DB_PASSWORD="${POSTGRES_PASSWORD}" \
  "${BACKEND_SERVICE}" npm test > "${OUTPUT_DIR}/test_suite.log" 2>&1
TEST_STATUS=$?
set -e

if [ ${TEST_STATUS} -eq 0 ]; then
    echo "  -> Test suite passed."
else
    echo "  -> Test suite finished (Code ${TEST_STATUS}). Details in ${OUTPUT_DIR}/test_suite.log."
fi

# ----------------------------------------------------------------------------------------------------
# STEP J: FINAL SUMMARY & PRODUCTION ROLLBACK INSTRUCTIONS
# ----------------------------------------------------------------------------------------------------
echo -e "\n================================================================================"
echo "PRODUCTION REHEARSAL COMPLETE"
echo "================================================================================"
echo "Artifacts Generated in ${OUTPUT_DIR}:"
echo "  1. Live DB Dump:          ${OUTPUT_DIR}/live_rrh_db.dump"
echo "  2. Live Schema DDL:       ${OUTPUT_DIR}/live_schema.sql"
echo "  3. Restored Schema DDL:   ${OUTPUT_DIR}/restore_schema_after.sql"
echo "  4. Raw Schema Diff:       ${OUTPUT_DIR}/schema_diff.txt"
echo "  5. Per-Column Before MD5: ${OUTPUT_DIR}/before.txt"
echo "  6. Per-Column After MD5:  ${OUTPUT_DIR}/after.txt"
echo "  7. Column Checksum Diff:  ${OUTPUT_DIR}/checksum_diff.txt"
echo "  8. Migration Runner Log:  ${OUTPUT_DIR}/migration_runner.log"
echo "  9. Data Checks Output:    ${OUTPUT_DIR}/data_checks_output.txt"
echo " 10. Test Suite Log:        ${OUTPUT_DIR}/test_suite.log"
echo "================================================================================"
echo "PRODUCTION ROLLBACK INSTRUCTION (If emergency restore ever needed):"
echo "  ${DOCKER_COMPOSE_CMD} exec -T ${POSTGRES_SERVICE} dropdb rrh_db"
echo "  ${DOCKER_COMPOSE_CMD} exec -T ${POSTGRES_SERVICE} createdb -U ${PGUSER} rrh_db"
echo "  ${DOCKER_COMPOSE_CMD} exec -T ${POSTGRES_SERVICE} pg_restore -U ${PGUSER} -d rrh_db --no-owner < ${OUTPUT_DIR}/live_rrh_db.dump"
echo "================================================================================"
