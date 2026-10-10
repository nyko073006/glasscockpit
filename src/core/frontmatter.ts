export type YamlParse = (text: string) => unknown;

/** Frontmatter nur, wenn die erste Zeile genau `---` ist und eine spätere Zeile genau `---` schließt. */
export function splitFrontmatter(text: string): { frontmatter: string | null; body: string } {
  const full = text.startsWith("﻿") ? text.slice(1) : text;
  const lines = full.split("\n");
  const strip = (line: string) => (line.endsWith("\r") ? line.slice(0, -1) : line);
  if (strip(lines[0]) !== "---") return { frontmatter: null, body: full };
  for (let i = 1; i < lines.length; i++) {
    if (strip(lines[i]) === "---") {
      return { frontmatter: lines.slice(1, i).map(strip).join("\n"), body: lines.slice(i + 1).join("\n") };
    }
  }
  return { frontmatter: null, body: full };
}

/** Felder als Strings: Strings getrimmt, Zahlen und Booleans als Text, der Rest entfällt. Das YAML parst `parse`. */
export function readFrontmatter(text: string, parse: YamlParse): { fields: Record<string, string>; body: string } {
  const { frontmatter, body } = splitFrontmatter(text);
  const fields: Record<string, string> = {};
  if (frontmatter === null) return { fields, body };
  let value: unknown;
  try {
    value = parse(frontmatter);
  } catch {
    return { fields, body };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { fields, body };
  for (const [key, v] of Object.entries(value)) {
    if (typeof v === "string") fields[key] = v.trim();
    else if (typeof v === "number" || typeof v === "boolean") fields[key] = String(v);
  }
  return { fields, body };
}
