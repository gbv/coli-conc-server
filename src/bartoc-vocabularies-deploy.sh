#!/usr/bin/env bash
set -euo pipefail

# Import the dev commit only after its Docker build succeeded.
if [ -n "${BARTOC_BASELINE_SHA:-}" ] && [ -n "${BARTOC_TARGET_SHA:-}" ]; then
  echo "Set either BARTOC_BASELINE_SHA or BARTOC_TARGET_SHA." >&2
  exit 1
fi
if [ -n "${BARTOC_BASELINE_SHA:-}" ]; then
  mode=baseline
  sha=$BARTOC_BASELINE_SHA
else
  mode=import
  sha=${BARTOC_TARGET_SHA:?Set BARTOC_TARGET_SHA to the successful dev workflow commit}
fi
[[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo "Expected a full commit SHA." >&2; exit 1; }

# Serialize imports and keep the recorded commit unchanged on failure.
base=${COLI_CONC_BASE:?Missing COLI_CONC_BASE}
mkdir -p "$base/data"
exec 9>"$base/data/bartoc-vocabularies-dev.import.lock"
flock 9

if [ "$mode" = import ]; then
  image=ghcr.io/gbv/bartoc-vocabularies:dev
  docker pull "$image"
  image_sha=$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image")
  [ "$image_sha" = "$sha" ] || {
    echo "Image revision $image_sha differs from workflow commit $sha; no import ran." >&2
    exit 1
  }
fi

# bartoc-dev already has the JSKOS importer, MongoDB access, and a Git clone.
srv exec bartoc-dev -T \
  -e "BARTOC_JOB_MODE=$mode" -e "BARTOC_JOB_SHA=$sha" \
  bartoc-dev bash -s < "$base/configs/bartoc-vocabularies/update-vocabularies.sh"
