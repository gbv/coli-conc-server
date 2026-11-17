#!/usr/bin/env bash
set -euo pipefail

# 1. Read the build commit and choose dev or main.
target=${BARTOC_TARGET_SHA:?Missing BARTOC_TARGET_SHA}
[[ $target =~ ^[0-9a-f]{40}$ ]] || { echo "Expected a full commit SHA." >&2; exit 1; }
branch=${1:-dev}
case "$branch" in
  dev|main) ;;
  *) echo "Expected dev or main." >&2; exit 1 ;;
esac

base=${COLI_CONC_BASE:?Missing COLI_CONC_BASE}
repo="$base/data/bartoc-vocabularies"
service=bartoc
checkout_service=bartoc-vocabularies
if [ "$branch" = dev ]; then
  repo="$repo-dev"
  service=bartoc-dev
  checkout_service=bartoc-vocabularies-dev
fi
state="$repo.last-imported-commit"

# 2. Run one import at a time.
mkdir -p "$base/data"
exec 9>"$repo.import.lock"
echo "Waiting for $branch import lock."
flock 9

# 3. Update and verify the selected checkout.
# Trust only this checkout when Git reads it on the host.
git_repo() { git -c safe.directory="$repo" -C "$repo" "$@"; }

srv run "$checkout_service" --rm -T --pull always \
  "$checkout_service" bash -c 'bash entrypoint.sh && ./update.ts'

[ -d "$repo/.git" ] || { echo "Missing $branch checkout: $repo" >&2; exit 1; }
current=$(git_repo rev-parse HEAD)
[ "$current" = "$target" ] || {
  echo "$branch checkout is at $current, expected $target; no import ran." >&2
  exit 1
}

if [ "$branch" = main ] && [ ! -f "$state" ]; then
  echo "Missing main import baseline: $state; no database import ran." >&2
  exit 1
fi

# 4. Find vocabularies with changed scheme or concept NDJSON.
# Dev imports all vocabularies on its first run. Main requires a verified baseline.
if [ -f "$state" ]; then
  # Compare the last imported commit with the commit built by this workflow.
  previous=$(cat "$state")
  paths=$(git_repo diff --name-only "$previous" "$target" --)
else
  # The first dev import considers every file in the repository.
  paths=$(git_repo ls-tree -r --name-only "$target")
fi

# Vocabulary files follow this layout:
# <name>/<name>-scheme.ndjson and <name>/<name>-concepts.ndjson.
# awk keeps only these two paths and prints <name>; sort removes duplicates when
# both files of the same vocabulary changed.
mapfile -t names < <(
  printf '%s\n' "$paths" |
    awk -F/ 'NF == 2 && ($2 == $1 "-scheme.ndjson" || $2 == $1 "-concepts.ndjson") { print $1 }' |
    LC_ALL=C sort -u
)

if [ "${#names[@]}" -eq 0 ]; then
  # The workflow succeeded, but this commit contains no vocabulary data change.
  printf '%s\n' "$target" > "$state"
  echo "No vocabulary NDJSON changed; recorded $target."
  exit 0
fi

# 5. Import those vocabularies, then record the successful commit.
echo "Importing ${#names[@]} $branch vocabularies."
# Pass a script path: srv exec can hang when a script is sent on stdin.
srv exec "$service" -T "$service" bash /config/import-vocabularies.sh "${names[@]}"

# A failure above leaves the previous SHA in place for a complete retry.
printf '%s\n' "$target" > "$state"
echo "Imported $branch through $target."
