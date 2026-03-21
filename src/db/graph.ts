import { Database } from "bun:sqlite";

export function upsertFileGraph(
  db: Database,
  fileId: number,
  imports: { name: string; source: string }[],
  exports: { name: string; type: string }[]
) {
  const tx = db.transaction(() => {
    db.run("DELETE FROM file_imports WHERE file_id = ?", [fileId]);
    db.run("DELETE FROM file_exports WHERE file_id = ?", [fileId]);

    for (const imp of imports) {
      db.run(
        "INSERT INTO file_imports (file_id, source, names) VALUES (?, ?, ?)",
        [fileId, imp.source, imp.name]
      );
    }

    for (const exp of exports) {
      db.run(
        "INSERT INTO file_exports (file_id, name, type) VALUES (?, ?, ?)",
        [fileId, exp.name, exp.type]
      );
    }
  });
  tx();
}

export function resolveImport(db: Database, importId: number, resolvedFileId: number) {
  db.run(
    "UPDATE file_imports SET resolved_file_id = ? WHERE id = ?",
    [resolvedFileId, importId]
  );
}

export function getUnresolvedImports(db: Database): { id: number; fileId: number; filePath: string; source: string }[] {
  return db
    .query<{ id: number; file_id: number; path: string; source: string }, []>(
      `SELECT fi.id, fi.file_id, f.path, fi.source
       FROM file_imports fi
       JOIN files f ON f.id = fi.file_id
       WHERE fi.resolved_file_id IS NULL`
    )
    .all()
    .map((r) => ({ id: r.id, fileId: r.file_id, filePath: r.path, source: r.source }));
}

export function getGraph(db: Database): {
  nodes: { id: number; path: string; exports: { name: string; type: string }[] }[];
  edges: { fromId: number; fromPath: string; toId: number; toPath: string; source: string }[];
} {
  const files = db
    .query<{ id: number; path: string }, []>("SELECT id, path FROM files")
    .all();

  // Batch-load all exports in one query instead of per-file
  const allExports = db
    .query<{ file_id: number; name: string; type: string }, []>(
      "SELECT file_id, name, type FROM file_exports"
    )
    .all();

  const exportsByFile = new Map<number, { name: string; type: string }[]>();
  for (const exp of allExports) {
    let arr = exportsByFile.get(exp.file_id);
    if (!arr) {
      arr = [];
      exportsByFile.set(exp.file_id, arr);
    }
    arr.push({ name: exp.name, type: exp.type });
  }

  const nodes = files.map((f) => ({
    id: f.id,
    path: f.path,
    exports: exportsByFile.get(f.id) || [],
  }));

  const edges = db
    .query<
      { file_id: number; from_path: string; resolved_file_id: number; to_path: string; source: string },
      []
    >(
      `SELECT fi.file_id, f1.path as from_path, fi.resolved_file_id, f2.path as to_path, fi.source
       FROM file_imports fi
       JOIN files f1 ON f1.id = fi.file_id
       JOIN files f2 ON f2.id = fi.resolved_file_id
       WHERE fi.resolved_file_id IS NOT NULL`
    )
    .all()
    .map((r) => ({
      fromId: r.file_id,
      fromPath: r.from_path,
      toId: r.resolved_file_id,
      toPath: r.to_path,
      source: r.source,
    }));

  return { nodes, edges };
}

export function getSubgraph(db: Database, fileIds: number[], maxHops: number = 2): {
  nodes: { id: number; path: string; exports: { name: string; type: string }[] }[];
  edges: { fromId: number; fromPath: string; toId: number; toPath: string; source: string }[];
} {
  // BFS via SQL queries per hop instead of loading the full graph
  const visited = new Set<number>(fileIds);
  let frontier = [...fileIds];

  for (let hop = 0; hop < maxHops && frontier.length > 0; hop++) {
    const placeholders = frontier.map(() => "?").join(",");
    const neighbors = db
      .query<{ file_id: number; resolved_file_id: number }, number[]>(
        `SELECT file_id, resolved_file_id FROM file_imports
         WHERE resolved_file_id IS NOT NULL
         AND (file_id IN (${placeholders}) OR resolved_file_id IN (${placeholders}))`
      )
      .all(...frontier, ...frontier);

    const nextFrontier: number[] = [];
    for (const row of neighbors) {
      if (!visited.has(row.file_id)) {
        visited.add(row.file_id);
        nextFrontier.push(row.file_id);
      }
      if (!visited.has(row.resolved_file_id)) {
        visited.add(row.resolved_file_id);
        nextFrontier.push(row.resolved_file_id);
      }
    }
    frontier = nextFrontier;
  }

  // Load only the nodes and edges for visited file IDs
  const idList = [...visited];
  const ph = idList.map(() => "?").join(",");

  const files = db
    .query<{ id: number; path: string }, number[]>(
      `SELECT id, path FROM files WHERE id IN (${ph})`
    )
    .all(...idList);

  const allExports = db
    .query<{ file_id: number; name: string; type: string }, number[]>(
      `SELECT file_id, name, type FROM file_exports WHERE file_id IN (${ph})`
    )
    .all(...idList);

  const exportsByFile = new Map<number, { name: string; type: string }[]>();
  for (const exp of allExports) {
    let arr = exportsByFile.get(exp.file_id);
    if (!arr) { arr = []; exportsByFile.set(exp.file_id, arr); }
    arr.push({ name: exp.name, type: exp.type });
  }

  const nodes = files.map((f) => ({
    id: f.id,
    path: f.path,
    exports: exportsByFile.get(f.id) || [],
  }));

  const edges = db
    .query<
      { file_id: number; from_path: string; resolved_file_id: number; to_path: string; source: string },
      number[]
    >(
      `SELECT fi.file_id, f1.path as from_path, fi.resolved_file_id, f2.path as to_path, fi.source
       FROM file_imports fi
       JOIN files f1 ON f1.id = fi.file_id
       JOIN files f2 ON f2.id = fi.resolved_file_id
       WHERE fi.resolved_file_id IS NOT NULL
       AND fi.file_id IN (${ph}) AND fi.resolved_file_id IN (${ph})`
    )
    .all(...idList, ...idList)
    .map((r) => ({
      fromId: r.file_id,
      fromPath: r.from_path,
      toId: r.resolved_file_id,
      toPath: r.to_path,
      source: r.source,
    }));

  return { nodes, edges };
}

export function getImportsForFile(db: Database, fileId: number): { id: number; source: string; resolvedFileId: number | null }[] {
  return db
    .query<{ id: number; source: string; resolved_file_id: number | null }, [number]>(
      "SELECT id, source, resolved_file_id FROM file_imports WHERE file_id = ?"
    )
    .all(fileId)
    .map((r) => ({ id: r.id, source: r.source, resolvedFileId: r.resolved_file_id }));
}

export function getImportersOf(db: Database, fileId: number): number[] {
  return db
    .query<{ file_id: number }, [number]>(
      "SELECT file_id FROM file_imports WHERE resolved_file_id = ?"
    )
    .all(fileId)
    .map((r) => r.file_id);
}

/** Get resolved dependency paths for a file (what it imports). */
export function getDependsOn(db: Database, fileId: number): { path: string; source: string }[] {
  return db
    .query<{ path: string; source: string }, [number]>(
      `SELECT f.path, fi.source
       FROM file_imports fi
       JOIN files f ON f.id = fi.resolved_file_id
       WHERE fi.file_id = ? AND fi.resolved_file_id IS NOT NULL`
    )
    .all(fileId);
}

/** Get files that import a given file (reverse dependencies). */
export function getDependedOnBy(db: Database, fileId: number): { path: string; source: string }[] {
  return db
    .query<{ path: string; source: string }, [number]>(
      `SELECT f.path, fi.source
       FROM file_imports fi
       JOIN files f ON f.id = fi.file_id
       WHERE fi.resolved_file_id = ?`
    )
    .all(fileId);
}
