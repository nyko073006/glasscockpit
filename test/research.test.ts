import { describe, expect, it } from "vitest";
import {
  describeFailure, dueSearches, emptyResearchCache, isFirstRun, isStale, markSeen, mergeSection, newIds,
  parseResearchCache, parseSearchResponse, parseSearches, pruneSections, safeRepoUrl, searchKey, searchUrl,
  serializeResearchCache, type RepoItem, type ResearchCache, type ResearchSearch,
} from "../src/core/research";

const repo = (id: number, extra: Partial<RepoItem> = {}): RepoItem => ({
  id, full_name: `o/r${id}`, html_url: `https://github.com/o/r${id}`, stargazers_count: 10, description: "d", pushed_at: "2026-10-01T10:00:00Z", ...extra,
});
const S1: ResearchSearch = { query: "claude-code stars:>8", sort: "updated", count: 8 };
const S2: ResearchSearch = { query: "claude skill OR claude subagent stars:>5", sort: "stars", count: 8 };
const S3: ResearchSearch = { query: "claude-code OR claude-agent stars:>30", sort: "stars", count: 8 };
const S4: ResearchSearch = { query: "neu", sort: "stars", count: 5 };
const NOW = 1_800_000_000_000;
const ok = (...items: RepoItem[]) => ({ ok: true as const, items });

describe("parseSearches", () => {
  it("drei gültige Zeilen der Vorgabe", () => {
    const r = parseSearches("claude-code stars:>8 | updated | 8\nclaude skill OR claude subagent stars:>5 | stars | 8\nclaude-code OR claude-agent stars:>30 | stars | 8");
    expect(r.errors).toEqual([]);
    expect(r.searches).toEqual([S1, S2, S3]);
  });
  it("falsche Sortierung mit Zeilennummer, Grund ohne Nummer", () => {
    const r = parseSearches("test | beliebt | 8");
    expect(r.searches).toEqual([]);
    expect(r.errors).toEqual([{ line: 1, reason: "Sortierung muss stars oder updated sein" }]);
  });
  it("Anzahl 0 und 31 sind ungültig, 1 und 30 gültig", () => {
    const r = parseSearches("a | stars | 0\na | stars | 31\na | stars | 1\na | stars | 30\na | stars | 2.5\na | stars | x");
    expect(r.errors.map((e) => e.line)).toEqual([1, 2, 5, 6]);
    expect(r.searches.map((s) => s.count)).toEqual([1, 30]);
  });
  it("leere Zeilen zählen mit, Zeilennummer danach stimmt", () => {
    const r = parseSearches("a | stars | 3\n\n   \nkaputt\n");
    expect(r.searches).toHaveLength(1);
    expect(r.errors).toEqual([{ line: 4, reason: "erwartet: anfrage | sort | anzahl" }]);
  });
  it("CRLF wie LF", () => {
    const r = parseSearches("a | stars | 3\r\nb | updated | 4\r\n");
    expect(r.searches).toEqual([{ query: "a", sort: "stars", count: 3 }, { query: "b", sort: "updated", count: 4 }]);
    expect(r.errors).toEqual([]);
  });
  it("leere Anfrage ist ein Fehler", () => {
    expect(parseSearches(" | stars | 3").errors).toEqual([{ line: 1, reason: "Anfrage ist leer" }]);
  });
  it("Pipe in der Anfrage: falsche Teilzahl; Fehler blockiert andere Zeilen nicht", () => {
    const r = parseSearches("a | b | stars | 3\nok | stars | 3");
    expect(r.errors).toEqual([{ line: 1, reason: "erwartet: anfrage | sort | anzahl" }]);
    expect(r.searches).toHaveLength(1);
  });
});

describe("searchKey und searchUrl", () => {
  it("Schlüssel ist query|sort|count", () => {
    expect(searchKey(S1)).toBe("claude-code stars:>8|updated|8");
  });
  it("Kodierung: Leerzeichen %20, > als %3E, OR bleibt", () => {
    expect(searchUrl(S2)).toBe("https://api.github.com/search/repositories?q=claude%20skill%20OR%20claude%20subagent%20stars%3A%3E5&sort=stars&order=desc&per_page=8");
    expect(searchUrl(S1)).toContain("%3E8");
    expect(searchUrl(S2)).toContain("%20OR%20");
  });
});

describe("parseSearchResponse", () => {
  it("übernimmt nur die sechs Felder, Fremdfelder fallen weg", () => {
    const text = JSON.stringify({ total_count: 1, items: [{ id: 5, node_id: "x", full_name: "a/b", html_url: "https://github.com/a/b", owner: { login: "a" }, stargazers_count: 42, description: "Text", pushed_at: "2026-10-01T00:00:00Z", forks: 3 }] });
    expect(parseSearchResponse(text)).toEqual([{ id: 5, full_name: "a/b", html_url: "https://github.com/a/b", stargazers_count: 42, description: "Text", pushed_at: "2026-10-01T00:00:00Z" }]);
  });
  it("description null wird leerer Text, fehlende Sterne 0, pushed_at kein String leer", () => {
    const r = parseSearchResponse(JSON.stringify({ items: [{ id: 1, full_name: "a/b", html_url: "u", description: null, pushed_at: 5 }] }));
    expect(r).toEqual([{ id: 1, full_name: "a/b", html_url: "u", stargazers_count: 0, description: "", pushed_at: "" }]);
  });
  it("kaputtes JSON, kein Objekt, items fehlt oder kein Array: null", () => {
    expect(parseSearchResponse("{kaputt")).toBeNull();
    expect(parseSearchResponse("[]")).toBeNull();
    expect(parseSearchResponse("null")).toBeNull();
    expect(parseSearchResponse("{}")).toBeNull();
    expect(parseSearchResponse('{"items":"x"}')).toBeNull();
  });
  it("Element ohne id (oder mit ungültiger) wird übersprungen", () => {
    const r = parseSearchResponse(JSON.stringify({ items: [{ full_name: "a/b", html_url: "u" }, { id: 0, full_name: "a", html_url: "u" }, { id: 2, full_name: "c/d", html_url: "u" }, 7, null] }));
    expect(r?.map((i) => i.id)).toEqual([2]);
  });
});

describe("describeFailure", () => {
  const hhmm = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  it("403 mit remaining 0: Limit mit Uhrzeit aus reset (Header case-insensitiv)", () => {
    const reset = Math.floor(NOW / 1000) + 1800;
    const m = describeFailure(403, { "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": String(reset) }, "", NOW);
    expect(m).toBe(`GitHub-Limit erreicht, wieder ab ${hhmm(reset * 1000)}`);
  });
  it("429 mit retry-after: Uhrzeit nowMs + Sekunden", () => {
    expect(describeFailure(429, { "Retry-After": "90" }, "", NOW)).toBe(`GitHub-Limit erreicht, wieder ab ${hhmm(NOW + 90_000)}`);
  });
  it("422 ohne und mit message", () => {
    expect(describeFailure(422, {}, "", NOW)).toBe("Suche ungültig");
    expect(describeFailure(422, {}, '{"message":"Validation Failed"}', NOW)).toBe("Suche ungültig: Validation Failed");
  });
  it("500 mit message", () => {
    expect(describeFailure(500, {}, '{"message":"Server kaputt"}', NOW)).toBe("HTTP 500: Server kaputt");
  });
  it("500 ohne JSON: erste nicht-leere Zeile, auf 120 gekürzt", () => {
    expect(describeFailure(500, {}, "\n\nZeile eins\nzwei", NOW)).toBe("HTTP 500: Zeile eins");
    expect(describeFailure(500, {}, "x".repeat(300), NOW)).toBe(`HTTP 500: ${"x".repeat(120)}`);
  });
  it("500 mit leerem Text: nur Status", () => {
    expect(describeFailure(500, {}, "", NOW)).toBe("HTTP 500");
  });
  it("403 ohne remaining 0 und ohne retry-after: HTTP 403", () => {
    expect(describeFailure(403, { "x-ratelimit-remaining": "5" }, "", NOW)).toBe("HTTP 403");
  });
});

describe("parseResearchCache und serializeResearchCache", () => {
  const leer = { fetched_at: null, sections: [], seen: [] };
  it("null, leer, kaputt, kein Objekt: leerer Cache", () => {
    expect(parseResearchCache(null)).toEqual(leer);
    expect(parseResearchCache("")).toEqual(leer);
    expect(parseResearchCache("{kaputt")).toEqual(leer);
    expect(parseResearchCache("[1]")).toEqual(leer);
    expect(parseResearchCache("42")).toEqual(leer);
  });
  it("Felder fehlen: einzeln tolerant", () => {
    expect(parseResearchCache('{"fetched_at":"x","sections":5,"seen":7}')).toEqual(leer);
    expect(parseResearchCache('{"fetched_at":123}').fetched_at).toBe(123);
  });
  it("ungültige Abschnitte werden verworfen, gültige gefiltert", () => {
    const text = JSON.stringify({ fetched_at: 5, seen: [], sections: [
      { query: "", sort: "stars", count: 3, items: [] },
      { query: "a", sort: "x", count: 3, items: [] },
      { query: "a", sort: "stars", count: 99, items: [] },
      { query: "a", sort: "stars", count: 3, fetched_at: "y", error: 4, items: [{ id: 1, full_name: "a/b", html_url: "u" }, { full_name: "ohne id" }] },
    ] });
    const c = parseResearchCache(text);
    expect(c.sections).toHaveLength(1);
    expect(c.sections[0].fetched_at).toBeNull();
    expect(c.sections[0].error).toBeUndefined();
    expect(c.sections[0].items.map((i) => i.id)).toEqual([1]);
  });
  it("error bleibt, wenn String", () => {
    const c = parseResearchCache(JSON.stringify({ sections: [{ query: "a", sort: "updated", count: 1, fetched_at: 9, error: "boom", items: [] }] }));
    expect(c.sections[0]).toMatchObject({ error: "boom", fetched_at: 9 });
  });
  it("seen: Müll und Dopplungen raus", () => {
    expect(parseResearchCache('{"seen":[1,2,2,"3",-1,0,1.5,null,4]}').seen).toEqual([1, 2, 4]);
  });
  it("Rundreise serialize -> parse, Format mit Einrückung und Zeilenumbruch", () => {
    const c: ResearchCache = { fetched_at: NOW, sections: [{ ...S1, fetched_at: NOW, items: [repo(1)] }], seen: [1] };
    const s = serializeResearchCache(c);
    expect(s).toBe(JSON.stringify(c, null, 2) + "\n");
    expect(parseResearchCache(s)).toEqual(c);
  });
});

describe("mergeSection", () => {
  it("Erfolg auf leerem Cache hängt an und setzt Zeitstempel", () => {
    const c = mergeSection(emptyResearchCache(), S1, ok(repo(1)), NOW, false);
    expect(c.fetched_at).toBe(NOW);
    expect(c.sections).toEqual([{ ...S1, fetched_at: NOW, items: [repo(1)] }]);
    expect(c.seen).toEqual([]);
  });
  it("Erfolg ersetzt den Abschnitt der gleichen Suche, andere bleiben", () => {
    let c = mergeSection(emptyResearchCache(), S1, ok(repo(1)), 1, false);
    c = mergeSection(c, S2, ok(repo(2)), 2, false);
    c = mergeSection(c, S1, ok(repo(3)), 3, false);
    expect(c.sections.map((s) => s.items[0].id)).toEqual([3, 2]);
    expect(c.fetched_at).toBe(3);
  });
  it("Fehler behält alte Treffer und Zeitstempel, setzt error, Top-Level unverändert", () => {
    const c0 = mergeSection(emptyResearchCache(), S1, ok(repo(1)), 100, false);
    const c = mergeSection(c0, S1, { ok: false, error: "HTTP 500" }, 200, false);
    expect(c.sections[0]).toEqual({ ...S1, fetched_at: 100, items: [repo(1)], error: "HTTP 500" });
    expect(c.fetched_at).toBe(100);
  });
  it("Fehler bei neuem Abschnitt: leer, fetched_at null", () => {
    const c = mergeSection(emptyResearchCache(), S1, { ok: false, error: "x" }, 200, false);
    expect(c.sections).toEqual([{ ...S1, fetched_at: null, items: [], error: "x" }]);
    expect(c.fetched_at).toBeNull();
  });
  it("Erfolg nach Fehler löscht error", () => {
    let c = mergeSection(emptyResearchCache(), S1, { ok: false, error: "x" }, 1, false);
    c = mergeSection(c, S1, ok(repo(1)), 2, false);
    expect("error" in c.sections[0]).toBe(false);
  });
  it("Eingabe bleibt unverändert, Ergebnis ist ein neues Objekt", () => {
    const c0 = mergeSection(emptyResearchCache(), S1, ok(repo(1)), 1, false);
    const snap = JSON.stringify(c0);
    const c = mergeSection(c0, S1, ok(repo(2)), 2, true);
    expect(JSON.stringify(c0)).toBe(snap);
    expect(c).not.toBe(c0);
  });
  it("firstRun: IDs nach seen ohne Dopplung", () => {
    let c = mergeSection(emptyResearchCache(), S1, ok(repo(1), repo(2)), 1, true);
    c = mergeSection(c, S2, ok(repo(2), repo(3)), 2, true);
    expect(c.seen).toEqual([1, 2, 3]);
  });
});

describe("isStale", () => {
  it("null ist veraltet", () => expect(isStale(null, NOW, 60)).toBe(true));
  it("knapp unter der Grenze nicht veraltet", () => expect(isStale(NOW - 60 * 60000 + 1, NOW, 60)).toBe(false));
  it("genau an der Grenze veraltet", () => expect(isStale(NOW - 60 * 60000, NOW, 60)).toBe(true));
});

describe("dueSearches", () => {
  const frisch = () => {
    let c = emptyResearchCache();
    for (const s of [S1, S2]) c = mergeSection(c, s, ok(repo(1)), NOW, false);
    return c;
  };
  it("frisch: nichts fällig", () => expect(dueSearches(frisch(), [S1, S2], NOW + 1000, 60, false)).toEqual([]));
  it("force: alle", () => expect(dueSearches(frisch(), [S1, S2], NOW, 60, true)).toEqual([S1, S2]));
  it("neu hinzugekommene Suche ist fällig", () => expect(dueSearches(frisch(), [S1, S4, S2], NOW, 60, false)).toEqual([S4]));
  it("geänderte Anzahl ist eine neue Suche", () => {
    const geaendert = { ...S1, count: 9 };
    expect(dueSearches(frisch(), [geaendert, S2], NOW, 60, false)).toEqual([geaendert]);
  });
  it("Abschnitt mit error ist fällig, Reihenfolge wie searches", () => {
    const c = mergeSection(frisch(), S2, { ok: false, error: "x" }, NOW, false);
    expect(dueSearches(c, [S2, S1], NOW, 60, false)).toEqual([S2]);
  });
  it("veralteter Abschnitt ist fällig", () => {
    expect(dueSearches(frisch(), [S1, S2], NOW + 61 * 60000, 60, false)).toEqual([S1, S2]);
  });
});

describe("pruneSections", () => {
  it("entfernte Suche fällt weg, Reihenfolge der searches, seen und fetched_at bleiben", () => {
    let c = emptyResearchCache();
    c = mergeSection(c, S1, ok(repo(1)), 5, true);
    c = mergeSection(c, S2, ok(repo(2)), 6, true);
    c = mergeSection(c, S3, ok(repo(3)), 7, true);
    const p = pruneSections(c, [S3, S1]);
    expect(p.sections.map((s) => searchKey(s))).toEqual([searchKey(S3), searchKey(S1)]);
    expect(p.seen).toEqual([1, 2, 3]);
    expect(p.fetched_at).toBe(7);
  });
});

describe("newIds und markSeen", () => {
  /** Ein Lauf: firstRun einmal vorher ermitteln, an jede Suche weitergeben. */
  const lauf = (c: ResearchCache, daten: Array<[ResearchSearch, RepoItem[]]>, now: number) => {
    const first = isFirstRun(c);
    for (const [s, items] of daten) c = mergeSection(c, s, ok(...items), now, first);
    return c;
  };
  it("isFirstRun: leer ja, mit seen oder Treffern nein", () => {
    expect(isFirstRun(emptyResearchCache())).toBe(true);
    expect(isFirstRun(mergeSection(emptyResearchCache(), S1, ok(repo(1)), 1, false))).toBe(false);
    expect(isFirstRun({ fetched_at: null, sections: [], seen: [1] })).toBe(false);
    expect(isFirstRun(mergeSection(emptyResearchCache(), S1, { ok: false, error: "x" }, 1, false))).toBe(true);
  });
  it("erster Lauf über zwei Suchen: keine Marken", () => {
    const c = lauf(emptyResearchCache(), [[S1, [repo(1), repo(2)]], [S2, [repo(3)]]], 1);
    expect(newIds(c).size).toBe(0);
  });
  it("späterer Lauf mit neuem Repo: genau dieses ist neu", () => {
    let c = lauf(emptyResearchCache(), [[S1, [repo(1)]], [S2, [repo(2)]]], 1);
    c = lauf(c, [[S1, [repo(1), repo(9)]], [S2, [repo(2)]]], 2);
    expect([...newIds(c)]).toEqual([9]);
  });
  it("abgehakt: ohne Marke, markSeen ist rein und ohne Dopplung", () => {
    let c = lauf(emptyResearchCache(), [[S1, [repo(1)]]], 1);
    c = lauf(c, [[S1, [repo(1), repo(9)]]], 2);
    const m = markSeen(c, 9);
    expect(newIds(m).size).toBe(0);
    expect(newIds(c).has(9)).toBe(true);
    expect(markSeen(m, 9).seen.filter((i) => i === 9)).toHaveLength(1);
  });
  it("Repo verschwindet und kommt wieder: ohne Marke", () => {
    let c = lauf(emptyResearchCache(), [[S1, [repo(1), repo(2)]]], 1);
    c = lauf(c, [[S1, [repo(1)]]], 2);
    c = lauf(c, [[S1, [repo(1), repo(2)]]], 3);
    expect(newIds(c).size).toBe(0);
  });
  it("neue vierte Suche nach dem ersten Lauf: alle ihre Treffer neu", () => {
    let c = lauf(emptyResearchCache(), [[S1, [repo(1)]], [S2, [repo(2)]], [S3, [repo(3)]]], 1);
    c = lauf(c, [[S4, [repo(7), repo(8)]]], 2);
    expect([...newIds(c)].sort()).toEqual([7, 8]);
  });
});

describe("safeRepoUrl", () => {
  it("gültige github.com-URL", () => expect(safeRepoUrl("https://github.com/a/b")).toBe("https://github.com/a/b"));
  it.each([
    "http://github.com/a/b",
    "https://github.com.evil.com/x",
    "https://evil.com/github.com",
    "javascript:alert(1)",
    "https://github.com/",
    "https://github.com",
    "https://github.com@evil.com/a",
  ])("%s: null", (u) => expect(safeRepoUrl(u)).toBeNull());
  it("Nicht-String: null", () => {
    for (const v of [undefined, null, 5, {}, ["https://github.com/a/b"]]) expect(safeRepoUrl(v)).toBeNull();
  });
});
