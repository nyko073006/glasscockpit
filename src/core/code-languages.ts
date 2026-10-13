// Sprache je Datei für den Datei-Viewer (Abend 32): zehn Sprachen aus den eigenen Repos (Zählung über git ls-files am 12.10.2026).
// Rein, ohne CodeMirror; Modi, Farben und Vorschläge hängt src/host/code-editor.ts an.

export const LANGUAGE_IDS = ["typescript", "javascript", "json", "swift", "css", "python", "yaml", "sql", "html", "shell"] as const;
export type LanguageId = (typeof LANGUAGE_IDS)[number];

// TSX und JSX haben keine eigene ID: legacy-modes kennt kein JSX, TSX läuft als typescript, JSX als javascript.
// Map statt Objekt, damit Endungen wie "constructor" nicht auf den Prototyp treffen.
const BY_EXTENSION = new Map<string, LanguageId>([
  ["ts", "typescript"], ["mts", "typescript"], ["cts", "typescript"], ["tsx", "typescript"],
  ["js", "javascript"], ["mjs", "javascript"], ["cjs", "javascript"], ["jsx", "javascript"],
  ["json", "json"], ["swift", "swift"], ["css", "css"], ["py", "python"], ["yml", "yaml"], ["yaml", "yaml"], ["sql", "sql"],
  ["html", "html"], ["htm", "html"], ["sh", "shell"], ["bash", "shell"], ["zsh", "shell"],
]);

/**
 * Sprache aus der Endung des letzten Pfadteils, ohne Rücksicht auf Groß-/Kleinschreibung. Ohne Endung und bei Punktdateien ohne
 * weitere Endung (.gitignore) null; .eslintrc.json zählt als json.
 */
export function languageForPath(path: string): LanguageId | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  return BY_EXTENSION.get(name.slice(dot + 1).toLowerCase()) ?? null;
}

const words = (list: string): readonly string[] => list.split(" ");
const JS = "if else for while do switch case default break continue return function var let const new delete typeof instanceof in of try catch finally throw class extends super this import export async await yield true false null undefined";

/** Schlüsselwörter je Sprache für die Vorschläge; jedes Wort steht in der jeweiligen legacy-mode-Datei (Test). */
export const KEYWORDS: Record<LanguageId, readonly string[]> = {
  typescript: words(`${JS} interface type enum implements namespace declare abstract readonly keyof private protected public static as`),
  javascript: words(JS),
  json: words("true false null"),
  swift: words("var let func class struct enum protocol extension import init deinit self super return if else guard switch case default for in while repeat break continue defer do try catch throw throws async await public private fileprivate internal open static final override mutating weak lazy where as is nil true false typealias actor nonisolated"),
  css: words("important inherit initial unset none auto flex grid block inline-block absolute relative fixed solid transparent bold center hidden pointer media keyframes import supports"),
  python: words("False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield self print len range"),
  yaml: words("true false yes no on off"),
  sql: words("select from where and or not insert into values update set delete create table drop alter join left inner on group by order having limit as distinct null primary key index default references"),
  html: words("html div p ul ol li table tr td th tbody form input img br hr link meta style section article header footer nav aside pre h1 h2 h3 option"),
  shell: words("if then else elif fi for while until do done in function export set unset exit true false echo cd ls grep sed awk git npm node mkdir rm cp mv cat source"),
};
