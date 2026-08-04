#!/bin/sh

set -e # Exit early if any commands fail
NODE_PATH="$(dirname "$0")/node_modules" \
exec node "$(dirname "$0")/app/main.js" "$@"
