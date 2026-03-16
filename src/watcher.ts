import { watch, type FSWatcher } from "fs";
import { resolve, relative } from "path";
import { existsSync } from "fs";
import { Glob } from "bun";
import { indexFile } from "./indexer";
import { type RagConfig } from "./config";
import { type RagDB } from "./db";

const DEBOUNCE_MS = 2000;

function matchesAny(filePath: string, patterns: string[]): boolean {
  return patterns.some((pat) => new Glob(pat).match(filePath));
}

export function startWatcher(
  directory: string,
  db: RagDB,
  config: RagConfig,
  onEvent?: (msg: string) => void
): FSWatcher {
  const pending = new Map<string, NodeJS.Timeout>();

  const watcher = watch(directory, { recursive: true }, (_event, filename) => {
    if (!filename) return;

    const rel = filename.toString();

    // Skip excluded paths
    if (matchesAny(rel, config.exclude)) return;

    // Only process files matching include patterns
    if (!matchesAny(rel, config.include)) return;

    const absPath = resolve(directory, rel);

    // Debounce: reset timer if same file changes again within window
    const existing = pending.get(absPath);
    if (existing) clearTimeout(existing);

    pending.set(
      absPath,
      setTimeout(async () => {
        pending.delete(absPath);

        if (!existsSync(absPath)) {
          // File was deleted
          const removed = db.removeFile(absPath);
          if (removed) {
            onEvent?.(`Removed deleted file: ${rel}`);
          }
          return;
        }

        const result = await indexFile(absPath, db, config);
        if (result === "indexed") {
          onEvent?.(`Re-indexed: ${rel}`);
        }
      }, DEBOUNCE_MS)
    );
  });

  onEvent?.(`Watching ${directory} for changes`);
  return watcher;
}
