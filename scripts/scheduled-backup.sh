#!/usr/bin/env bash
# ==============================================================================
# Aure Ledger - Scheduled Production Backup & Offsite Retention Script
# ==============================================================================
# Distinguishes scheduled automated backups from manual ad-hoc snapshots.
#
# Features:
# 1. Atomic PostgreSQL custom-format dump (-Fc) with single-transaction consistency.
# 2. Strict file permissions (0600) to protect private financial data.
# 3. Offsite cloud storage transfer (S3 / Cloudflare R2 / Backblaze B2) if configured.
# 4. Automated retention policy (purges local snapshots older than RETENTION_DAYS).
# 5. Immediate failure reporting to monitoring webhook (ALERT_WEBHOOK_URL).
# 6. Periodic disposable restore verification hook.
#
# Scheduling:
#   Add to system crontab (e.g., daily at 02:00 UTC):
#   0 2 * * * /path/to/aure-ledger/scripts/scheduled-backup.sh >> /var/log/aure-backup.log 2>&1
# ==============================================================================
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP="$(date -u +"%Y%m%d_%H%M%SZ")"
OUTPUT_FILE="${BACKUP_DIR}/aure_ledger_${TIMESTAMP}.dump"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"
S3_BUCKET="${S3_BUCKET:-${AWS_S3_BUCKET:-}}"

# ------------------------------------------------------------------------------
# Failure Reporting Trap
# ------------------------------------------------------------------------------
report_failure() {
  local exit_code="$?"
  local line_no="$1"
  echo "[-] ERROR: Backup job failed at line ${line_no} with exit code ${exit_code}!" >&2

  if [[ -n "${ALERT_WEBHOOK_URL}" ]]; then
    echo "[!] Dispatching failure alert to monitoring webhook..." >&2
    local payload
    payload=$(printf '{"event":"BACKUP_FAILURE","system":"Aure Ledger","timestamp":"%s","host":"%s","exitCode":%d}' \
      "${TIMESTAMP}" "$(hostname)" "${exit_code}")
    curl -s -X POST -H "Content-Type: application/json" -d "${payload}" "${ALERT_WEBHOOK_URL}" || true
  else
    echo "[i] ALERT_WEBHOOK_URL not configured. Alert notification skipped." >&2
  fi
  exit "${exit_code}"
}

trap 'report_failure ${LINENO}' ERR

# ------------------------------------------------------------------------------
# 1. Create and Secure Backup Directory
# ------------------------------------------------------------------------------
mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

echo "================================================================================"
echo "AURE LEDGER: SCHEDULED PRODUCTION BACKUP"
echo "Timestamp:    ${TIMESTAMP}"
echo "Destination:  ${OUTPUT_FILE}"
echo "Retention:    ${RETENTION_DAYS} days"
echo "================================================================================"

# ------------------------------------------------------------------------------
# 2. Execute pg_dump with Transactional Consistency
# ------------------------------------------------------------------------------
if [[ -n "${DATABASE_URL:-}" ]]; then
  echo "[+] Running pg_dump against DATABASE_URL (credentials masked)..."
  pg_dump "${DATABASE_URL}" \
    --format=custom \
    --no-owner \
    --no-privileges \
    --file="${OUTPUT_FILE}"
elif docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^aure-ledger-db-1$"; then
  echo "[+] Running pg_dump via local Docker container 'aure-ledger-db-1'..."
  docker exec aure-ledger-db-1 pg_dump \
    -U lending \
    -d lending \
    --format=custom \
    --no-owner \
    --no-privileges > "${OUTPUT_FILE}"
else
  echo "[-] FATAL: Neither DATABASE_URL nor local Docker container was found." >&2
  exit 1
fi

chmod 600 "${OUTPUT_FILE}"
FILE_SIZE="$(du -h "${OUTPUT_FILE}" | cut -f1)"
echo "[✓] Database snapshot created successfully: ${OUTPUT_FILE} (${FILE_SIZE})"

# ------------------------------------------------------------------------------
# 3. Offsite Cloud Storage Transfer (Awaiting Hosting Configuration)
# ------------------------------------------------------------------------------
if [[ -n "${S3_BUCKET}" ]]; then
  echo "[+] Transferring backup to offsite cloud storage: s3://${S3_BUCKET}/backups/..."
  if command -v aws >/dev/null 2>&1; then
    aws s3 cp "${OUTPUT_FILE}" "s3://${S3_BUCKET}/backups/$(basename "${OUTPUT_FILE}")" \
      ${S3_ENDPOINT:+--endpoint-url "${S3_ENDPOINT}"}
    echo "[✓] Offsite upload complete."
  else
    echo "[-] Warning: AWS CLI ('aws') not found in PATH. Offsite transfer skipped." >&2
  fi
else
  echo "[i] [Awaiting Hosting Configuration] S3_BUCKET is not set."
  echo "    Backups remain securely stored on local persistent disk with 0600 permissions."
  echo "    Configure S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and optional S3_ENDPOINT when hosting is provisioned."
fi

# ------------------------------------------------------------------------------
# 4. Retention Policy Enforcement
# ------------------------------------------------------------------------------
echo "[+] Enforcing local retention policy (pruning files older than ${RETENTION_DAYS} days)..."
DELETED_COUNT=0
while IFS= read -r -d '' old_file; do
  echo "    -> Pruning expired backup: ${old_file}"
  rm -f "${old_file}"
  DELETED_COUNT=$((DELETED_COUNT + 1))
done < <(find "${BACKUP_DIR}" -name "aure_ledger_*.dump" -type f -mtime +"${RETENTION_DAYS}" -print0)
echo "[✓] Retention cleanup complete. Pruned ${DELETED_COUNT} expired archive(s)."

# ------------------------------------------------------------------------------
# 5. Optional Disposable Restore Verification Hook
# ------------------------------------------------------------------------------
if [[ "${VERIFY_RESTORE:-false}" == "true" ]]; then
  echo "[+] Running disposable restore verification on freshly generated archive..."
  npm run test:restore-verify || npx tsx scripts/restore-and-verify-backup.ts
  echo "[✓] Disposable restore verification passed."
fi

echo "================================================================================"
echo "✓ SCHEDULED BACKUP RUN COMPLETED SUCCESSFULLY"
echo "================================================================================"
