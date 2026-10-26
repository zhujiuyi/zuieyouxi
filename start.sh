#!/bin/sh
set -eu
cd -- "$(dirname -- "$0")"
if [ -f "runtime/node" ]; then
  if [ ! -x "runtime/node" ]; then chmod u+x "runtime/node"; fi
  exec ./runtime/node server.mjs
elif command -v node >/dev/null 2>&1; then
  exec node server.mjs
else
  printf '%s\n' 'Node.js was not found. Use the complete Linux deployment folder.' >&2
  exit 1
fi
