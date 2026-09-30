#!/usr/bin/env bash
# ==============================================================================
# Aure Ledger - PostgreSQL Restore Script (Operator Procedure)
# Safely restores a custom-format pg_dump archive into a target database.
#
# SAFETY RULES:
# - NEVER restore directly over an active, unbacked-up production database.
# - Requires explicit CONFIRM_RESTORE=true environment variable.
# - Requires TARGET_DATABASE_URL or container-specific parameters.
# ==============================================================================
set -euo pipefail

BACKUP_FILE="${1:-}"

if [[ -z "${BACKUP_FILE}" || ! -f "${BACKUP_FILE}" ]]; then
  echo "Usage: CONFIRM_RESTORE=true $0 <path-to-backup.dump>" >&2
  echo "Example: CONFIRM_RESTORE=true TARGET_DATABASE_URL=postgresql://user:pass@host:5432/new_db $0 backups/aure_ledger_20260929_223015Z.dump" >&2
  exit 1
fi

if [[ "${CONFIRM_RESTORE:-}" != "true" ]]; then
  echo "FATAL: Accidental restore prevention. You must export CONFIRM_RESTORE=true to proceed." >&2
  exit 1
fi

echo "================================================================================"
echo "AURE LEDGER DATABASE RESTORE"
echo "================================================================================"
echo "Backup Archive:  ${BACKUP_FILE}"
echo "Archive Size:    $(du -h "${BACKUP_FILE}" | cut -f1)"

if [[ -n "${TARGET_DATABASE_URL:-}" ]]; then
  echo "Target: Remote PostgreSQL connection string (credentials masked)"
  echo "Executing pg_restore..."
  pg_restore \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges \
    --dbname="${TARGET_DATABASE_URL}" \
    "${BACKUP_FILE}"
elif docker ps --format '{{.Names}}' | grep -q "^aure-ledger-db-1$"; then
  TARGET_DB="${TARGET_DB:-lending_restored}"
  echo "Target: Local Docker container 'aure-ledger-db-1', Database: '${TARGET_DB}'"
  echo "Executing pg_restore into container..."
  docker exec -i aure-ledger-db-1 pg_restore \
    -U lending \
    -d "${TARGET_DB}" \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges < "${BACKUP_FILE}"
else
  echo "Error: Neither TARGET_DATABASE_URL nor local Docker container aure-ledger-db-1 was found." >&2
  exit 1
fi

echo "================================================================================"
echo "Restore operation finished successfully."
echo "Remember to run migrations check or reconciliation verification after restore."
echo "================================================================================"
