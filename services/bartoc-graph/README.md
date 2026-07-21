# BARTOC graph: Fuseki, importer, query API, and updater

Internal RDF store and metadata importer for
[`coli-conc-server#72`](https://github.com/gbv/coli-conc-server/issues/72),
using `ghcr.io/nfdi4objects/n4o-fuseki:main` and
`ghcr.io/nfdi4objects/n4o-graph-importer:main`, with
`ghcr.io/nfdi4objects/n4o-graph-apis:main` as its public query-only API.

Fuseki stores the RDF database, while the importer maintains its registry and
stage files and writes terminology metadata to Fuseki. An updater job downloads
and registers all metadata from the current BARTOC dump every day.

The database and importer stage are persistent. Fuseki and the importer have
no published host ports and remain on the internal backend network. Only the
query API also joins the nginx network.

## Importer process

Compose starts the importer with:

```yaml
command: ["python", "./app.py", "--wsgi"]
```

The `--wsgi` option makes the application use its Waitress WSGI server instead
of Flask's development server. The upstream image defines `python ./app.py` as
its `CMD`, not as an `ENTRYPOINT`. Because a Compose `command` replaces the
whole image `CMD`, the full command must be repeated; `command: ["--wsgi"]`
would try to execute `--wsgi` as a program and fail.

## Fuseki healthcheck

The Fuseki container checks its internal SPARQL endpoint with:

```sh
wget -q -O /dev/null \
  'http://localhost:3030/n4o?query=ASK%20%7B%7D'
```

Docker runs this command inside the Fuseki container, so `localhost:3030`
refers to Fuseki itself and does not require publishing the port on the host.
`/n4o` is the configured dataset, and `ASK {}` is the smallest SPARQL query
that can confirm that the HTTP endpoint accepts and evaluates queries. It also
returns `true` for an empty database, so the service can become healthy before
any BARTOC metadata has been imported.

The command discards the response body and succeeds only when `wget` receives
a successful HTTP response. Docker runs it every 10 seconds, allows 5 seconds
for each attempt, ignores failures during the first 20 seconds, and marks the
container unhealthy after 12 consecutive failures. The importer uses
`depends_on` with `condition: service_healthy`, so it is not started until this
check succeeds.

This healthcheck confirms SPARQL endpoint availability, but it does not verify
the number of triples, the presence of specific BARTOC records, or persistence
and filesystem permissions. Those properties require the separate verification
commands below.

## Importer status and healthcheck

`/status.json` is a dynamically generated HTTP endpoint, not a file stored in
the container. It exposes the importer's current configuration in a response
similar to:

```json
{
  "base": "https://bartoc.org/graph/",
  "connected": true,
  "data": "/app/data",
  "frontend": "https://bartoc.org/graph/",
  "sparql": "http://fuseki:3030/n4o",
  "stage": "/app/stage",
  "store": "<lib.triplestores.ExternalTripleStore object at 0x...>",
  "title": "BARTOC Graph Importer"
}
```

The useful diagnostic fields are `base`, `data`, `sparql`, `stage`, and
`title`. The `store` value is an implementation detail whose memory address
changes between processes and must not be used for health checks.

In the current upstream image, `connected` is always set to `true`; the code
that would test the SPARQL connection is commented out. The Compose healthcheck
therefore performs two independent requests: it checks that `/status.json`
returns valid JSON and then sends an `ASK {}` query directly to Fuseki. The
importer is healthy only when both endpoints are reachable.

## Public SPARQL query API

The `query-api` service publishes one endpoint through nginx:

```text
https://bartoc.org/api/sparql
```

It forwards SPARQL queries internally to `http://fuseki:3030/n4o`. The public
service accepts GET and POST query requests and passes through result formats
for SELECT, ASK, CONSTRUCT, and DESCRIBE. SPARQL Update content, update form
parameters, and Graph Store methods are rejected. Fuseki itself remains only on
the internal `backend` network and port 3030 is not published.

The upstream API returns `Access-Control-Allow-Origin: *`, which includes
`https://bartoc.org` and is appropriate for this public read-only endpoint. The
BARTOC configuration value for
[`bartoc.org#317`](https://github.com/gbv/bartoc.org/issues/317) is therefore:

```json
{
  "sparql": "https://bartoc.org/api/sparql"
}
```

The service's healthcheck sends `ASK {}` through the public API process to the
internal Fuseki endpoint. No optional stage or report data is enabled.

## Scheduled and manual BARTOC update

The `updater` service installs `/config/cron` and keeps `crond` in the
foreground. The cron job runs `update.sh` every day at 04:15 UTC. Starting or
restarting the container does not trigger an additional update.

Before downloading data, `update.sh` acquires a non-blocking lock on
`/data/update.lock`. If another update is already running, the new invocation
prints one message and exits successfully. The lock is released automatically
when the process exits; the empty lock file can remain in the data directory.

The job performs these operations:

```text
download latest.ndjson
  -> preserve the unmodified response as /data/bartoc.raw.ndjson
  -> inspect all nested JSON-LD contexts
  -> remove only the known nested JSKOS context from an importer copy
  -> convert that NDJSON copy to one JSON array
  -> reject an empty dump or records without numeric BARTOC node URIs
  -> atomically replace /data/bartoc.json
  -> PUT all records to importer /terminology/
```

The exact downloaded dump remains available in `bartoc.raw.ndjson`.
`bartoc.json` contains all the same records, normalized only as described below,
and is the file sent to the importer. The importer uses each record's `uri` to
build its registry and reads the metadata from the shared file, so a separate
URI-only file is unnecessary.

The updater joins the internal `backend` network to reach the importer and the
regular `egress` network to download the public dump. It has no published port
and does not access Fuseki directly.

Build the small Alpine image and start the scheduled service with:

```sh
srv raw bartoc-graph build updater
srv start bartoc-graph
srv raw bartoc-graph logs --follow updater
```

Run an additional update manually with:

```sh
srv run bartoc-graph --rm updater /config/update.sh
```

To see the output live and retain a separate log for analysis, run it from a
shell that supports `pipefail`:

```sh
set -o pipefail
srv run bartoc-graph --rm updater /config/update.sh 2>&1 \
  | tee bartoc-graph-manual-import.log
```

The download and normalized JSON are written completely to temporary files in
`/data` before their final paths are replaced. Each rename is atomic because
its source and destination are on the same filesystem. Download, validation,
and JSON errors therefore preserve the previous importer input. The importer
rebuild itself is not transactional: if its request fails after the file
replacement, run the updater again to rebuild the registry.

The importer batch endpoint does not stream per-record progress. While the PUT
is running, the updater therefore samples the importer's `stage` directory,
mounted read-only at `/stage`, every 60 seconds. Each log line contains a UTC
timestamp, elapsed seconds, the number of staged terminology records, and the
target count. During replacement the count may first decrease while the old
registry is purged and then increase while the new registry is built. The
interval can be changed with `BARTOC_GRAPH_PROGRESS_INTERVAL_SECONDS`.

The PUT has no total timeout because a full rebuild can take longer than the
previous six-hour pilot limit. The update lock prevents the following scheduled
run from starting concurrently if a rebuild is still active. Progress messages
are written to standard error so they remain visible through `srv run`;
standard output is left free for possible machine-readable results.

### Local nested-context workaround

Some BARTOC records contain the canonical JSKOS context URL not only at the
record root but also inside nested concepts:

```json
{
  "@context": "https://gbv.github.io/jskos/context.json",
  "subject": [
    {
      "uri": "http://dewey.info/class/321/e23/",
      "@context": "https://gbv.github.io/jskos/context.json"
    }
  ]
}
```

The importer replaces the root context with its bundled JSKOS context, but
PyLD still tries to download the nested context. That request fails because the
importer is deliberately confined to the internal network, causing the entire
batch request to return HTTP 500.

As a local workaround, the updater removes only nested declarations whose value
is exactly `https://gbv.github.io/jskos/context.json` from the importer copy.
Root `@context` declarations are retained. The raw NDJSON is never modified.
For the currently affected records, comparison with online JSON-LD expansion
showed identical RDF triples before and after this normalization.

This is intentionally not a generic context remover. If the dump contains any
other nested context value, the updater stops before replacing persistent input
files or calling the importer. The upstream fix should make PyLD resolve the
canonical JSKOS URL from the importer's bundled context; once that is available,
this local normalization can be removed.

## `bartoc.json` format

The public dump is newline-delimited JSON: each line contains one complete
BARTOC record. The updater stores those bytes as `/data/bartoc.raw.ndjson`, then
uses `jq --slurp` to normalize the known nested contexts and create the single
JSON array stored as `/data/bartoc.json`. An abbreviated real record looks like:

```json
[
  {
    "uri": "http://bartoc.org/en/node/10",
    "prefLabel": {
      "en": "Australian Public Affairs Information Service Thesaurus",
      "und": "APAIS Thesaurus"
    },
    "type": [
      "http://www.w3.org/2004/02/skos/core#ConceptScheme",
      "http://w3id.org/nkos/nkostype#thesaurus"
    ]
  }
]
```

Actual records contain additional JSKOS/BARTOC metadata. The importer mounts
the file read-only at `/app/data/bartoc.json` and looks up records by their
numeric BARTOC node URI.

## Setup

The image runs as UID/GID `1000`. With rootless Docker, set ownership from
inside the container namespace:

```sh
mkdir -p "$COLI_CONC_BASE/data/bartoc-graph"/{databases,logs,stage,data}
srv configtest bartoc-graph
srv raw bartoc-graph pull fuseki importer query-api
srv run bartoc-graph --rm --user root --entrypoint chown \
  fuseki -R 1000:1000 /fuseki/databases /fuseki/logs
srv start bartoc-graph
```

Persistent data is stored below `$COLI_CONC_BASE/data/bartoc-graph`:

```text
databases  Fuseki database
logs       Fuseki logs
stage      importer registry and stage files
data       raw BARTOC dump and normalized bartoc.json importer input
```

Do not delete `databases` if the graph must be preserved. The importer mounts
`data` read-only.

The named graph base defaults to `https://bartoc.org/graph/` and can be
overridden with `BARTOC_GRAPH_BASE`; keep the trailing slash. With the default,
terminology metadata is written to
`https://bartoc.org/graph/terminology/`. This namespace is not yet a finalized
public interface.

## Verification

```sh
docker inspect bartoc-graph-fuseki-1 bartoc-graph-importer-1 \
  bartoc-graph-query-api-1 \
  --format '{{.Name}} {{.State.Health.Status}}'
docker exec bartoc-graph-fuseki-1 sh -c \
  'test -w /fuseki/databases && test -w /fuseki/logs && echo "volumes writable"'
docker exec bartoc-graph-fuseki-1 wget -q -O - \
  'http://localhost:3030/n4o?query=ASK%20%7B%7D'
docker exec bartoc-graph-importer-1 python -c \
  "import urllib.request; print(urllib.request.urlopen('http://localhost:5020/status.json').read().decode())"
curl --fail --show-error --silent --get \
  --data-urlencode 'query=ASK {}' \
  --header 'Accept: application/sparql-results+json' \
  https://bartoc.org/api/sparql
curl --silent --output /dev/null --write-out '%{http_code}\n' \
  --request POST \
  --header 'Content-Type: application/sparql-update' \
  --data 'INSERT DATA { <urn:test:s> <urn:test:p> <urn:test:o> }' \
  https://bartoc.org/api/sparql
```

All three containers must be `healthy`. The remaining expected results are
`volumes writable`, `<boolean>true</boolean>`, importer status containing
`"sparql": "http://fuseki:3030/n4o"`, a public ASK result with `true`, and HTTP
status `400` for the attempted update. Ports `3030/tcp` and `5020/tcp` remain
internal; nginx discovers the query API from its container environment.
