#!/bin/bash -l

repo=/home/cocoda/backup
repo_mounted=/backup

# Run Git without automatic garbage collection or maintenance
git_repo() {
  git \
    -C "$repo" \
    -c gc.auto=0 \
    -c maintenance.auto=false \
    "$@"
}

# TODO: Add more databases/collections if necessary
# shellcheck disable=SC2016
srv exec mongo -iT mongo \
  mongodump --quiet \
  --db jskos-server \
  --collection mappings \
  --query '{ "uri": { "$exists": true } }' \
  --out "$repo_mounted"

srv exec mongo -iT mongo \
  mongodump --quiet \
  --db jskos-server \
  --collection concordances \
  --out "$repo_mounted"

srv exec mongo -iT mongo \
  mongodump --quiet \
  --db jskos-server \
  --collection annotations \
  --out "$repo_mounted"

# convert bson to json
for file in "$repo"/*/*.bson
do
  file_json=${file%*bson}ndjson
  bsondump --quiet --outFile "$file_json" "$file"
done

# Add and commit
git_repo add .

if ! git_repo diff --cached --quiet
then
  date_adjusted=$(date --iso-8601=seconds)
  git_repo commit \
    --date "$date_adjusted" \
    -m "$date_adjusted"
fi
