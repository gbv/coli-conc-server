#!/bin/sh

set -eu

crontab /config/cron
exec crond -f -l 8 -L /dev/stderr
