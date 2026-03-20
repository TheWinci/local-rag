import { relative } from "path";
import { createHash } from "crypto";
import { readFile } from "fs/promises";
import { Glob } from "bun";
import { parseFile } from "./parse";
import { embedBatch } from "../embeddings/embed";
import { chunkText, KNOWN_EXTENSIONS, type ChunkImport, type ChunkExport } from "./chunker";
import { RagDB } from "../db";
import { type RagConfig } from "../config";
import { resolveImports } from "../graph/resolver";
import { log } from "../utils/log";
import { type EmbeddedChunk } from "../types";

function aggregateGraphData(chunks: { imports?: ChunkImport[]; exports?: ChunkExport[] }[]): {
  imports: { name: string; source: string }[];
  exports: { name: string; type: string }[];
} {
  const importMap = new Map<string, string>();
  const exportMap = new Map<string, string>();

  for (const chunk of chunks) {
    if (chunk.imports) {
      for (const imp of chunk.imports) {
        if (!importMap.has(imp.source)) {
          importMap.set(imp.source, imp.name);
        }
      }
    }
    if (chunk.exports) {
      for (const exp of chunk.exports) {
        if (!exportMap.has(exp.name)) {
          exportMap.set(exp.name, exp.type);
        }
      }
    }
  }

  return {
    imports: Array.from(importMap, ([source, name]) => ({ name, source })),
    exports: Array.from(exportMap, ([name, type]) => ({ name, type })),
  };
}

export interface IndexResult {
  indexed: number;
  skipped: number;
  pruned: number;
  errors: string[];
}

async function fileHash(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

function matchesAny(filePath: string, globs: Glob[]): boolean {
  return globs.some((g) => g.match(filePath));
}

async function collectFiles(
  directory: string,
  config: RagConfig,
  onWarning?: (msg: string) => void
): Promise<string[]> {
  const excludeGlobs = config.exclude.map((pat) => new Glob(pat));

  async function scanPattern(pattern: string): Promise<string[]> {
    const files: string[] = [];
    const glob = new Glob(pattern);
    try {
      for await (const file of glob.scan({ cwd: directory, absolute: true })) {
        const rel = relative(directory, file);
        if (!matchesAny(rel, excludeGlobs)) {
          files.push(file);
        }
      }
    } catch (err: any) {
      if (err.code === "EPERM" || err.code === "EACCES") {
        onWarning?.(`Skipping inaccessible path (${err.code}): ${err.path ?? pattern}`);
      } else {
        throw err;
      }
    }
    return files;
  }

  const results = await Promise.all(config.include.map(scanPattern));
  return [...new Set(results.flat())];
}

interface ProcessFileOptions {
  config: RagConfig;
  /** Base directory for relative path display */
  baseDir?: string;
  onProgress?: (msg: string, opts?: { transient?: boolean }) => void;
  signal?: AbortSignal;
}

/**
 * Shared file processing pipeline: hash → parse → chunk → embed → write to DB.
 * Streams DB writes alongside embedding to cap memory at one batch (~50 chunks)
 * instead of buffering all embeddings.
 */
async function processFile(
  filePath: string,
  db: RagDB,
  opts: ProcessFileOptions
): Promise<"indexed" | "skipped"> {
  const { config, baseDir, onProgress, signal } = opts;
  const batchSize = config.indexBatchSize ?? 50;

  const hash = await fileHash(filePath);
  const existing = db.getFileByPath(filePath);

  if (existing && existing.hash === hash) {
    return "skipped";
  }

  const relPath = baseDir ? relative(baseDir, filePath) : filePath;
  onProgress?.(`Indexing ${relPath}`);

  const parsed = await parseFile(filePath);

  if (!KNOWN_EXTENSIONS.has(parsed.extension)) {
    onProgress?.(`Skipped (unsupported extension "${parsed.extension}"): ${relPath}`);
    return "skipped";
  }

  if (!parsed.content.trim()) {
    return "skipped";
  }

  const chunks = await chunkText(
    parsed.content,
    parsed.extension,
    config.chunkSize,
    config.chunkOverlap,
    filePath
  );

  if (chunks.length > 10000) {
    log.warn(`Large file: ${relPath} produced ${chunks.length} chunks`, "indexer");
  }

  // Stream: embed each batch and write to DB immediately (caps memory at one batch)
  const DB_BATCH = 500;
  const fileId = db.upsertFileStart(filePath, hash);
  let chunkOffset = 0;
  let pendingDbChunks: EmbeddedChunk[] = [];

  for (let i = 0; i < chunks.length; i += batchSize) {
    if (signal?.aborted) break;

    const batch = chunks.slice(i, i + batchSize);
    const embeddings = await embedBatch(batch.map(c => c.text), config.indexThreads);

    for (let j = 0; j < batch.length; j++) {
      const chunk = batch[j];
      const primaryExport = chunk.exports?.[0];
      pendingDbChunks.push({
        snippet: chunk.text,
        embedding: embeddings[j],
        entityName: primaryExport?.name ?? null,
        chunkType: primaryExport?.type ?? null,
        startLine: chunk.startLine ?? null,
        endLine: chunk.endLine ?? null,
      });
    }

    // Flush to DB when we hit DB_BATCH size or on last iteration
    if (pendingDbChunks.length >= DB_BATCH || i + batchSize >= chunks.length) {
      if (signal?.aborted) break;
      db.insertChunkBatch(fileId, pendingDbChunks, chunkOffset);
      onProgress?.(`Writing ${Math.min(chunkOffset + pendingDbChunks.length, chunks.length)}/${chunks.length} chunks for ${relPath}`, { transient: true });
      chunkOffset += pendingDbChunks.length;
      pendingDbChunks = [];
      await Bun.sleep(0);
    }
  }

  if (signal?.aborted) return "skipped";

  // Store graph metadata
  const graphData = aggregateGraphData(chunks);
  db.upsertFileGraph(fileId, graphData.imports, graphData.exports);

  onProgress?.(`Indexed: ${relPath} (${chunks.length} chunks)`);
  return "indexed";
}

/**
 * Index a single file. Returns true if the file was re-indexed, false if skipped.
 */
export async function indexFile(
  filePath: string,
  db: RagDB,
  config: RagConfig
): Promise<"indexed" | "skipped" | "error"> {
  try {
    return await processFile(filePath, db, { config });
  } catch (err) {
    log.warn(`Failed to index ${filePath}: ${err instanceof Error ? err.message : err}`, "indexFile");
    return "error";
  }
}

export async function indexDirectory(
  directory: string,
  db: RagDB,
  config: RagConfig,
  onProgress?: (msg: string, opts?: { transient?: boolean }) => void,
  signal?: AbortSignal
): Promise<IndexResult> {
  const result: IndexResult = { indexed: 0, skipped: 0, pruned: 0, errors: [] };

  if (signal?.aborted) return result;

  const matchedFiles = await collectFiles(directory, config, onProgress);

  onProgress?.(`Found ${matchedFiles.length} files to index`);

  for (const filePath of matchedFiles) {
    if (signal?.aborted) break;

    try {
      const status = await processFile(filePath, db, {
        config,
        baseDir: directory,
        onProgress,
        signal,
      });

      if (status === "indexed") {
        result.indexed++;
      } else {
        result.skipped++;
      }
    } catch (err) {
      const msg = `Error indexing ${filePath}: ${err instanceof Error ? err.message : err}`;
      result.errors.push(msg);
      onProgress?.(msg);
    }
  }

  if (signal?.aborted) return result;

  // Prune files that no longer exist
  const existingPaths = new Set(matchedFiles);
  result.pruned = db.pruneDeleted(existingPaths);
  if (result.pruned > 0) {
    onProgress?.(`Pruned ${result.pruned} deleted files from index`);
  }

  // Resolve import paths across all files
  if (result.indexed > 0) {
    const resolved = resolveImports(db, directory);
    if (resolved > 0) {
      onProgress?.(`Resolved ${resolved} import paths`);
    }
  }

  return result;
}
