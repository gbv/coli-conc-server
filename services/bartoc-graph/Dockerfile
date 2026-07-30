FROM alpine:3.23

# The updater uses curl for HTTP, jq for NDJSON/JSON conversion, and flock to
# serialize scheduled and manual runs.
RUN apk add --no-cache curl jq flock
