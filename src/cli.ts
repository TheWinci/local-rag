#!/usr/bin/env bun

import { resolve } from "path";
import { RagDB } from "./db";
import { loadConfig, writeDefaultConfig } from "./config";
import { indexDirectory } from "./indexer";
import { search } from "./search";

const args = process.argv.slice(2);
const command = args[0];

function usage() {
  console.log(`local-rag — Local RAG for semantic file search

Usage:
  local-rag init [dir]                    Create default .rag/config.json
  local-rag index [dir] [--patterns ...]  Index files in directory
  local-rag search <query> [--top N]      Search indexed files
  local-rag status [dir]                  Show index stats
  local-rag remove <file> [dir]           Remove file from index
  local-rag analytics [dir] [--days N]    Show search usage analytics

Options:
  dir       Project directory (default: current directory)
  --top N   Number of results (default: 5)
  --patterns  Comma-separated glob patterns to include`);
}

function getDir(argIndex: number): string {
  const dir = args[argIndex];
  return resolve(dir && !dir.startsWith("--") ? dir : ".");
}

function getFlag(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

async function main() {
  if (!command || command === "--help" || command === "-h") {
    usage();
    process.exit(0);
  }

  switch (command) {
    case "init": {
      const dir = getDir(1);
      const path = await writeDefaultConfig(dir);
      console.log(`Created config: ${path}`);
      break;
    }

    case "index": {
      const dir = getDir(1);
      const db = new RagDB(dir);
      const config = await loadConfig(dir);

      const patternsStr = getFlag("--patterns");
      if (patternsStr) {
        config.include = patternsStr.split(",").map((p) => p.trim());
      }

      console.log(`Indexing ${dir}...`);
      const result = await indexDirectory(dir, db, config, console.log);
      console.log(
        `\nDone: ${result.indexed} indexed, ${result.skipped} skipped, ${result.pruned} pruned`
      );
      if (result.errors.length > 0) {
        console.error(`Errors: ${result.errors.join("\n  ")}`);
      }
      db.close();
      break;
    }

    case "search": {
      const query = args[1];
      if (!query) {
        console.error("Usage: local-rag search <query> [--top N]");
        process.exit(1);
      }

      const dir = resolve(getFlag("--dir") || ".");
      const top = parseInt(getFlag("--top") || "5", 10);
      const db = new RagDB(dir);
      const config = await loadConfig(dir);

      const results = await search(query, db, top, 0, config.hybridWeight);

      if (results.length === 0) {
        console.log("No results found. Has the directory been indexed?");
      } else {
        for (const r of results) {
          console.log(`${r.score.toFixed(4)}  ${r.path}`);
          const preview = r.snippets[0]?.slice(0, 120).replace(/\n/g, " ");
          console.log(`         ${preview}...`);
          console.log();
        }
      }
      db.close();
      break;
    }

    case "status": {
      const dir = getDir(1);
      const db = new RagDB(dir);
      const status = db.getStatus();
      console.log(`Index status for ${dir}:`);
      console.log(`  Files:        ${status.totalFiles}`);
      console.log(`  Chunks:       ${status.totalChunks}`);
      console.log(`  Last indexed: ${status.lastIndexed || "never"}`);
      db.close();
      break;
    }

    case "remove": {
      const file = args[1];
      if (!file) {
        console.error("Usage: local-rag remove <file> [dir]");
        process.exit(1);
      }
      const dir = getDir(2);
      const db = new RagDB(dir);
      const removed = db.removeFile(resolve(file));
      console.log(removed ? `Removed ${file}` : `${file} was not in the index`);
      db.close();
      break;
    }

    case "analytics": {
      const dir = getDir(1);
      const days = parseInt(getFlag("--days") || "30", 10);
      const db = new RagDB(dir);
      const analytics = db.getAnalytics(days);

      const zeroCount = analytics.zeroResultQueries.reduce((s, q) => s + q.count, 0);
      const zeroRate = analytics.totalQueries > 0
        ? ((zeroCount / analytics.totalQueries) * 100).toFixed(0)
        : "0";

      console.log(`Search analytics (last ${days} days):`);
      console.log(`  Total queries:    ${analytics.totalQueries}`);
      console.log(`  Avg results:      ${analytics.avgResultCount.toFixed(1)}`);
      console.log(`  Avg top score:    ${analytics.avgTopScore?.toFixed(2) ?? "n/a"}`);
      console.log(`  Zero-result rate: ${zeroRate}% (${zeroCount} queries)`);

      if (analytics.topSearchedTerms.length > 0) {
        console.log("\nTop searches:");
        for (const t of analytics.topSearchedTerms) {
          console.log(`  ${t.count}× "${t.query}"`);
        }
      }

      if (analytics.zeroResultQueries.length > 0) {
        console.log("\nZero-result queries (consider indexing these topics):");
        for (const q of analytics.zeroResultQueries) {
          console.log(`  ${q.count}× "${q.query}"`);
        }
      }

      if (analytics.lowScoreQueries.length > 0) {
        console.log("\nLow-relevance queries (top score < 0.3):");
        for (const q of analytics.lowScoreQueries) {
          console.log(`  "${q.query}" (score: ${q.topScore.toFixed(2)})`);
        }
      }

      db.close();
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      usage();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
