import { splitFrontmatter } from "./frontmatter";

const DAY_MS = 24 * 60 * 60 * 1000;
const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

/** Lokales Datum JJJJ-MM-TT; „heute“ ist im Cockpit immer das lokale Datum. */
export function localDayKey(t: Date | number): string {
  const d = typeof t === "number" ? new Date(t) : t;
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Name der Daily Note des lokalen Tages: JJJJ-MM-TT.md. */
export function dailyNoteName(now: Date): string {
  return `${localDayKey(now)}.md`;
}

/** Gibt es die Daily Note von heute in der Namensliste des Ordners (genauer Name, keine Unterpfade)? */
export function hasDailyNote(names: string[], now: Date): boolean {
  const wanted = dailyNoteName(now);
  return names.includes(wanted);
}

const GENERATED_AT = /^generated_at[ \t]*:[ \t]*(.*?)[ \t]*$/;
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/** Wert ohne Zeitzone als lokale Zeit mit echter Kalenderprüfung (kein Überlauf wie 30. Februar), mit Zeitzone absolut. */
function parseStamp(value: string): Date | null {
  const m = LOCAL.exec(value);
  if (!m) {
    if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?[ ]?(Z|[+-]\d{2}:?\d{2})$/.test(value)) return null;
    const t = Date.parse(value.replace(" ", "T").replace(/ (?=Z|[+-])/, ""));
    return Number.isNaN(t) ? null : new Date(t);
  }
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4] ?? "0", m[5] ?? "0", m[6] ?? "0"].map(Number);
  const date = new Date(y, mo - 1, d, h, mi, s);
  const ok = date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d && date.getHours() === h && date.getMinutes() === mi && date.getSeconds() === s;
  return ok ? date : null;
}

/** `generated_at` aus dem Frontmatter der Index-Datei; kein oder kaputtes Frontmatter, fehlendes Feld, unbrauchbarer Wert: null. */
export function parseGeneratedAt(indexText: string): Date | null {
  const { frontmatter } = splitFrontmatter(indexText);
  if (frontmatter === null) return null;
  for (const line of frontmatter.split("\n")) {
    const m = GENERATED_AT.exec(line);
    if (!m) continue;
    return parseStamp(m[1].replace(/^(["'])(.*)\1$/, "$2").trim());
  }
  return null;
}

/** Volle Tage seit `generatedAt` (abgerundet); liegt der Stand in der Zukunft: 0. */
export function indexAgeDays(generatedAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - generatedAt.getTime()) / DAY_MS));
}

/** Gelb ab `lintAfterDays` Tagen (die Grenze selbst zählt schon). */
export function indexStale(ageDays: number, lintAfterDays: number): boolean {
  return ageDays >= lintAfterDays;
}

/** Notizen im Inbox-Ordner: nur .md, keine versteckten Dateien, nur direkte Kinder (die Liste kommt aus dem Ordner). */
export function countInboxNotes(names: string[]): number {
  return names.filter((n) => !n.includes("/") && !n.startsWith(".") && /\.md$/i.test(n)).length;
}
