# Test Plan — local-rag-mcp

## Test Runner

Bun's built-in test runner (`bun test`) — zero config, native TypeScript, fast.

---

## Test Structure

```
local-rag-mcp/
  tests/
    parse.test.ts        ← frontmatter extraction, file type handling
    embed.test.ts        ← model loading, embedding shape/normalization
    chunker.test.ts      ← splitting strategies, edge cases
    db.test.ts           ← sqlite-vec CRUD, search, prune
    indexer.test.ts      ← directory walking, hash skipping, glob matching
    search.test.ts       ← deduplication, ranking, threshold filtering
    config.test.ts       ← config loading, defaults, merging
    server.test.ts       ← MCP tool calls via SDK client
    cli.test.ts          ← CLI command output parsing
    fixtures/
      sample.md          ← MD with frontmatter
      no-frontmatter.md  ← plain MD
      large.md           ← multi-section MD for chunking
      sample.ts          ← TypeScript file
      sample.txt         ← plain text
      empty.md           ← empty file
```

---

## Test Breakdown

### parse.test.ts
- [ ] Extracts frontmatter fields from MD (name, description, type, tags)
- [ ] Builds weighted text with frontmatter prepended to body
- [ ] Returns null frontmatter for non-MD files
- [ ] Returns null frontmatter for MD files without frontmatter
- [ ] Handles empty files gracefully
- [ ] Handles files with only frontmatter (no body)

### embed.test.ts
- [ ] Returns Float32Array of correct dimension (384)
- [ ] Output is normalized (magnitude ≈ 1.0)
- [ ] Model loads once (singleton behavior)
- [ ] Similar texts produce closer vectors than dissimilar texts
- [ ] Handles empty string input

### chunker.test.ts
- [ ] Returns single chunk for text under chunkSize
- [ ] Splits markdown on heading boundaries
- [ ] Splits code on double-newline boundaries
- [ ] Splits plain text on paragraphs
- [ ] Falls back to size-based splitting for large sections
- [ ] Overlap is applied between size-based chunks
- [ ] Merges tiny consecutive sections (< 100 chars)
- [ ] Chunk indices are sequential starting at 0

### db.test.ts
- [ ] Creates .rag directory and index.db
- [ ] Schema tables exist after init (files, chunks, vec_chunks)
- [ ] upsertFile stores file + chunks + vectors
- [ ] upsertFile replaces existing file data (same path, new hash)
- [ ] getFileByPath returns stored file
- [ ] getFileByPath returns null for unknown path
- [ ] search returns results sorted by distance
- [ ] search respects topK limit
- [ ] removeFile deletes file, chunks, and vectors
- [ ] removeFile returns false for unknown path
- [ ] pruneDeleted removes files not in provided set
- [ ] getStatus returns correct counts
- [ ] getStatus returns null lastIndexed when empty

### indexer.test.ts
- [ ] Indexes all files matching include patterns
- [ ] Skips files matching exclude patterns
- [ ] Skips unchanged files (same hash)
- [ ] Re-indexes changed files (different hash)
- [ ] Prunes files deleted from disk
- [ ] Handles nested directories
- [ ] Reports correct indexed/skipped/pruned counts
- [ ] Calls onProgress callback during indexing
- [ ] Handles errors on unreadable files without crashing

### search.test.ts
- [ ] Returns results ranked by relevance
- [ ] Deduplicates chunks from the same file
- [ ] Keeps best score per file after dedup
- [ ] Collects multiple snippets from same file
- [ ] Respects topK limit (by file, not chunk)
- [ ] Returns empty array when index is empty
- [ ] Threshold filters low-scoring results

### config.test.ts
- [ ] Returns defaults when no config.json exists
- [ ] Merges user config with defaults
- [ ] writeDefaultConfig creates valid JSON file
- [ ] Handles malformed config.json gracefully

### server.test.ts (integration)
- [ ] Server starts and lists 4 tools
- [ ] `index_files` tool indexes a test directory
- [ ] `search` tool returns ranked results
- [ ] `search` tool returns helpful message when nothing indexed
- [ ] `index_status` tool returns correct counts
- [ ] `remove_file` tool removes a file from index

### cli.test.ts (integration)
- [ ] `--help` prints usage
- [ ] `init` creates .rag/config.json
- [ ] `index` reports indexed/skipped/pruned counts
- [ ] `search` prints ranked results with scores
- [ ] `status` prints file/chunk counts
- [ ] `remove` confirms removal
- [ ] Unknown command prints error + usage

---

## Shared Test Helpers

```typescript
// tests/helpers.ts
- createTempDir()     ← create isolated temp directory per test
- cleanupTempDir()    ← remove after test
- writeFixture()      ← write test files to temp dir
- indexFixtures()     ← index a set of fixtures, return db
```

---

## Considerations

- **Embedding model warm-up**: First test loading the model will be slow (~2s). Use `beforeAll` to load once, share across tests in the same file.
- **DB isolation**: Each test gets its own temp directory so sqlite-vec databases don't collide.
- **MCP server tests**: Use the MCP SDK client to connect via stdio transport to a real server subprocess.
- **CLI tests**: Use `Bun.spawn` to run CLI commands and assert on stdout.

---

## Implementation Order

1. `tests/helpers.ts` — shared utilities
2. `parse.test.ts` — no deps, fastest to write
3. `chunker.test.ts` — pure functions, no I/O
4. `config.test.ts` — simple file I/O
5. `embed.test.ts` — model loading (slow, do after fast tests)
6. `db.test.ts` — depends on embed
7. `indexer.test.ts` — depends on parse, embed, db, chunker
8. `search.test.ts` — depends on db, embed
9. `server.test.ts` — integration, depends on everything
10. `cli.test.ts` — integration, depends on everything
