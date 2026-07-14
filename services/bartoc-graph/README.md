# BARTOC graph: Fuseki

Internal RDF store for
[`coli-conc-server#72`](https://github.com/gbv/coli-conc-server/issues/72),
using `ghcr.io/nfdi4objects/n4o-fuseki:main`.

The database is persistent. Fuseki has no published host port and is not
connected to the nginx network.

## Setup

The image runs as UID/GID `1000`. With rootless Docker, set ownership from
inside the container namespace:

```sh
mkdir -p "$COLI_CONC_BASE/data/bartoc-graph"/{databases,logs}
srv configtest bartoc-graph
srv raw bartoc-graph pull fuseki
srv run bartoc-graph --rm --user root --entrypoint chown \
  fuseki -R 1000:1000 /fuseki/databases /fuseki/logs
srv start bartoc-graph
```

Persistent data is stored below `$COLI_CONC_BASE/data/bartoc-graph`. Do not
delete its `databases` directory if the graph must be preserved.

## Verification

```sh
docker inspect bartoc-graph-fuseki-1 --format '{{.State.Health.Status}}'
docker exec bartoc-graph-fuseki-1 sh -c \
  'test -w /fuseki/databases && test -w /fuseki/logs && echo "volumes writable"'
docker exec bartoc-graph-fuseki-1 wget -q -O - \
  'http://localhost:3030/n4o?query=ASK%20%7B%7D'
```

Expected results are `healthy`, `volumes writable`, and `<boolean>true</boolean>`.
`3030/tcp` is internal only; nginx requires no changes.
