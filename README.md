# local-rag-mcp

Semantic search for your codebase, zero config, with built-in gap analysis.

Indexes any files — markdown, code, configs, docs — into a per-project vector store. Your AI assistant finds what it needs by meaning, not filename. Usage analytics show you where your docs are falling short.

No API keys. No cloud. No Docker. Just `bun install`.

## Why

- **AI agents guess filenames.** They read files one at a time and miss things. This gives them semantic search — "how do we deploy?" finds the right doc even if it's called `runbook-prod-release.md`.
- **No one reads the docs.** Docs exist but never get surfaced at the right moment. This makes them findable by meaning, automatically.
- **Analytics expose documentation gaps.** After a week of usage, you'll know which topics people search for but can't find — that's a free gap analysis.

## Quick start

```bash
git clone <repo>
cd local-rag-mcp
bun install
```

> **macOS:** Apple's bundled SQLite doesn't support extensions. Run `brew install sqlite` first.

### Add to Claude Code

In `~/.claude/settings.json` (global) or `<project>/.claude/settings.json` (per-project):

```json
{
  "mcpServers": {
    "local-rag": {
      "command": "bun",
      "args": ["run", "/path/to/local-rag-mcp/src/server.ts"],
      "env": {
        "RAG_PROJECT_DIR": "/path/to/your/project"
      }
    }
  }
}
```

Omit `RAG_PROJECT_DIR` for per-project configs — the server uses cwd.

### Auto-indexing

The MCP server automatically indexes your project on startup and watches for file changes during the session. You don't need to manually run `index` — just connect and search.

Progress is logged to stderr:
```
[local-rag] Startup index: 12 indexed, 0 skipped, 0 pruned
[local-rag] Watching /path/to/project for changes
[local-rag] Re-indexed: docs/setup.md
```

### Make the agent use it automatically

The MCP server registers tools, but the agent won't reach for them on its own unless you tell it to. Add this to your project's `CLAUDE.md`:

```markdown
When answering questions about this project's architecture, conventions,
or setup, use the `search` MCP tool first to find relevant docs before
reading files directly.
```

Without this, the agent only uses the tools when you explicitly ask it to search. With it, the agent proactively searches the RAG index whenever it thinks local docs might help.

### CLI usage

The CLI is available for manual use, debugging, and analytics:

```bash
# Search by meaning
bun run src/cli.ts search "database connection setup" --dir /path/to/project

# Check what's indexed
bun run src/cli.ts status /path/to/project

# Manual index (not needed if using the MCP server)
bun run src/cli.ts index /path/to/project
```

## MCP tools

These tools are available to any MCP client (Claude Code, etc.) once the server is running:

| Tool | What it does |
|---|---|
| `search` | Semantic search over indexed files — returns ranked paths, scores, and snippets |
| `index_files` | Index files in a directory — skips unchanged files, prunes deleted ones |
| `index_status` | Show file count, chunk count, last indexed time |
| `remove_file` | Remove a specific file from the index |
| `search_analytics` | Usage analytics — query counts, zero-result queries, low-relevance queries, top terms |

## CLI commands

```bash
local-rag init [dir]                     # Create .rag/config.json with defaults
local-rag index [dir]                    # Index files
local-rag search <query> [--top N]       # Search by meaning
local-rag status [dir]                   # Show index stats
local-rag remove <file> [dir]            # Remove a file from the index
local-rag analytics [dir] [--days N]     # Show search usage analytics
```

## Analytics

Every search is logged automatically. Run `analytics` to see what's working and what's not:

```
Search analytics (last 30 days):
  Total queries:    142
  Avg results:      3.2
  Avg top score:    0.58
  Zero-result rate: 12% (17 queries)

Top searches:
  3× "authentication flow"
  2× "database migrations"

Zero-result queries (consider indexing these topics):
  3× "kubernetes pod config"
  2× "slack webhook setup"

Low-relevance queries (top score < 0.3):
  "how to fix the build" (score: 0.21)
```

**Zero-result queries** tell you what topics your docs are missing. **Low-relevance queries** tell you where docs exist but don't answer the actual question. Both are actionable.

## Configuration

Create `.rag/config.json` in your project (or run `local-rag init`):

```json
{
  "include": ["**/*.md", "**/*.txt"],
  "exclude": ["node_modules/**", ".git/**", "dist/**", ".rag/**"],
  "chunkSize": 512,
  "chunkOverlap": 50
}
```

## How it works

1. **Index** — walks your project, matches files against include/exclude globs, parses content (frontmatter-aware for markdown), splits into chunks (AST-aware for code via tree-sitter, heading-based for markdown), generates embeddings with all-MiniLM-L6-v2, stores vectors in sqlite-vec
2. **Search** — hybrid search combining vector similarity (semantic) with BM25 (keyword matching). Deduplicates by file, returns ranked results. Configurable blend via `hybridWeight`.
3. **Watch** — auto-indexes on MCP server startup, then watches for file changes with debounced re-indexing. Deletions are detected and pruned automatically.
4. **Re-index** — compares SHA-256 hashes — skips unchanged files, prunes deleted ones
5. **Log** — records every query with result count, top score, and duration for analytics

## Stack

| Layer | Choice |
|---|---|
| Runtime | Bun (built-in SQLite, fast TS) |
| Embeddings | Transformers.js + ONNX (in-process, no daemon) |
| Model | all-MiniLM-L6-v2 (~23MB, 384 dimensions) |
| Vector store | sqlite-vec (single `.db` file) |
| MCP | @modelcontextprotocol/sdk (stdio transport) |

## Per-project storage

```
your-project/
  .rag/
    index.db        ← vectors, chunks, query logs
    config.json     ← include/exclude patterns, settings
```

Add `.rag/` to your `.gitignore`.
