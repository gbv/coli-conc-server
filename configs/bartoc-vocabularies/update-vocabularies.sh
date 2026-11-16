#!/usr/bin/env bash
set -euo pipefail

# This script runs inside bartoc-dev, where the JSKOS CLI can write to dev MongoDB.
repo=/usr/src/app/bartoc-vocabularies
# /config is a persistent volume, so the last successful commit survives restarts.
state=/config/bartoc-vocabularies.last-imported-commit
mode=${BARTOC_JOB_MODE:?Missing BARTOC_JOB_MODE}
target=${BARTOC_JOB_SHA:?Missing BARTOC_JOB_SHA}

# Fetch dev so its commits are available locally. FETCH_HEAD is the fetched tip;
# the webhook commit must be on that branch, even if newer commits arrived.
cd "$repo"
git fetch --quiet origin dev
git merge-base --is-ancestor "$target" FETCH_HEAD || {
  echo "Commit $target is not on dev." >&2
  exit 1
}

# Write beside the state file, then rename it: an interrupted write keeps the
# previous complete SHA instead of leaving a truncated one.
write_state() {
  printf '%s\n' "$target" > "$state.tmp"
  mv "$state.tmp" "$state"
}

# The baseline names data already present in dev. Set it once, without importing.
if [ "$mode" = baseline ]; then
  [ ! -e "$state" ] || { echo "Baseline already exists at $state." >&2; exit 1; }
  write_state
  echo "Initialized dev baseline at $target; no import ran."
  exit 0
fi
[ "$mode" = import ] || { echo "Unknown job mode: $mode" >&2; exit 1; }
[ -f "$state" ] || { echo "Missing dev baseline at $state." >&2; exit 1; }
# base is the last commit whose changes were processed successfully.
base=$(cat "$state")

# A target equal to or older than base is a duplicate or delayed webhook.
if git merge-base --is-ancestor "$target" "$base"; then
  echo "Already imported through $base."
  exit 0
fi
# Otherwise base must precede target. Refuse a rewritten or unrelated history
# rather than comparing two branches and possibly importing the wrong data.
git merge-base --is-ancestor "$base" "$target" || {
  echo "Commit $target does not descend from $base." >&2
  exit 1
}

# Compare all commits since base. Only <voc>/<voc>-scheme.ndjson and
# <voc>/<voc>-concepts.ndjson select a vocabulary; sort removes duplicates when
# both files changed. --no-renames makes removed paths visible in the diff.
vocs=$(git diff --name-only --no-renames "$base" "$target" -- |
  awk -F/ 'NF == 2 && ($2 == $1 "-scheme.ndjson" || $2 == $1 "-concepts.ndjson") { print $1 }' |
  LC_ALL=C sort -u)
if [ -z "$vocs" ]; then
  # A CSV-only or other unrelated build is complete without an import.
  write_state
  echo "No vocabulary NDJSON changed between $base and $target."
  exit 0
fi

# Use the exact workflow commit, even if the dev branch has moved since then.
git checkout --quiet --detach "$target"
while IFS= read -r voc; do
  scheme="$repo/$voc/$voc-scheme.ndjson"
  concepts="$repo/$voc/$voc-concepts.ndjson"
  # A removed or renamed file needs manual review; never silently skip it.
  if [ ! -f "$scheme" ] || [ ! -f "$concepts" ]; then
    echo "Missing scheme or concepts for $voc; no state change." >&2
    exit 1
  fi
  # Import the scheme first, then its concepts. --set-api exposes concepts
  # through this JSKOS API; neither command deletes absent concepts.
  cd /usr/src/app/jskos-server
  npm run import -- schemes "$scheme"
  npm run import -- concepts "$concepts" --set-api
  echo "Imported $voc."
done <<< "$vocs"

# Only mark target as processed after every selected vocabulary succeeded.
# On failure, the old base remains and the next run retries its full diff.
write_state
echo "Imported dev through $target."
