#!/usr/bin/env bash
set -euo pipefail

# THIS IS NOT FOR PRODUCTION YET

server=jskos-server-dev
concordance=$(jq -r .uri jskos-concordance.json)

fetch() {
  wget -N --no-if-modified-since $1
}

fetch https://github.com/TIBHannover/datacite-metadata-toolkit/raw/refs/heads/main/mappings/jskos-mappings.json

data import $server concordance jskos-concordance.json

filter_and_import() {
  to=$1
  scheme=$2
  # concordance=$3
  #fetch $concordance
  #file="${concordance##*/}"

  jq -c ".[]|select(.toScheme.uri==\"$scheme\")" <jskos-mappings.json > datacite-$to-mappings.ndjson

  data import $server -c $concordance mappings datacite-$to-mappings.ndjson
}

filter_and_import dcat http://bartoc.org/en/node/1691 https://w3id.org/tib/datacite/mappings/datacite-dcat.sssom.tsv
filter_and_import dcterms http://bartoc.org/en/node/725 https://w3id.org/tib/datacite/mappings/datacite-dcterms.sssom.tsv
filter_and_import schemaorg http://bartoc.org/en/node/18250 https://w3id.org/tib/datacite/mappings/datacite-schemaorg.sssom.tsv
filter_and_import wikidata http://bartoc.org/en/node/1940 https://w3id.org/tib/datacite/mappings/datacite-wikidata.sssom.tsv
filter_and_import dctype http://bartoc.org/en/node/17909 # ???
