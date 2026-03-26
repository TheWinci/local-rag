import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type GetDB, resolveProject } from "./index";
import { getModelId, getEmbeddingDim } from "../embeddings/embed";

export function registerServerInfoTools(server: McpServer, getDB: GetDB) {
  server.tool(
    "server_info",
    "Show the current MCP server configuration: resolved project directory, database location, index status, embedding model, and active config from .rag/config.json.",
    {
      directory: z
        .string()
        .optional()
        .describe("Project directory. Defaults to RAG_PROJECT_DIR env or cwd"),
    },
    async ({ directory }) => {
      const { projectDir, db: ragDb, config } = await resolveProject(directory, getDB);
      const status = ragDb.getStatus();

      const lines: string[] = [
        "## Server",
        `  version:     ${(await import("../../package.json")).version}`,
        `  project_dir: ${projectDir}`,
        `  db_dir:      ${process.env.RAG_DB_DIR || `${projectDir}/.rag`}`,
        `  log_level:   ${process.env.LOG_LEVEL || "warn"}`,
        "",
        "## Index",
        `  files:        ${status.totalFiles}`,
        `  chunks:       ${status.totalChunks}`,
        `  last_indexed: ${status.lastIndexed ?? "never"}`,
        "",
        "## Embedding",
        `  model: ${getModelId()}`,
        `  dim:   ${getEmbeddingDim()}`,
        "",
        "## Config (.rag/config.json)",
        `  chunk_size:      ${config.chunkSize}`,
        `  chunk_overlap:   ${config.chunkOverlap}`,
        `  hybrid_weight:   ${config.hybridWeight}`,
        `  search_top_k:    ${config.searchTopK}`,
        `  reranking:       ${config.enableReranking}`,
        `  incremental:     ${config.incrementalChunks}`,
        `  include:         ${config.include.length} patterns`,
        `  exclude:         ${config.exclude.length} patterns`,
      ];

      if (config.indexBatchSize) lines.push(`  index_batch:     ${config.indexBatchSize}`);
      if (config.indexThreads) lines.push(`  index_threads:   ${config.indexThreads}`);

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );
}
