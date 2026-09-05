#!/usr/bin/env bash
#
# Takes a compressed mongodump of the application database.
#
# SPEC section 14. Deliberately a shell script rather than an npm script: a
# backup has to be runnable from cron on a host that has never installed the
# application's dependencies, and `mongodump` is the only thing it needs.
#
#   ./scripts/backup.sh                          # uses MONGO_URI from server/.env
#   MONGO_URI=... ./scripts/backup.sh            # or pass it explicitly
#   BACKUP_DIR=/var/backups ./scripts/backup.sh  # default is ./backups
#   RETAIN_DAYS=30 ./scripts/backup.sh           # default is 14
#
# Restore instructions are in README.md under "Backups and restore".

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-${REPO_ROOT}/backups}"
RETAIN_DAYS="${RETAIN_DAYS:-14}"

# The connection string is never echoed: it carries the database password, and a
# cron log is not a place to leave one.
if [[ -z "${MONGO_URI:-}" && -f "${REPO_ROOT}/server/.env" ]]; then
  MONGO_URI="$(grep -E '^MONGO_URI=' "${REPO_ROOT}/server/.env" | head -n 1 | cut -d '=' -f 2-)"
fi

if [[ -z "${MONGO_URI:-}" ]]; then
  echo "backup: MONGO_URI is not set, and server/.env does not define it" >&2
  exit 1
fi

if ! command -v mongodump >/dev/null 2>&1; then
  echo "backup: mongodump not found. Install the MongoDB Database Tools:" >&2
  echo "        https://www.mongodb.com/docs/database-tools/installation/" >&2
  exit 1
fi

STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
ARCHIVE="${BACKUP_DIR}/internship-tracker-${STAMP}.archive.gz"

mkdir -p "${BACKUP_DIR}"

echo "backup: writing ${ARCHIVE}"

# --archive with --gzip produces one file rather than a directory tree, which is
# what makes a backup something you can copy off the host in a single command.
mongodump --uri="${MONGO_URI}" --archive="${ARCHIVE}" --gzip --quiet

if [[ ! -s "${ARCHIVE}" ]]; then
  echo "backup: mongodump produced an empty archive, refusing to report success" >&2
  rm -f "${ARCHIVE}"
  exit 1
fi

SIZE="$(du -h "${ARCHIVE}" | cut -f 1)"
echo "backup: wrote ${ARCHIVE} (${SIZE})"

# Pruned only after a successful dump, so a run that fails never destroys the
# last good copy on its way out.
DELETED="$(find "${BACKUP_DIR}" -name 'internship-tracker-*.archive.gz' -type f -mtime "+${RETAIN_DAYS}" -print -delete | wc -l | tr -d ' ')"

if [[ "${DELETED}" != "0" ]]; then
  echo "backup: pruned ${DELETED} archive(s) older than ${RETAIN_DAYS} days"
fi
