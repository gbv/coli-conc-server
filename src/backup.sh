#!/bin/bash -l

repo=/home/cocoda/backup
repo_mounted=/backup

# TODO: Add more databases/collections if necessary
# shellcheck disable=SC2016
srv exec mongo -iT mongo mongodump --quiet --db jskos-server --collection mappings --query '{ "uri": { "$exists": true } }' --out $repo_mounted
srv exec mongo -iT mongo mongodump --quiet --db jskos-server --collection concordances --out $repo_mounted
srv exec mongo -iT mongo mongodump --quiet --db jskos-server --collection annotations --out $repo_mounted

# convert bson to json
for file in "$repo"/*/*.bson
do
  file_json=${file%*bson}ndjson
  bsondump --quiet --outFile "$file_json" "$file"
done
# add and commit
git -C $repo/ add .
if [[ $(git -C $repo/ diff --cached --name-only) ]]
then
  date_adjusted=$(date --iso-8601=seconds)
  git -C $repo/ commit --date "$date_adjusted" -m "$date_adjusted"
fi
