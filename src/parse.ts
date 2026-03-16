import matter from "gray-matter";
import { readFile } from "fs/promises";
import { extname } from "path";

export interface ParsedFile {
  path: string;
  content: string;
  frontmatter: Record<string, unknown> | null;
  extension: string;
}

const MARKDOWN_EXTENSIONS = new Set([".md", ".mdx", ".markdown"]);

export async function parseFile(filePath: string): Promise<ParsedFile> {
  const raw = await readFile(filePath, "utf-8");
  const ext = extname(filePath).toLowerCase();

  if (MARKDOWN_EXTENSIONS.has(ext)) {
    const { data, content } = matter(raw);
    const hasFrontmatter = Object.keys(data).length > 0;
    return {
      path: filePath,
      content: hasFrontmatter
        ? buildWeightedText(data, content)
        : content.trim(),
      frontmatter: hasFrontmatter ? data : null,
      extension: ext,
    };
  }

  return {
    path: filePath,
    content: raw.trim(),
    frontmatter: null,
    extension: ext,
  };
}

function buildWeightedText(
  frontmatter: Record<string, unknown>,
  body: string
): string {
  const parts: string[] = [];

  if (frontmatter.name) parts.push(`${frontmatter.name}`);
  if (frontmatter.description)
    parts.push(`description: ${frontmatter.description}`);
  if (frontmatter.type) parts.push(`type: ${frontmatter.type}`);
  if (frontmatter.tags) {
    const tags = Array.isArray(frontmatter.tags)
      ? frontmatter.tags.join(", ")
      : frontmatter.tags;
    parts.push(`tags: ${tags}`);
  }

  if (body.trim()) parts.push(body.trim());

  return parts.join("\n");
}
