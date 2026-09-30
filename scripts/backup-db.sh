#!/usr/bin/env bash
# ==============================================================================
# Aure Ledger - PostgreSQL Backup Script
# Creates a compressed, custom-format pg_dump archive with restricted permissions.
# Format: PostgreSQL custom archive (-Fc) includes schema, data, triggers, functions.
# ==============================================================================
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP="$(date -u +"%Y%m%d_%H%M%SZ")"
OUTPUT_FILE="${BACKUP_DIR}/aure_ledger_${TIMESTAMP}.dump"

mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

echo "Starting Aure Ledger database backup..."
echo "Timestamp: ${TIMESTAMP}"
echo "Destination: ${OUTPUT_FILE}"

# If DATABASE_URL is provided, use pg_dump with the connection string directly
# Otherwise, if running locally with docker container aure-ledger-db-1, use docker exec
if [[ -n "${DATABASE_URL:-}" ]]; then
  echo "Using DATABASE_URL from environment (credentials masked)..."
  pg_dump "${DATABASE_URL}" \
    --format=custom \
    --no-owner \
    --no-privileges \
    --file="${OUTPUT_FILE}"
elif docker ps --format '{{.Names}}' | grep -q "^aure-ledger-db-1$"; then
  echo "Using local Docker container 'aure-ledger-db-1'..."
  docker exec aure-ledger-db-1 pg_dump \
    -U lending \
    -d lending \
    --format=custom \
    --no-owner \
    --no-privileges > "${OUTPUT_FILE}"
else
  echo "Error: Neither DATABASE_URL nor local Docker container aure-ledger-db-1 was found." >&2
  exit 1
fi

# Restrict permissions to owner only (chmod 600) to protect private financial data
chmod 600 "${OUTPUT_FILE}"

FILE_SIZE="$(du -h "${OUTPUT_FILE}" | cut -f1)"
echo "Backup successfully created: ${OUTPUT_FILE} (${FILE_SIZE})"
echo "Permissions set to 0600 (owner read/write only)."
