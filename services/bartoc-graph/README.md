# BARTOC graph: Fuseki and importer

Internal RDF store and metadata importer for
[`coli-conc-server#72`](https://github.com/gbv/coli-conc-server/issues/72),
using `ghcr.io/nfdi4objects/n4o-fuseki:main` and
`ghcr.io/nfdi4objects/n4o-graph-importer:main`.

Fuseki stores the RDF database, while the importer maintains its registry and
stage files and writes terminology metadata to Fuseki. Automated download and
import of the BARTOC dump will be added separately.

The database and importer stage are persistent. Neither service has a
published host port or is connected to the nginx network.

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

## Setup

The image runs as UID/GID `1000`. With rootless Docker, set ownership from
inside the container namespace:

```sh
mkdir -p "$COLI_CONC_BASE/data/bartoc-graph"/{databases,logs,stage,data}
srv configtest bartoc-graph
srv raw bartoc-graph pull fuseki importer
srv run bartoc-graph --rm --user root --entrypoint chown \
  fuseki -R 1000:1000 /fuseki/databases /fuseki/logs
srv start bartoc-graph
```

Persistent data is stored below `$COLI_CONC_BASE/data/bartoc-graph`:

```text
databases  Fuseki database
logs       Fuseki logs
stage      importer registry and stage files
data       local importer data, including the future bartoc.json
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
  --format '{{.Name}} {{.State.Health.Status}}'
docker exec bartoc-graph-fuseki-1 sh -c \
  'test -w /fuseki/databases && test -w /fuseki/logs && echo "volumes writable"'
docker exec bartoc-graph-fuseki-1 wget -q -O - \
  'http://localhost:3030/n4o?query=ASK%20%7B%7D'
docker exec bartoc-graph-importer-1 python -c \
  "import urllib.request; print(urllib.request.urlopen('http://localhost:5020/status.json').read().decode())"
```

Both containers must be `healthy`. The remaining expected results are
`volumes writable`, `<boolean>true</boolean>`, and importer status containing
`"sparql": "http://fuseki:3030/n4o"`. Ports `3030/tcp` and `5020/tcp` are
internal only; nginx requires no changes.
