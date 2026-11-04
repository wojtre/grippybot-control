#!/usr/bin/env bash
set -euo pipefail
if [[ "$#" != 1 || "$1" != *@* || "$1" == -* ]]; then
 echo 'Użycie na Macu/Linux: bash scripts/connect.sh LOGIN@NAZWA-PI.local' >&2
 exit 2
fi
echo 'Zostaw terminal otwarty. Panel: http://127.0.0.1:8765 (Ctrl+C kończy tunel).'
exec ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
 -L 127.0.0.1:8765:127.0.0.1:8765 "$1"
