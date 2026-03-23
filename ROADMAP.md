# local-rag — Roadmap

Honest project assessment and forward plan. Last updated 2026-03-23.

---

## What local-rag actually solves

local-rag gives AI coding agents (and humans) semantic search over a codebase — the ability to ask "how does deployment work?" and get the right file back even if it's called `runbook-prod-release.md`. This is a real problem: agents guess filenames, read files one at a time, and miss things.

**Core value delivered today (v0.2.15):**

1. **Hybrid search (vector + BM25) with cross-encoder reranking** — Queries run both semantic similarity and keyword matching, blended at a configurable ratio. A cross-encoder reranker (ms-marco-MiniLM-L-6-v2) re-scores the top candidates for higher precision. This is competitive with or better than every competitor's search pipeline.

2. **AST-aware chunking for 6 languages** — TypeScript, JavaScript, Python, Go, Rust, Java get real function/class boundary splitting via tree-sitter (bun-chunk). 20+ other file types (YAML, Dockerfile, SQL, Terraform, etc.) have dedicated heuristic chunkers. This is the widest file type coverage in the space.

3. **Zero-config, zero-API-keys, zero-cloud** — `bunx @winci/local-rag serve` and you're running. Embeddings and reranking run in-process via ONNX. The entire index is a single SQLite file. This is a genuine differentiator — claude-context requires OpenAI + Zilliz API keys, knowledge-rag needs Python 3.11+, etc.

4. **Unique features no competitor has** — These are real, implemented, tested, and working:
   - `search_conversation` — indexes Claude Code JSONL transcripts in real time, searchable within seconds
   - `create_checkpoint` / `search_checkpoints` — semantic snapshots of decisions, milestones, blockers
   - `annotate` / `get_annotations` — persistent notes on files/symbols that surface inline in search results
   - `find_usages` — call-site enumeration across the codebase with file:line output
   - `project_map` — Mermaid dependency graph from AST-extracted import/export relationships
   - `git_context` — uncommitted changes annotated with index status
   - `search_analytics` — zero-result and low-relevance query tracking for doc gap analysis
   - `write_relevant` — insertion point finder for new code

5. **Good test coverage** — 26 test files covering DB, indexing, search, conversation, annotations, checkpoints, git context, CLI, config, graph, and the MCP server.

6. **CLI-first design** — Every MCP tool has a CLI equivalent. The server is one subcommand (`serve`), not the only mode.

---

## Where it falls short — honest assessment

### 1. The plugin story is aspirational, not real

The README presents the Claude Code plugin as the "recommended" install path:

```
/plugin install local-rag@claude-plugins-official
```

**This doesn't work.** There is no Claude Code plugin marketplace yet. The plugin infrastructure (`.claude-plugin/plugin.json`, `skills/`, `hooks/`) exists in the repo but has no distribution channel. Users cannot actually install local-rag as a plugin — they must manually configure it as an MCP server.

The `plugin.json` version is stuck at `0.1.24` while the package is at `0.2.15`, further suggesting this path isn't actively used or tested.

**What actually works:** MCP server setup via `settings.json` or `.mcp.json`. This is how all users are actually running local-rag today.

### 2. The SessionStart hook is a placeholder

`hooks/scripts/session-start.sh` contains only `exit 0`. The README claims the plugin "Makes the agent use RAG tools proactively" on session start, but the hook that's supposed to run `git_context` and surface annotations does nothing.

The `PostToolUse` hook (reindex on file edit) does work — it's a real shell script that calls `bunx @winci/local-rag index`. But auto-checkpoint on session end (`SessionEnd`) isn't implemented either.

### 3. Conversation indexing only works with Claude Code

The conversation search feature tails Claude Code's JSONL transcript files. It doesn't work with Cursor, Windsurf, VS Code Copilot, or any other MCP client. This is a significant limitation that the README doesn't call out — it's presented as a general feature.

If Claude Code changes its transcript format or location, this feature breaks silently.

### 4. No published benchmarks or quality metrics

There's a benchmark harness (`local-rag benchmark`) and an A/B eval harness (`local-rag eval`), which is great infrastructure. But there are no published results — no recall@K numbers, no MRR scores, no comparison to competitors. Users have no way to evaluate search quality before trying it.

The reranker was a major quality improvement, but we can't quantify how much because we haven't published before/after numbers.

### 5. 384d embeddings are a real limitation

all-MiniLM-L6-v2 is a good model for its size, but 384 dimensions genuinely capture less semantic nuance than 768d models. The cross-encoder reranker compensates at query time, but the base retrieval pool (the candidates the reranker sees) is still limited by embedding quality.

For code search specifically, code-specialized embedding models (like CodeBERT or StarEncoder) would likely outperform a general-purpose sentence transformer. We haven't evaluated this.

### 6. Bun is real friction

Bun is a hard dependency — not just for speed, but because the project uses `bun:sqlite` directly. There's no Node.js fallback. In enterprise environments where toolchain choices are locked down, this is a blocker. The decision to cut Node.js compat was pragmatic (maintaining two runtimes is expensive for a solo maintainer), but it costs adoption.

### 7. The bun-chunk upgrade is substantial unfinished work

`UPGRADE-LOCAL-RAG.md` describes a 5-phase upgrade plan for bun-chunk 0.1.0 → 0.1.1. Phase 0 (fix the breaking API change) is a hard prerequisite for everything else. The git log shows `feat: upgraded bun-chunk` landed, but the upgrade plan document still exists as untracked, suggesting the richer features (expanded language support, enhanced import resolution, chunk-level deduplication) haven't been completed.

This upgrade would bring: C/C++/C#/Ruby/PHP/Scala AST support, tsconfig path resolution, and incremental re-indexing (skip re-embedding unchanged chunks). These are real quality-of-life improvements that are designed but not shipped.

### 8. The competitive landscape table is outdated

The ROADMAP's competitive table says local-rag has "No reranking" — but reranking shipped in v0.2.1. The table also shows "6 languages" for AST chunking, but the config already includes C/C++/C#/Ruby/PHP/Scala extensions (even if bun-chunk support for some isn't fully wired up yet).

### 9. No office docs — intentional but limiting

PDF/DOCX support is positioned as "not our audience." This is a defensible choice for a code-search tool, but it means local-rag can't index design docs, RFCs, or runbooks that live as PDFs in the repo. For teams where documentation lives in non-code formats, this is a gap.

### 10. Solo maintainer risk

This is the same situation as most competitors, but it's real. Bus factor of 1. No contributor ecosystem. If the maintainer steps away, the project stalls.

---

## What the README promises vs. reality

| README claim | Status | Notes |
|---|---|---|
| Hybrid search (vector + BM25) | **Shipped** | Working, configurable weight |
| Cross-encoder reranking | **Shipped** | ms-marco-MiniLM-L-6-v2, enabled by default |
| AST-aware chunking (6 languages) | **Shipped** | TS/JS, Python, Go, Rust, Java via bun-chunk |
| 20+ file types | **Shipped** | Markdown, YAML, JSON, TOML, Dockerfile, SQL, etc. |
| Conversation history indexing | **Shipped** | Claude Code only, not other editors |
| Checkpoints | **Shipped** | Create, list, semantic search |
| Annotations | **Shipped** | File/symbol-level, inline in search results |
| find_usages | **Shipped** | FTS-based call-site enumeration |
| project_map | **Shipped** | Mermaid graph from AST imports/exports |
| git_context | **Shipped** | Status + recent commits + index annotation |
| search_analytics | **Shipped** | Zero-result, low-relevance, trends |
| write_relevant | **Shipped** | Insertion point finder |
| Plugin install via marketplace | **Not real** | No marketplace exists; manual MCP setup required |
| PostToolUse hook (auto-reindex) | **Shipped** | Works as a shell script |
| SessionStart hook (git_context) | **Placeholder** | Script is `exit 0` |
| SessionEnd hook (auto-checkpoint) | **Not implemented** | Not in hooks.json |
| Demo command | **Shipped** | Works, but references non-existent plugin install |
| Zero config | **Mostly true** | Auto-creates `.rag/config.json` on first run |
| Auto-indexing + file watcher | **Shipped** | Debounced, prunes deletions |

**Bottom line:** The core search engine and unique features are real and working. The plugin distribution story is the main thing that's oversold.

---

## Completed plan phases (from original roadmap)

### 1. Cross-encoder reranking — DONE

Shipped in v0.2.1. Using ms-marco-MiniLM-L-6-v2. Integrated into both `search` (file-level) and `searchChunks` (chunk-level) pipelines. Graceful fallback to hybrid scores if reranking fails. Configurable via `enableReranking` (default true). ~80MB model downloaded on first query.

**What was planned:** Exactly what shipped. This was well-scoped and well-executed.

### 2. Plugin structure — PARTIALLY DONE

The plugin manifest, skill file, and hooks exist in the repo. The PostToolUse hook works. But:
- No marketplace to submit to
- SessionStart hook is a stub
- SessionEnd hook doesn't exist
- plugin.json version is stale
- The "recommended" install path in the README doesn't work

**What was planned:** Marketplace submission and full hook suite. Neither is complete.

### 3. Demo command — DONE

`local-rag demo` runs a walkthrough: index → semantic search → chunk retrieval → symbol search → project map summary. Clean terminal output with colors.

### 4. bun-chunk upgrade — PARTIALLY DONE

The dependency was bumped and the basic integration works. But the 5-phase upgrade plan (expanded languages, chunkFile API, enhanced resolver, chunk dedup, file-level graph) is largely unfinished.

---

## Revised feature plan

### Priority 1: Fix the README (scope: small, impact: trust)

Stop claiming what doesn't exist. The README should:

1. Remove the plugin marketplace install instructions or clearly mark them as "coming when Claude Code launches a plugin marketplace"
2. Lead with the MCP server setup (which actually works) as the primary path
3. Note that conversation search is Claude Code-specific
4. Remove or qualify the SessionStart/SessionEnd hook claims
5. Sync plugin.json version with package.json

This is the single highest-ROI change because every new user's first impression comes from the README. Overselling erodes trust faster than underselling.

### Priority 2: Complete the bun-chunk upgrade (scope: medium, impact: quality)

The upgrade plan in `UPGRADE-LOCAL-RAG.md` is thorough and well-analyzed. Execute it:

- **Phase 0** (breaking API fix) — may already be done, needs verification
- **Phase 1** (expand to C/C++/C#/Ruby/PHP/Scala) — immediate win, low risk
- **Phase 5** (file-level graph data) — cleaner pipeline, low risk
- **Phase 3** (enhanced resolver with tsconfig paths) — medium risk, high value for monorepos
- **Phase 2** (chunkFile + context + metadata) — low risk, better entity naming
- **Phase 4** (chunk-level dedup) — high risk, big perf win for re-indexing, do last behind a flag

This upgrade expands AST support from 6 to 14 languages and enables incremental re-indexing. Both are tangible improvements users will notice.

### Priority 3: Publish benchmark results (scope: small, impact: credibility)

Run the existing benchmark and eval harness against:
- This project's own codebase
- A well-known open-source project (e.g., Express, FastAPI)
- Before/after reranking comparison

Publish recall@5, MRR, and latency numbers in the README or a BENCHMARKS.md. This is the cheapest way to build credibility — the infrastructure already exists.

### Priority 4: Make the SessionStart hook real (scope: small, impact: UX)

Replace the `exit 0` stub with a script that:
1. Calls `git_context` and prints a summary
2. Checks `search_analytics` for recent zero-result queries
3. Surfaces any annotations on recently modified files

This was always planned and the server already supports all the underlying tools. It's just wiring.

### Priority 5: Evaluate code-specialized embeddings (scope: medium, impact: quality)

The 384d general-purpose model works, but code search is a specialized domain. Evaluate:
- `Xenova/code-search-net-all-MiniLM-L6-v2` — same size, code-tuned
- `nomic-ai/nomic-embed-code-v1` — if a Bun/ONNX version exists
- Keep all-MiniLM-L6-v2 as default, add config option for alternative models

If a code-specialized model shows measurably better recall on the benchmark harness, make it the default. If not, document the comparison and move on.

### Priority 6: Plugin marketplace (scope: depends on Anthropic, impact: distribution)

When Claude Code actually launches a plugin marketplace:
1. Sync plugin.json version
2. Implement the SessionEnd auto-checkpoint hook
3. Submit to marketplace
4. Update README to lead with plugin install

Until then, don't pretend it exists.

### Low priority: Office docs

Still deprioritized. The reasoning from the original roadmap holds — core audience is developers, broadening file support dilutes positioning. Revisit if search_analytics data from real users shows demand.

---

## Competitive landscape (updated)

| | local-rag | rag-cli | claude-context (Zilliz) | knowledge-rag | mcp-local-rag | claude-context-local |
|---|---|---|---|---|---|---|
| Distribution | MCP server | **Plugin** (marketplace) | MCP server | MCP server | MCP server | MCP server |
| Runtime | Bun | Python | Node.js | Python 3.11-3.12 | Node.js | Python 3.12+ |
| Vector store | SQLite + sqlite-vec | ChromaDB | Milvus (cloud) | ChromaDB + DuckDB | LanceDB | FAISS |
| Embedding | all-MiniLM-L6-v2 (384d, 23MB) | all-MiniLM-L6-v2 (384d) | OpenAI API (paid) | bge-small-en-v1.5 (384d) | all-MiniLM-L6-v2 (384d) | EmbeddingGemma-300m (768d, 1.2GB) |
| Reranking | **Cross-encoder** | Cross-encoder | No | Cross-encoder | No | No |
| API keys | None | None | **OpenAI + Zilliz** | None | None | None |
| MCP tools | 16 | ~5 | 4 | 12 | 6 | ~3 |
| AST chunking | 6 languages (14 planned) | No | Yes | No | No | 9+ languages |
| File types | 20+ | 5 (docs only) | Unspecified | 9 | 4 | Code only (15 ext) |
| Hybrid search | Vector + BM25 + reranker | Vector + keyword | Vector only | Vector + BM25 + reranker | Vector + keyword | Vector only |

### Features only local-rag has

None of the competitors offer any of these:

- Conversation history indexing & search (Claude Code only)
- Session checkpoints (create, list, semantic search)
- Code annotations (inline in search results)
- `find_usages` (call-site enumeration)
- `project_map` (Mermaid dependency graph)
- `git_context` (uncommitted changes + index status)
- Search analytics with gap analysis
- `write_relevant` (insertion point finder)

### Honest weaknesses (updated)

1. ~~**No reranking**~~ — **Shipped.** Cross-encoder reranking is on by default since v0.2.1
2. **Not in the plugin marketplace** — rag-cli has a discovery advantage. No marketplace exists yet for us to submit to
3. **Solo maintainer** — same as most, but Zilliz has a company behind claude-context
4. **No office docs** — rag-cli, knowledge-rag, mcp-local-rag handle PDF/DOCX
5. **Bun dependency** — hard requirement, no Node.js fallback, blocks some enterprise adoption
6. **384d embeddings** — claude-context-local captures more semantic nuance with 768d; our reranker compensates at query time but doesn't fix the retrieval pool
7. **Conversation search is Claude Code-only** — not portable to other MCP clients
8. **No published benchmarks** — hard for users to evaluate search quality before committing

---

## Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-03-21 | Plugin before all other features | Marketplace discovery is the #1 growth lever; hooks enable auto-reindex and auto-checkpoint |
| 2026-03-21 | Reranker over bigger embeddings | Precision win without disk/speed penalty; keeps zero-friction install |
| 2026-03-21 | Node.js compat cut | Bun adoption is growing; no concrete user demand; maintaining two runtimes is expensive; Bun's built-in SQLite is a core dependency |
| 2026-03-21 | Office docs last | Core audience is developers; broadening file support dilutes positioning |
| 2026-03-22 | Upgraded bun-chunk to 0.1.1+ | Access to richer chunk metadata, more languages, better import resolution |
| 2026-03-23 | Revised roadmap: README honesty first | Overselling erodes trust; fix claims before adding features |
| 2026-03-23 | Deprioritized plugin marketplace | Blocked on Anthropic — no marketplace to submit to. Focus on what we control |
| 2026-03-23 | Added benchmark publishing to plan | Credibility gap: good infra exists but no public numbers |
