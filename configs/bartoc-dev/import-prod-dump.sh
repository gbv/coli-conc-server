#!/bin/sh
set -eu

# Download and validate the production dump before changing the dev database.
node /config/fetch-prod-dump.mjs

# Import its vocabularies into the JSKOS Server included in BARTOC dev.
cd /usr/src/app/jskos-server
expected=$(wc -l < /tmp/bartoc-prod-vocabularies.ndjson | tr -d ' ')
if ! output=$(npm run import -- schemes /tmp/bartoc-prod-vocabularies.ndjson); then
  printf '%s\n' "$output"
  exit 1
fi
printf '%s\n' "$output"

# Bulk import can skip invalid entries without failing; require every line to be imported.
case "$output" in
  *"done: $expected schemes imported."*) ;;
  *) echo "Imported vocabulary count does not match the production dump" >&2; exit 1 ;;
esac

