# Code Review Fixes

## Correctness
1. **`insertTurn` wrong ID on conflict** — `conversation.ts:88` — use `changes()` to detect ignored insert
2. **`findUsages` off-by-one** — `search.ts:234` — remove `- 1` from line calc
3. **`upsertFileStart` FK invalidation** — `files.ts:11` — UPDATE instead of DELETE+INSERT to preserve file id
4. **`StoredFile` type mismatch** — `types.ts:12` / `files.ts:5` — alias columns or fix interface

## Robustness
5. **FTS special char crashes** — `search.ts:35,102` — sanitize by quoting tokens before MATCH
6. **Conversation session filter post-fetch** — `conversation.ts:161,220` — increase vector limit when filtering
7. **`pruneDeleted` N transactions** — `files.ts:90` — wrap in single transaction
8. **`splitJSON` size guard** — `chunker.ts:394` — skip JSON.parse above 50MB, fall back to line splitting

## Code Quality
9. **Duplicated hybrid merge** — `hybrid.ts` — extract shared merge helper
10. **`any` types in dynamic SQL** — `annotations.ts:88`, `checkpoints.ts:72,144` — define row types
11. **`isCode` duplicates `AST_SUPPORTED`** — `chunker.ts:116` — derive from set union
12. **Long one-liner delegates** — `db/index.ts:293-350` — multi-line format
13. **`getSubgraph` loads full graph** — `graph.ts:103` — SQL-based BFS per hop

## Testing
14. **Large JSON tests in default suite** — move to benchmarks, exclude from `bun test`
15. **No FTS special char test** — add test for `c++`, `node.js`, quotes

## Order
1→2→3→4→5→6→7→8→9→10→11→12→13→14→15
