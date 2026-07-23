#!/bin/bash -l

set -uo pipefail
umask 022

repo=${BACKUP_REPO:-/home/cocoda/backup}
repo_mounted=${BACKUP_REPO_MOUNTED:-/backup}
backup_failed=0
backup_succeeded=0

# Run Git without automatic garbage collection or maintenance
git_repo() {
  git \
    -C "$repo" \
    -c gc.auto=0 \
    -c maintenance.auto=false \
    "$@"
}

staging_dir=$(mktemp -d "$repo/.backup-staging.XXXXXX") || exit 1
staging_dir_mounted="$repo_mounted/${staging_dir##*/}"

cleanup() {
  rm -rf -- "$staging_dir"
}

trap cleanup EXIT
trap 'exit 1' HUP INT TERM
chmod 0755 "$staging_dir" || exit 1

backup_collection() {
  local collection=$1
  local staged_database="$staging_dir/$collection/jskos-server"
  local mounted_output="$staging_dir_mounted/$collection"
  local backup_database="$repo/jskos-server"
  shift

  mkdir -p "$staged_database" || return 1

  if ! srv exec mongo -iT mongo \
    mongodump --quiet \
    --db jskos-server \
    --collection "$collection" \
    "$@" \
    --out "$mounted_output"
  then
    printf 'Dump failed for collection %s\n' "$collection" >&2
    return 1
  fi

  local bson="$staged_database/$collection.bson"
  local metadata="$staged_database/$collection.metadata.json"
  local ndjson="$staged_database/$collection.ndjson"

  if [[ ! -f "$bson" || ! -f "$metadata" ]]
  then
    printf 'Dump output is incomplete for collection %s\n' "$collection" >&2
    return 1
  fi

  if ! bsondump --quiet --outFile "$ndjson" "$bson"
  then
    printf 'BSON conversion failed for collection %s\n' "$collection" >&2
    return 1
  fi

  mkdir -p "$backup_database" || return 1
  mv -- "$bson" "$metadata" "$ndjson" "$backup_database/" || return 1
  backup_succeeded=1
}

# shellcheck disable=SC2016
backup_collection mappings --query '{ "uri": { "$exists": true } }' ||
  backup_failed=1
backup_collection concordances || backup_failed=1
backup_collection annotations || backup_failed=1

# Remove staging before Git can see it.
cleanup || exit 1
trap - EXIT HUP INT TERM

if (( backup_succeeded ))
then
  git_repo add . || exit 1
  git_repo diff --cached --quiet
  diff_status=$?

  if (( diff_status == 1 ))
  then
    date_adjusted=$(date --iso-8601=seconds) || exit 1
    git_repo commit \
      --date "$date_adjusted" \
      -m "$date_adjusted" ||
      exit 1
  elif (( diff_status != 0 ))
  then
    exit "$diff_status"
  fi
fi

exit "$backup_failed"
