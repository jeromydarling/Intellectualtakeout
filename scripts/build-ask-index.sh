#!/bin/bash
# Build the Ask-the-Archive semantic index on the deployed worker:
# embed every corpus chunk (Workers AI), then consolidate into one R2 index.
# Usage: REINDEX_TOKEN=... ./scripts/build-ask-index.sh <site-url>
set -euo pipefail
BASE="${1:?usage: build-ask-index.sh <site-url>}"
: "${REINDEX_TOKEN:?set REINDEX_TOKEN}"

chunks=$(curl -sfS -X POST "$BASE/api/search/reindex" -H "x-reindex-token: $REINDEX_TOKEN" | python3 -c 'import json,sys; print(json.load(sys.stdin)["chunks"])')
echo "embedding $chunks chunks…"
for ((i=0; i<chunks; i++)); do
  for attempt in 1 2 3 4; do
    out=$(curl -sS -m 120 -X POST "$BASE/api/ask/embed?chunk=$i" -H "x-reindex-token: $REINDEX_TOKEN" || echo '{}')
    if echo "$out" | grep -q '"ok":true'; then break; fi
    echo "chunk $i attempt $attempt: $out"; sleep $((attempt*3))
  done
  echo "embed $i/$((chunks-1)) done"
done
echo "consolidating index…"
curl -sS -m 300 -X POST "$BASE/api/ask/build" -H "x-reindex-token: $REINDEX_TOKEN"
echo
echo "ask index build complete"
