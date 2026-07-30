#!/bin/sh

# Step 1: enable strict shell behavior so command, variable, and pipeline
# failures are not silently ignored.
set -eu
# BusyBox ash supports pipefail although it is not part of POSIX sh.
# shellcheck disable=SC3040
set -o pipefail

# Load the effective runtime configuration and initialize process state.
BARTOC_DUMP_URL=${BARTOC_DUMP_URL:-https://bartoc.org/data/dumps/latest.ndjson}
IMPORTER_URL=${IMPORTER_URL:-http://importer:5020}
FUSEKI_URL=${FUSEKI_URL:-http://fuseki:3030/n4o}
GRAPH_BASE=${GRAPH_BASE:-https://bartoc.org/graph/}
JSKOS_CONTEXT_URL=https://gbv.github.io/jskos/context.json
RECORD_LIMIT=${RECORD_LIMIT:-1000}
DATA_DIR=${DATA_DIR:-/data}
job_started_at=$(date +%s)

# Reject values that `head` could otherwise interpret as options or as
# "all but the last N lines". The update always requires a non-empty,
# positive-size pilot subset.
case "$RECORD_LIMIT" in
  ''|*[!0-9]*)
    printf 'RECORD_LIMIT must be a positive integer\n' >&2
    exit 1
    ;;
  *[1-9]*)
    ;;
  *)
    printf 'RECORD_LIMIT must be a positive integer\n' >&2
    exit 1
    ;;
esac

# Step 1 (continued): write timestamped operational messages to stderr. This is
# the stream reliably forwarded by `srv run`; stdout remains available for
# machine-readable output.
log() {
  now=$(date +%s)
  timestamp=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
  printf '%s elapsed_seconds=%s %s\n' \
    "$timestamp" "$((now - job_started_at))" "$*" >&2
}

# Step 2: acquire a non-blocking process lock. The file may remain in /data,
# but only the active kernel lock indicates that an update is running. The
# kernel releases the lock automatically when the process exits.
lock_file="$DATA_DIR/update.lock"
exec 9>"$lock_file"
if ! flock --nonblock 9; then
  log "Another BARTOC update is already running; skipping this run"
  exit 0
fi

# Step 3: keep temporary files beside their destinations and remove unfinished
# work on exit. Each later rename is atomic because it stays on one filesystem;
# the pair of renames is not a single transaction.
raw_tmp_file="$DATA_DIR/.bartoc.raw.ndjson.tmp"
tmp_file="$DATA_DIR/.bartoc.json.tmp"

cleanup() {
  rm -f "$raw_tmp_file" "$tmp_file"
}

trap cleanup 0

# Step 4: download the complete, unmodified NDJSON dump to a temporary file.
log "Downloading BARTOC metadata from $BARTOC_DUMP_URL"
curl --fail --show-error --silent --location \
  --retry 3 \
  --connect-timeout 10 \
  --max-time 600 \
  --output "$raw_tmp_file" \
  "$BARTOC_DUMP_URL"

# Step 5: select, validate, and normalize the configured record subset, then
# convert the selected NDJSON objects into one compact JSON array.
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

# Step 6: publish the raw dump and normalized importer input. Each mv is an
# atomic replacement, but an error between the two commands can update only the
# raw dump.
total_count=$(jq 'length' "$tmp_file")
mv "$raw_tmp_file" "$DATA_DIR/bartoc.raw.ndjson"
mv "$tmp_file" "$DATA_DIR/bartoc.json"
log "Stored unmodified BARTOC dump in $DATA_DIR/bartoc.raw.ndjson"
log "Stored $total_count normalized BARTOC records in $DATA_DIR/bartoc.json (limit=$RECORD_LIMIT)"

# Step 7: send the complete normalized array to the importer in the foreground.
# There is deliberately no total timeout.
log "Sending all $total_count BARTOC records to the importer"
log "Batch started: target_records=$total_count"

# Steps 8-10 run inside the importer: validate the complete input, purge the
# previous registry, rebuild it record by record, and update Fuseki metadata.
# The batch endpoint responds only after the entire request has been processed.
import_status=0
curl --fail --show-error --silent \
  --request PUT \
  --header 'Content-Type: application/json' \
  --data-binary "@$DATA_DIR/bartoc.json" \
  --connect-timeout 10 \
  --output /dev/null \
  "$IMPORTER_URL/terminology/" || import_status=$?

# Step 11: report the final HTTP result and propagate curl's failure status.
if [ "$import_status" -ne 0 ]; then
  log "Batch failed: curl_exit=$import_status target_records=$total_count"
  exit "$import_status"
fi

# The importer responds only after processing the complete batch. Record that
# successful completion in a small, dedicated graph for SPARQL clients.
completed_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
metadata_graph="${GRAPH_BASE}metadata/"

log "Recording successful graph update at $completed_at"
printf '<%s> <http://purl.org/dc/terms/modified> "%s"^^<http://www.w3.org/2001/XMLSchema#dateTime> .\n' \
  "$GRAPH_BASE" "$completed_at" \
  | curl --fail --show-error --silent \
      --request PUT \
      --header 'Content-Type: text/turtle' \
      --data-binary @- \
      --url-query "graph=$metadata_graph" \
      "$FUSEKI_URL"

log "Batch completed: target_records=$total_count updated=$completed_at"
