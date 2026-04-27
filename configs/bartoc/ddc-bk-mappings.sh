#!/bin/bash
set -eu

cd /usr/src/app/jskos-server 

# download relevant mappings
wget -O tmp.json 'https://coli-conc.gbv.de/api/mappings?fromScheme=http%3A%2F%2Fbartoc.org%2Fen%2Fnode%2F241&toScheme=http%3A%2F%2Fbartoc.org%2Fen%2Fnode%2F18785&type=http%3A%2F%2Fwww.w3.org%2F2004%2F02%2Fskos%2Fcore%23exactMatch&partOf=any&limit=1000'

# remove partOf
jq -c '.[]|del(.partOf)' tmp.json > ddc-bk-mappings.ndjson

# delete all existing mappings
yes | npm run reset -- -t mappings

npm run import mappings ddc-bk-mappings.ndjson
