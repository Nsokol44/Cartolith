#!/usr/bin/env bash
"$(dirname "$0")/stop.sh"
sleep 1
exec "$(dirname "$0")/start.sh"
