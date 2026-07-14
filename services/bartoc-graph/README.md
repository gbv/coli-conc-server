# BARTOC graph: Fuseki

This is the first infrastructure step for
[`coli-conc-server#72`](https://github.com/gbv/coli-conc-server/issues/72).
It provides the internal RDF store that the BARTOC graph importer will use in
a subsequent step.

The Compose project currently contains only `fuseki`, running
`ghcr.io/nfdi4objects/n4o-fuseki:main`. Its RDF database is persistent, but no
port is published and the service is not connected to the public nginx network.

## Initialization

Create the bind-mount directories before starting the service. The upstream
Fuseki image runs as UID/GID `1000`, so both directories must be writable by
that user:

```sh
mkdir -p data/bartoc-graph/{databases,logs}
sudo chown -R 1000:1000 data/bartoc-graph/databases data/bartoc-graph/logs
srv configtest bartoc-graph
srv init bartoc-graph
```

The persistent directories are:

```text
$DATA/bartoc-graph/databases  Fuseki TDB database
$DATA/bartoc-graph/logs       reserved for Fuseki logs (upstream file logging is currently disabled)
```

Stopping or restarting the service does not remove the database. Do not use
`docker compose down --volumes` or delete the directories above if the graph
must be preserved.

## Verification

Check that Fuseki is running and healthy:

```sh
srv raw bartoc-graph ps
srv raw bartoc-graph logs --tail=100 fuseki
```

Run the same minimal SPARQL query used by the healthcheck:

```sh
srv exec bartoc-graph fuseki wget -q -O - \
  'http://localhost:3030/n4o?query=ASK%20%7B%7D'
```

The `PORTS` column shown by `srv raw bartoc-graph ps` may contain `3030/tcp`,
which is the image's internal port, but it must not contain a host mapping such
as `0.0.0.0:3030->3030/tcp`. Fuseki is deliberately reachable only on the
project's internal `backend` network; nginx does not need to be changed or
restarted.
