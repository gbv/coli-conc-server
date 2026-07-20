#!/bin/sh

set -eu
set -o pipefail

BARTOC_DUMP_URL=${BARTOC_DUMP_URL:-https://bartoc.org/data/dumps/latest.ndjson}
IMPORTER_URL=${IMPORTER_URL:-http://importer:5020}
PROGRESS_INTERVAL_SECONDS=${PROGRESS_INTERVAL_SECONDS:-60}
DATA_DIR=${DATA_DIR:-/data}
STAGE_DIR=${STAGE_DIR:-/stage}
job_started_at=$(date +%s)
monitor_pid=
import_pid=

case "$PROGRESS_INTERVAL_SECONDS" in
  ''|*[!0-9]*|0)
    printf 'PROGRESS_INTERVAL_SECONDS must be a positive integer\n' >&2
    exit 1
    ;;
esac

# Write operational messages to stderr: this is the stream reliably forwarded
# by `srv run`, while stdout remains available for machine-readable output.
log() {
  now=$(date +%s)
  timestamp=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
  printf '%s elapsed_seconds=%s %s\n' \
    "$timestamp" "$((now - job_started_at))" "$*" >&2
}

# The kernel releases this lock automatically when the process exits. The file
# itself may remain in /data; only the active lock on it indicates a running job.
lock_file="$DATA_DIR/update.lock"
exec 9>"$lock_file"
if ! flock --nonblock 9; then
  log "Another BARTOC update is already running; skipping this run"
  exit 0
fi

# Keep the temporary file beside bartoc.json so the final rename stays on one
# filesystem and is atomic. A failed download or conversion leaves the current
# bartoc.json untouched.
tmp_file="$DATA_DIR/.bartoc.json.tmp"

cleanup() {
  if [ -n "$monitor_pid" ]; then
    kill "$monitor_pid" 2>/dev/null || true
    wait "$monitor_pid" 2>/dev/null || true
  fi
  if [ -n "$import_pid" ] && kill -0 "$import_pid" 2>/dev/null; then
    kill "$import_pid" 2>/dev/null || true
    wait "$import_pid" 2>/dev/null || true
  fi
  rm -f "$tmp_file"
}

trap cleanup 0

stage_record_count() {
  if [ ! -d "$STAGE_DIR/terminology" ]; then
    printf '0\n'
    return
  fi

  find "$STAGE_DIR/terminology" -maxdepth 1 -type f -name '*.json' -print \
    | wc -l \
    | tr -d '[:space:]'
}

monitor_progress() {
  request_pid=$1
  target_count=$2
  sample=0

  while kill -0 "$request_pid" 2>/dev/null; do
    sleep "$PROGRESS_INTERVAL_SECONDS"
    if ! kill -0 "$request_pid" 2>/dev/null; then
      break
    fi

    sample=$((sample + 1))
    current_count=$(stage_record_count)
    log "Batch sample: sample=$sample stage_records=$current_count target_records=$target_count"
  done
}

log "Downloading BARTOC metadata from $BARTOC_DUMP_URL"
curl --fail --show-error --silent --location \
  --retry 3 \
  --connect-timeout 10 \
  --max-time 600 \
  "$BARTOC_DUMP_URL" \
  | jq --slurp --compact-output --exit-status '
      if length > 0 and all(.[];
        type == "object"
        and ((.uri? // "") | test("^http://bartoc[.]org/en/node/[1-9][0-9]*$"))
      ) then .
      else error("expected non-empty BARTOC records with numeric node URIs")
      end
    ' > "$tmp_file"

total_count=$(jq 'length' "$tmp_file")
mv "$tmp_file" "$DATA_DIR/bartoc.json"
log "Stored $total_count BARTOC records in $DATA_DIR/bartoc.json"

initial_stage_count=$(stage_record_count)
log "Sending all $total_count BARTOC records to the importer"
log "Batch started: stage_records=$initial_stage_count target_records=$total_count sample_interval_seconds=$PROGRESS_INTERVAL_SECONDS"

# The batch endpoint responds only after the entire request has been processed.
# While the PUT runs, sample the shared stage directory to observe the purge and
# subsequent growth of the registry without adding HTTP load to the importer.
curl --fail --show-error --silent \
  --request PUT \
  --header 'Content-Type: application/json' \
  --data-binary "@$DATA_DIR/bartoc.json" \
  --connect-timeout 10 \
  --output /dev/null \
  "$IMPORTER_URL/terminology/" &
import_pid=$!

monitor_progress "$import_pid" "$total_count" &
monitor_pid=$!

import_status=0
wait "$import_pid" || import_status=$?
import_pid=

kill "$monitor_pid" 2>/dev/null || true
wait "$monitor_pid" 2>/dev/null || true
monitor_pid=

final_stage_count=$(stage_record_count)
if [ "$import_status" -ne 0 ]; then
  log "Batch failed: curl_exit=$import_status stage_records=$final_stage_count target_records=$total_count"
  exit "$import_status"
fi

log "Batch completed: stage_records=$final_stage_count target_records=$total_count"
