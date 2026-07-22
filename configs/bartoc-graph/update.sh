#!/bin/sh

set -eu
set -o pipefail

BARTOC_DUMP_URL=${BARTOC_DUMP_URL:-https://bartoc.org/data/dumps/latest.ndjson}
IMPORTER_URL=${IMPORTER_URL:-http://importer:5020}
JSKOS_CONTEXT_URL=https://gbv.github.io/jskos/context.json
PROGRESS_INTERVAL_SECONDS=${PROGRESS_INTERVAL_SECONDS:-60}
RECORD_LIMIT=${RECORD_LIMIT:-1000}
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

case "$RECORD_LIMIT" in
  ''|*[!0-9]*|0)
    printf 'RECORD_LIMIT must be a positive integer\n' >&2
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

# Keep temporary files beside their final paths so both renames stay on one
# filesystem and are atomic. A failed download or conversion leaves the current
# files untouched.
raw_tmp_file="$DATA_DIR/.bartoc.raw.ndjson.tmp"
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
  rm -f "$raw_tmp_file" "$tmp_file"
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
  --output "$raw_tmp_file" \
  "$BARTOC_DUMP_URL"

# PyLD cannot download nested contexts from the importer's internal network.
# Collect their paths in the slurped array, reject every value except the known
# JSKOS URL, and remove the accepted paths in the same jq transformation. Root
# contexts have paths of length two ([record index, "@context"]) and remain.
head -n "$RECORD_LIMIT" "$raw_tmp_file" \
  | jq --slurp --compact-output --exit-status --arg context "$JSKOS_CONTEXT_URL" '
      if length > 0 and all(.[];
        type == "object"
        and ((.uri? // "") | test("^http://bartoc[.]org/en/node/[1-9][0-9]*$"))
      ) then
        .
      else
        error("expected non-empty BARTOC records with numeric node URIs")
      end
      | . as $records
      | [
          paths as $path
          | select(($path | length) > 2 and $path[-1] == "@context")
          | {path: $path, value: getpath($path)}
        ] as $nested_contexts
      | [$nested_contexts[] | select(.value != $context)] as $unsupported
      | if ($unsupported | length) > 0 then
          error("unsupported nested JSON-LD context: \($unsupported[0].value | tojson)")
        else
          $records | delpaths([$nested_contexts[].path])
        end
    ' > "$tmp_file"

total_count=$(jq 'length' "$tmp_file")
mv "$raw_tmp_file" "$DATA_DIR/bartoc.raw.ndjson"
mv "$tmp_file" "$DATA_DIR/bartoc.json"
log "Stored unmodified BARTOC dump in $DATA_DIR/bartoc.raw.ndjson"
log "Stored $total_count normalized BARTOC records in $DATA_DIR/bartoc.json (limit=$RECORD_LIMIT)"

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
