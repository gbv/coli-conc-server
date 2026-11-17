#!/usr/bin/env bash
set -euo pipefail

# Keep import progress visible when srv exec does not forward stdout.
exec 1>&2

# Both BARTOC instances mount their branch checkout at this path.
repo=/bartoc-vocabularies
cd /usr/src/app/jskos-server

# Replace the scheme and concepts of every vocabulary selected by the deploy.
for voc in "$@"; do
  scheme="$repo/$voc/$voc-scheme.ndjson"
  concepts="$repo/$voc/$voc-concepts.ndjson"
  scheme_uri=$(jq -er '.uri' "$scheme")

  # Remove concepts that are no longer present in the source file.
  printf 'yes\n' | node ./bin/reset.js -t concepts -s "$scheme_uri"

  npm run import -- schemes "$scheme"
  npm run import -- concepts "$concepts" --set-api
done
