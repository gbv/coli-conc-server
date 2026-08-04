#!/bin/sh

set -eu

BARTOC_DUMP_URL=${BARTOC_DUMP_URL:-https://bartoc.org/data/dumps/latest.ndjson}
IMPORTER_URL=${IMPORTER_URL:-http://importer:5020}
DATA_DIR=${DATA_DIR:-/data}
job_started_at=$(date +%s)

log() {
  now=$(date +%s)
  timestamp=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
  printf '%s elapsed_seconds=%s %s\n' \
    "$timestamp" "$((now - job_started_at))" "$*" >&2
}

lock_file="$DATA_DIR/update.lock"
exec 9>"$lock_file"
if ! flock --nonblock 9; then
  log "Another BARTOC update is already running; skipping this run"
  exit 0
fi

raw_tmp_file="$DATA_DIR/.bartoc.raw.ndjson.tmp"
tmp_file="$DATA_DIR/.bartoc.json.tmp"

cleanup() {
  rm -f "$raw_tmp_file" "$tmp_file"
}

trap cleanup 0

log "Downloading BARTOC metadata from $BARTOC_DUMP_URL"
curl --fail --show-error --silent --location \
  --retry 3 \
  --connect-timeout 10 \
  --max-time 600 \
  --output "$raw_tmp_file" \
  "$BARTOC_DUMP_URL"

jq --slurp --compact-output --exit-status '
  if length > 0 then . else error("empty BARTOC dump") end
' "$raw_tmp_file" > "$tmp_file"

total_count=$(jq 'length' "$tmp_file")
mv "$raw_tmp_file" "$DATA_DIR/bartoc.raw.ndjson"
mv "$tmp_file" "$DATA_DIR/bartoc.json"
log "Stored unmodified BARTOC dump in $DATA_DIR/bartoc.raw.ndjson"
log "Stored all $total_count BARTOC records in $DATA_DIR/bartoc.json"

log "Sending all $total_count BARTOC records to the importer"
curl --fail --show-error --silent \
  --request PUT \
  --header 'Content-Type: application/json' \
  --data-binary "@$DATA_DIR/bartoc.json" \
  --connect-timeout 10 \
  --output /dev/null \
  "$IMPORTER_URL/terminology/"

log "Imported all $total_count BARTOC records"
