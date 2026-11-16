#!/usr/bin/env bash
set -euo pipefail

# srv exec on this host does not reliably show stdout; keep import progress visible.
exec 1>&2

# This script runs in bartoc-dev. The selected files are mounted read-only from
# the dedicated dev checkout; only the JSKOS CLI writes to the dev database.
repo=/bartoc-vocabularies-dev
cd /usr/src/app/jskos-server
for voc in "$@"; do
  scheme="$repo/$voc/$voc-scheme.ndjson"
  concepts="$repo/$voc/$voc-concepts.ndjson"
  if [ ! -f "$scheme" ] || [ ! -f "$concepts" ]; then
    echo "Missing scheme or concepts for $voc." >&2
    exit 1
  fi
  npm run import -- schemes "$scheme"
  npm run import -- concepts "$concepts" --set-api
  echo "Imported $voc."
done
