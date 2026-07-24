#!/bin/bash
# Load the full search corpus into the deployed worker's D1 FTS index.
# Usage: REINDEX_TOKEN=... ./scripts/reindex-search.sh https://intellectualtakeout.org
set -euo pipefail
BASE="${1:?usage: reindex-search.sh <site-url>}"
: "${REINDEX_TOKEN:?set REINDEX_TOKEN}"

chunks=$(curl -sfS -X POST "$BASE/api/search/reindex" -H "x-reindex-token: $REINDEX_TOKEN" | python3 -c 'import json,sys; print(json.load(sys.stdin)["chunks"])')
echo "reindexing $chunks chunks…"
for ((i=0; i<chunks; i++)); do
  for attempt in 1 2 3; do
    out=$(curl -sS -X POST "$BASE/api/search/reindex?chunk=$i" -H "x-reindex-token: $REINDEX_TOKEN")
    if echo "$out" | grep -q '"ok":true'; then break; fi
    echo "chunk $i attempt $attempt failed: $out"; sleep $((attempt*2))
  done
  echo "chunk $i/$((chunks-1)) done"
done
echo "reindex complete"
