#!/bin/bash
set -eu

API=http://localhost:3000

cd /usr/src/app/jskos-server 

# download relevant mappings
wget -O tmp.json 'https://coli-conc.gbv.de/api/mappings?fromScheme=http%3A%2F%2Fbartoc.org%2Fen%2Fnode%2F241&toScheme=http%3A%2F%2Fbartoc.org%2Fen%2Fnode%2F18785&type=http%3A%2F%2Fwww.w3.org%2F2004%2F02%2Fskos%2Fcore%23exactMatch&partOf=any&limit=1000'

# remove partOf
jq -c '.[]|del(.partOf)' tmp.json > ddc-bk-mappings.ndjson

# delete all existing mappings
yes | npm run reset -- -t mappings || true

# import mappings into BARTOC
npm run import mappings ddc-bk-mappings.ndjson

# check which records to enrich
enriched=../bartoc/data/bk-enriched.ndjson

echo "Finding enrichment"
jq -r .uri ../bartoc/data/dumps/latest.ndjson | \
    node /config/bk-enrich.mjs "$API" 2> ../bartoc/data/bk-enrich.log > $enriched

# update records with enrichment
npm run import -- schemes $enriched
