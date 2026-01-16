#!/bin/bash
set -euo pipefail

HOST="mongo-prod:27017"
RS="rs0"

echo "⏳ Waiting for MongoDB at ${HOST}..."
until mongosh --quiet --host "$HOST" --eval 'db.adminCommand({ ping: 1 }).ok' >/dev/null 2>&1; do
  sleep 1
done

echo "⚙️ Ensuring Replica Set is initiated (${RS})..."

mongosh --host "$HOST" --quiet <<EOF
try {
  const status = rs.status();
  print("Replica set already initialized:", status.set);
} catch (e) {
  print("Initializing replica set...");
  rs.initiate({
    _id: "${RS}",
    version: 1,
    members: [{ _id: 0, host: "${HOST}", priority: 1 }]
  });
  print("Replica set initiated.");
}
EOF
