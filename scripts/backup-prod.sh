#!/bin/sh
# Hosted beta PostgreSQL backup (custom format). Run on the server from the repo
# root, e.g. daily from cron; copy the file off the server afterwards.
# Usage: scripts/backup-prod.sh [backup-dir]
set -eu
umask 077
dir=${1:-backups}
env_file=${ENV_FILE:-.env.production}
mkdir -p "$dir"
file="$dir/ai_job_hunter-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose -f compose.prod.yaml --env-file "$env_file" exec -T postgres \
  pg_dump -U ai_job_hunter -d ai_job_hunter --format=custom >"$file.partial"
# Only a complete dump gets the final name.
mv "$file.partial" "$file"
echo "$file"
