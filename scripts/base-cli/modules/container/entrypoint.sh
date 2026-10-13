#!/bin/sh
set -eu
umask 077
mkdir -p /data
exec flock --nonblock --no-fork /data/host.lock node /runtime/modules/container/host.mjs "$@"
