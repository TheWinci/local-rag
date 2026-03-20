import { Database } from "bun:sqlite";
import { type EmbeddedChunk } from "../types";
import { type StoredFile } from "./types";

export function getFileByPath(db: Database, path: string): StoredFile | null {
  return db
    .query<StoredFile, [string]>("SELECT * FROM files WHERE path = ?")
    .get(path);
}

export function upsertFileStart(db: Database, path: string, hash: string): number {
  const existing = getFileByPath(db, path);
  if (existing) {
    const deleteTx = db.transaction(() => {
      const oldChunks = db
        .query<{ id: number }, [number]>("SELECT id FROM chunks WHERE file_id = ?")
        .all(existing.id);
      for (const c of oldChunks) {
        db.run("DELETE FROM vec_chunks WHERE chunk_id = ?", [c.id]);
      }
      db.run("DELETE FROM chunks WHERE file_id = ?", [existing.id]);
      db.run("DELETE FROM files WHERE id = ?", [existing.id]);
    });
    deleteTx();
  }

  db.run(
    "INSERT INTO files (path, hash, indexed_at) VALUES (?, ?, ?)",
    [path, hash, new Date().toISOString()]
  );
  return Number(
    db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!.id
  );
}

export function insertChunkBatch(
  db: Database,
  fileId: number,
  chunks: EmbeddedChunk[],
  startIndex: number
) {
  const tx = db.transaction(() => {
    for (let i = 0; i < chunks.length; i++) {
      const { snippet, embedding, entityName, chunkType, startLine, endLine } = chunks[i];
      db.run(
        "INSERT INTO chunks (file_id, chunk_index, snippet, entity_name, chunk_type, start_line, end_line) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [fileId, startIndex + i, snippet, entityName ?? null, chunkType ?? null, startLine ?? null, endLine ?? null]
      );
      const chunkId = Number(
        db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!.id
      );
      db.run(
        "INSERT INTO vec_chunks (chunk_id, embedding) VALUES (?, ?)",
        [chunkId, new Uint8Array(embedding.buffer)]
      );
    }
  });
  tx();
}

export function upsertFile(
  db: Database,
  path: string,
  hash: string,
  chunks: EmbeddedChunk[]
) {
  const fileId = upsertFileStart(db, path, hash);
  insertChunkBatch(db, fileId, chunks, 0);
}

export function removeFile(db: Database, path: string): boolean {
  const existing = getFileByPath(db, path);
  if (!existing) return false;

  const tx = db.transaction(() => {
    const oldChunks = db
      .query<{ id: number }, [number]>("SELECT id FROM chunks WHERE file_id = ?")
      .all(existing.id);
    for (const c of oldChunks) {
      db.run("DELETE FROM vec_chunks WHERE chunk_id = ?", [c.id]);
    }
    db.run("DELETE FROM chunks WHERE file_id = ?", [existing.id]);
    db.run("DELETE FROM files WHERE id = ?", [existing.id]);
  });

  tx();
  return true;
}

export function pruneDeleted(db: Database, existingPaths: Set<string>): number {
  const allFiles = db
    .query<{ id: number; path: string }, []>("SELECT id, path FROM files")
    .all();

  let pruned = 0;
  for (const file of allFiles) {
    if (!existingPaths.has(file.path)) {
      removeFile(db, file.path);
      pruned++;
    }
  }
  return pruned;
}

export function getAllFilePaths(db: Database): { id: number; path: string }[] {
  return db
    .query<{ id: number; path: string }, []>("SELECT id, path FROM files")
    .all();
}

export function getStatus(db: Database): { totalFiles: number; totalChunks: number; lastIndexed: string | null } {
  const files = db
    .query<{ count: number }, []>("SELECT COUNT(*) as count FROM files")
    .get()!;
  const chunks = db
    .query<{ count: number }, []>("SELECT COUNT(*) as count FROM chunks")
    .get()!;
  const last = db
    .query<{ indexed_at: string }, []>(
      "SELECT indexed_at FROM files ORDER BY indexed_at DESC LIMIT 1"
    )
    .get();

  return {
    totalFiles: files.count,
    totalChunks: chunks.count,
    lastIndexed: last?.indexed_at ?? null,
  };
}
