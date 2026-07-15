#!/bin/sh

set -eu
set -o pipefail

BARTOC_DUMP_URL=${BARTOC_DUMP_URL:-https://bartoc.org/data/dumps/latest.ndjson}
IMPORTER_URL=${IMPORTER_URL:-http://importer:5020}
DATA_DIR=/data
# Keep the prototype import small while the upstream batch implementation
# rewrites the metadata graph once per record.
RECORD_LIMIT=10

# Keep the temporary file beside bartoc.json so the final rename stays on one
# filesystem and is atomic. A failed download or conversion leaves the current
# bartoc.json untouched.
tmp_file="$DATA_DIR/.bartoc.json.tmp"
trap 'rm -f "$tmp_file"' 0

echo "Downloading BARTOC metadata from $BARTOC_DUMP_URL"
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
echo "Stored $total_count BARTOC records in $DATA_DIR/bartoc.json"

# PUT accepts complete BARTOC records, so jq can select a prototype-sized batch
# directly from bartoc.json without creating a second URI-only file.
import_count=$(jq ".[0:$RECORD_LIMIT] | length" "$DATA_DIR/bartoc.json")
skipped_count=$((total_count - import_count))
echo "Sending $import_count of $total_count BARTOC records to the importer"
echo "Batch progress: 0/$import_count complete, $import_count remaining; $skipped_count intentionally skipped"

# The batch endpoint responds only after the entire request has been processed,
# so this simple client can report start and completion counts but not live
# per-record progress.
jq --compact-output ".[0:$RECORD_LIMIT]" "$DATA_DIR/bartoc.json" \
  | curl --fail --show-error --silent \
    --request PUT \
    --header 'Content-Type: application/json' \
    --data-binary @- \
    --connect-timeout 10 \
    --max-time 21600 \
    --output /dev/null \
    "$IMPORTER_URL/terminology/"

echo "Batch progress: $import_count/$import_count complete, 0 remaining; $skipped_count intentionally skipped"
