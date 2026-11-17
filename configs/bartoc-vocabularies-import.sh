#!/usr/bin/env bash
set -euo pipefail

# Keep import progress visible when srv exec does not forward stdout.
exec 1>&2

# Both BARTOC instances mount their branch checkout at this path.
repo=/bartoc-vocabularies
cd /usr/src/app/jskos-server

# Import the scheme and concepts of every vocabulary selected by the deploy.
for voc in "$@"; do
  npm run import -- schemes "$repo/$voc/$voc-scheme.ndjson"
  npm run import -- concepts "$repo/$voc/$voc-concepts.ndjson" --set-api
done
