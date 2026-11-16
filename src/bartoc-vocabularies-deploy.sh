#!/usr/bin/env bash
set -euo pipefail

# A successful dev Docker build passes its commit SHA through the webhook.
target=${BARTOC_TARGET_SHA:?Missing BARTOC_TARGET_SHA}
[[ $target =~ ^[0-9a-f]{40}$ ]] || { echo "Expected a full commit SHA." >&2; exit 1; }

base=${COLI_CONC_BASE:?Missing COLI_CONC_BASE}
repo="$base/data/bartoc-vocabularies-dev"
state="$base/data/bartoc-vocabularies-dev.last-imported-commit"

# Only one job may compare, import, and advance the state at a time.
mkdir -p "$base/data"
exec 9>"$base/data/bartoc-vocabularies-dev.import.lock"
echo "Waiting for dev import lock."
flock 9

# The image proves that the webhook commit was built successfully. Do not use a
# different image if the moving :dev tag has already advanced.
image=ghcr.io/gbv/bartoc-vocabularies:dev
docker pull "$image"
image_sha=$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image")
[ "$image_sha" = "$target" ] || {
  echo "Image revision $image_sha differs from workflow commit $target; no import ran." >&2
  exit 1
}

# The one-shot image maintains its own dev checkout, separate from the main
# checkout and from the possibly stale clone baked into bartoc-dev.
echo "Checking out bartoc-vocabularies dev at $target."
# The quoted script expands BARTOC_TARGET_SHA inside the container.
# shellcheck disable=SC2016
srv run bartoc-vocabularies-dev --rm -T --pull never \
  -e "BARTOC_TARGET_SHA=$target" bartoc-vocabularies-dev bash -ec '
    repo=/bartoc-vocabularies
    if [ ! -d "$repo/.git" ]; then
      git clone --branch dev https://github.com/gbv/bartoc-vocabularies.git "$repo"
    fi
    cd "$repo"
    git fetch --quiet origin dev
    git merge-base --is-ancestor "$BARTOC_TARGET_SHA" FETCH_HEAD || {
      echo "Commit $BARTOC_TARGET_SHA is not on dev." >&2
      exit 1
    }
    git checkout --quiet --detach --force "$BARTOC_TARGET_SHA"
  '

# Git inside the Docker job owns the checkout. Trust only this specific path
# when reading it from the host; do not change the global Git configuration.
git_repo() { git -c safe.directory="$repo" -C "$repo" "$@"; }

write_state() {
  printf '%s\n' "$target" > "$state.tmp"
  mv "$state.tmp" "$state"
}

# No prior import is recorded, so the first job imports all vocabularies.
# Later jobs select only scheme/concept NDJSON changed since the last import.
if [ ! -f "$state" ]; then
  paths=$(git_repo ls-tree -r --name-only "$target")
  echo "No previous dev import; selecting all vocabularies."
else
  previous=$(cat "$state")
  if git_repo merge-base --is-ancestor "$target" "$previous"; then
    echo "Already imported through $previous."
    exit 0
  fi
  git_repo merge-base --is-ancestor "$previous" "$target" || {
    echo "Commit $target does not descend from last import $previous." >&2
    exit 1
  }
  paths=$(git_repo diff --name-only --no-renames "$previous" "$target" --)
fi

vocs=$(printf '%s\n' "$paths" |
  awk -F/ 'NF == 2 && ($2 == $1 "-scheme.ndjson" || $2 == $1 "-concepts.ndjson") { print $1 }' |
  LC_ALL=C sort -u)
if [ -z "$vocs" ]; then
  if [ ! -f "$state" ]; then
    echo "No vocabulary NDJSON found in $target; no import ran." >&2
    exit 1
  fi
  write_state
  echo "No vocabulary NDJSON changed; recorded $target."
  exit 0
fi

mapfile -t names <<< "$vocs"
# bartoc-dev only reads the selected files and runs its local JSKOS CLI.
# Run the mounted script by path: srv exec can hang with a script on stdin.
echo "Importing ${#names[@]} dev vocabularies."
srv exec bartoc-dev -T bartoc-dev bash /vocabulary-import/update-vocabularies.sh "${names[@]}"

# A failure above leaves the previous SHA in place for a complete retry.
write_state
echo "Imported dev through $target."
