/**
 * Research-Karte (Abend 14), reine Logik. Die Karte zeigt GitHub-Repos aus mehreren Suchen
 * (GitHub Search API ohne Token). Der Zwischenspeicher hält je Suche einen Abschnitt, dazu die Liste
 * der abgehakten IDs (`seen`); „neu“ ist ein Treffer, solange seine ID nicht in `seen` steht.
 * Zeitstempel überall in Millisekunden (Date.now()). Das Feld `pushed_at` ist laut GitHub-Doku der letzte Commit-Push.
 */

export type ResearchSort = "stars" | "updated";
export interface ResearchSearch { query: string; sort: ResearchSort; count: number }
export interface SearchParse { searches: ResearchSearch[]; errors: Array<{ line: number; reason: string }> }

export interface RepoItem {
  id: number;
  full_name: string;
  html_url: string;
  stargazers_count: number;
  description: string;
  pushed_at: string;
}

export interface ResearchSection {
  query: string;
  sort: ResearchSort;
  count: number;
  fetched_at: number | null;
  items: RepoItem[];
  error?: string;
}
export interface ResearchCache { fetched_at: number | null; sections: ResearchSection[]; seen: number[] }
export type FetchOutcome = { ok: true; items: RepoItem[] } | { ok: false; error: string };

const MIN_COUNT = 1;
const MAX_COUNT = 30;
const MAX_LINE = 120;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isSort = (v: unknown): v is ResearchSort => v === "stars" || v === "updated";
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= MIN_COUNT && v <= MAX_COUNT;
const isId = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

/** Eine Suche je Zeile: `<anfrage> | <sort> | <anzahl>`. Fehler einer Zeile blockieren die anderen nicht. */
export function parseSearches(text: string): SearchParse {
  const searches: ResearchSearch[] = [];
  const errors: Array<{ line: number; reason: string }> = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    if (raw.trim() === "") return;
    const line = i + 1;
    const fail = (reason: string) => errors.push({ line, reason });
    const parts = raw.split("|").map((p) => p.trim());
    if (parts.length !== 3) return fail("erwartet: anfrage | sort | anzahl");
    const [query, sort, count] = parts;
    if (query === "") return fail("Anfrage ist leer");
    if (!isSort(sort)) return fail("Sortierung muss stars oder updated sein");
    const n = /^\d+$/.test(count) ? Number(count) : NaN;
    if (!isCount(n)) return fail(`Anzahl muss eine ganze Zahl von ${MIN_COUNT} bis ${MAX_COUNT} sein`);
    searches.push({ query, sort, count: n });
  });
  return { searches, errors };
}

/** Identität einer Suche. */
export function searchKey(s: ResearchSearch): string {
  return `${s.query}|${s.sort}|${s.count}`;
}

export function searchUrl(s: ResearchSearch): string {
  return `https://api.github.com/search/repositories?q=${encodeURIComponent(s.query)}&sort=${s.sort}&order=desc&per_page=${s.count}`;
}

/** Ein Treffer, nur die sechs Felder; null, wenn id, full_name oder html_url fehlen. */
function toRepoItem(v: unknown): RepoItem | null {
  if (!isObject(v)) return null;
  if (!isId(v.id) || typeof v.full_name !== "string" || typeof v.html_url !== "string") return null;
  return {
    id: v.id,
    full_name: v.full_name,
    html_url: v.html_url,
    stargazers_count: finite(v.stargazers_count) ? v.stargazers_count : 0,
    description: typeof v.description === "string" ? v.description : "",
    pushed_at: typeof v.pushed_at === "string" ? v.pushed_at : "",
  };
}

const toItems = (v: unknown): RepoItem[] =>
  Array.isArray(v) ? v.map(toRepoItem).filter((i): i is RepoItem => i !== null) : [];

/** null bei kaputtem JSON, Nicht-Objekt oder fehlendem `items`-Array. */
export function parseSearchResponse(text: string): RepoItem[] | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(raw) || !Array.isArray(raw.items)) return null;
  return toItems(raw.items);
}

function header(headers: Record<string, string>, name: string): string | undefined {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key === undefined ? undefined : headers[key];
}

function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Fehlertext für die Karte: Limit mit Uhrzeit, ungültige Suche, sonst Status plus erste Zeile. */
export function describeFailure(status: number, headers: Record<string, string>, text: string, nowMs: number): string {
  if (status === 403 || status === 429) {
    const reset = Number(header(headers, "x-ratelimit-reset"));
    if (header(headers, "x-ratelimit-remaining") === "0" && header(headers, "x-ratelimit-reset") !== undefined
      && Number.isFinite(reset)) {
      return `GitHub-Limit erreicht, wieder ab ${clock(reset * 1000)}`;
    }
    const retryRaw = header(headers, "retry-after");
    const retry = retryRaw === undefined || retryRaw.trim() === "" ? NaN : Number(retryRaw);
    if (Number.isFinite(retry)) return `GitHub-Limit erreicht, wieder ab ${clock(nowMs + retry * 1000)}`;
  }
  let message: string | null = null;
  try {
    const raw: unknown = JSON.parse(text);
    if (isObject(raw) && typeof raw.message === "string" && raw.message !== "") message = raw.message;
  } catch {
    // kein JSON: erste Zeile des Textes
  }
  if (status === 422) return message === null ? "Suche ungültig" : `Suche ungültig: ${message}`;
  const first = message ?? text.split(/\r?\n/).map((l) => l.trim()).find((l) => l !== "") ?? "";
  return first === "" ? `HTTP ${status}` : `HTTP ${status}: ${first.slice(0, MAX_LINE)}`;
}

export function emptyResearchCache(): ResearchCache {
  return { fetched_at: null, sections: [], seen: [] };
}

function toSection(v: unknown): ResearchSection | null {
  if (!isObject(v)) return null;
  if (typeof v.query !== "string" || v.query === "" || !isSort(v.sort) || !isCount(v.count)) return null;
  const section: ResearchSection = {
    query: v.query,
    sort: v.sort,
    count: v.count,
    fetched_at: finite(v.fetched_at) ? v.fetched_at : null,
    items: toItems(v.items),
  };
  if (typeof v.error === "string") section.error = v.error;
  return section;
}

/** Tolerant, wirft nie: kaputt oder fremd ergibt den leeren Cache, Felder einzeln. */
export function parseResearchCache(text: string | null): ResearchCache {
  if (text === null || text.trim() === "") return emptyResearchCache();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return emptyResearchCache();
  }
  if (!isObject(raw)) return emptyResearchCache();
  const sections = Array.isArray(raw.sections)
    ? raw.sections.map(toSection).filter((s): s is ResearchSection => s !== null)
    : [];
  const seen = Array.isArray(raw.seen) ? [...new Set(raw.seen.filter(isId))] : [];
  return { fetched_at: finite(raw.fetched_at) ? raw.fetched_at : null, sections, seen };
}

export function serializeResearchCache(c: ResearchCache): string {
  return JSON.stringify(c, null, 2) + "\n";
}

/** Einmal vor einem Lauf auswerten und an jedes `mergeSection` des Laufs geben. */
export function isFirstRun(c: ResearchCache): boolean {
  return c.seen.length === 0 && c.sections.every((s) => s.items.length === 0);
}

/** Ersetzt oder hängt den Abschnitt der Suche an. Fehler behalten alte Treffer und Zeitstempel. */
export function mergeSection(c: ResearchCache, s: ResearchSearch, r: FetchOutcome, nowMs: number, firstRun: boolean): ResearchCache {
  const key = searchKey(s);
  const index = c.sections.findIndex((x) => searchKey(x) === key);
  const old = index >= 0 ? c.sections[index] : undefined;
  let section: ResearchSection;
  let fetchedAt = c.fetched_at;
  let seen = c.seen;
  if (r.ok) {
    section = { query: s.query, sort: s.sort, count: s.count, fetched_at: nowMs, items: r.items.map((i) => ({ ...i })) };
    fetchedAt = nowMs;
    if (firstRun) seen = [...new Set([...c.seen, ...r.items.map((i) => i.id)])];
  } else {
    section = {
      query: s.query, sort: s.sort, count: s.count,
      fetched_at: old ? old.fetched_at : null,
      items: old ? old.items.map((i) => ({ ...i })) : [],
      error: r.error,
    };
  }
  const sections = c.sections.slice();
  if (index >= 0) sections[index] = section;
  else sections.push(section);
  return { fetched_at: fetchedAt, sections, seen: seen.slice() };
}

/** Genau an der Grenze gilt als veraltet. */
export function isStale(fetchedAt: number | null, nowMs: number, maxAgeMin: number): boolean {
  return fetchedAt === null || nowMs - fetchedAt >= maxAgeMin * 60000;
}

/** Fällig: ohne Abschnitt, mit Fehler oder veraltet; `force` nimmt alle. Reihenfolge wie `searches`. */
export function dueSearches(c: ResearchCache, searches: ResearchSearch[], nowMs: number, maxAgeMin: number, force: boolean): ResearchSearch[] {
  if (force) return searches.slice();
  return searches.filter((s) => {
    const key = searchKey(s);
    const section = c.sections.find((x) => searchKey(x) === key);
    return !section || section.error !== undefined || isStale(section.fetched_at, nowMs, maxAgeMin);
  });
}

/** Nur Abschnitte zu bestehenden Suchen, in deren Reihenfolge; `seen` und `fetched_at` bleiben. */
export function pruneSections(c: ResearchCache, searches: ResearchSearch[]): ResearchCache {
  const sections: ResearchSection[] = [];
  for (const s of searches) {
    const key = searchKey(s);
    const found = c.sections.find((x) => searchKey(x) === key);
    if (found && !sections.includes(found)) sections.push(found);
  }
  return { fetched_at: c.fetched_at, sections, seen: c.seen.slice() };
}

/** IDs aller Treffer aller Abschnitte, die nicht abgehakt sind. */
export function newIds(c: ResearchCache): Set<number> {
  const seen = new Set(c.seen);
  const out = new Set<number>();
  for (const s of c.sections) for (const i of s.items) if (!seen.has(i.id)) out.add(i.id);
  return out;
}

export function markSeen(c: ResearchCache, id: number): ResearchCache {
  return { ...c, sections: c.sections.slice(), seen: c.seen.includes(id) ? c.seen.slice() : [...c.seen, id] };
}

/** Nur https://github.com/<pfad>; alles andere null. */
export function safeRepoUrl(url: unknown): string | null {
  if (typeof url !== "string" || !url.startsWith("https://github.com/")) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.hostname !== "github.com" || u.pathname === "/" || u.pathname === "") return null;
    return u.href;
  } catch {
    return null;
  }
}
