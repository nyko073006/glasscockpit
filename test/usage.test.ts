import { describe, expect, it } from "vitest";
import {
  formatAge, formatRemaining, localDayStart, localDayString, outputTokensToday, parseUsageSnapshot, splitComplete,
  TokenCounter, type TokenCounterDeps, TokenTally, type TokenCount, tokensFileContent,
  TranscriptScanner, type TranscriptFs, usagePollDue, usageView,
} from "../src/core/usage";

// Lokale Zeit: Tests rechnen mit new Date(j, m, t, ...) und hängen nicht an der Zeitzone der Maschine.
const NOW = new Date(2026, 9, 5, 14, 30, 0);
const NOW_S = Math.floor(NOW.getTime() / 1000);
const iso = (d: Date) => d.toISOString();
const HEUTE_9 = new Date(2026, 9, 5, 9, 0, 0);
const GESTERN_23 = new Date(2026, 9, 4, 23, 59, 0);

/** Assistant-Zeile wie im Transkript: message.id, message.usage.output_tokens, timestamp. */
const antwort = (id: string, out: number, ts: Date, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: "assistant", timestamp: iso(ts), message: { id, usage: { input_tokens: 3, output_tokens: out }, ...extra } });

describe("parseUsageSnapshot", () => {
  it("leer und nur Leerzeichen: kein Stand", () => {
    expect(parseUsageSnapshot("")).toBeNull();
    expect(parseUsageSnapshot("  \n")).toBeNull();
  });
  it("kaputt oder kein Objekt: kein Stand", () => {
    expect(parseUsageSnapshot("{\"written_at\": 1,")).toBeNull();
    expect(parseUsageSnapshot("[1,2]")).toBeNull();
    expect(parseUsageSnapshot("42")).toBeNull();
  });
  it("beide Fenster", () => {
    const s = parseUsageSnapshot(JSON.stringify({ written_at: 100, rate_limits: { five_hour: { used_percentage: 23.5, resets_at: 200 }, seven_day: { used_percentage: 41, resets_at: 300 } } }));
    expect(s).toEqual({ writtenAt: 100, windows: { five_hour: { usedPercentage: 23.5, resetsAt: 200 }, seven_day: { usedPercentage: 41, resetsAt: 300 } } });
  });
  it("ein Fenster fehlt oder ist kaputt: nur dieses fehlt", () => {
    const fehlt = parseUsageSnapshot(JSON.stringify({ written_at: 100, rate_limits: { seven_day: { used_percentage: 41, resets_at: 300 } } }));
    expect(fehlt).toEqual({ writtenAt: 100, windows: { seven_day: { usedPercentage: 41, resetsAt: 300 } } });
    const kaputt = parseUsageSnapshot(JSON.stringify({ written_at: 100, rate_limits: { five_hour: { used_percentage: "viel", resets_at: 200 }, seven_day: { used_percentage: 41, resets_at: 300 } } }));
    expect(kaputt?.windows).toEqual({ seven_day: { usedPercentage: 41, resetsAt: 300 } });
  });
  it("ohne written_at: Alter unbekannt, Fenster bleiben", () => {
    const s = parseUsageSnapshot(JSON.stringify({ rate_limits: { five_hour: { used_percentage: 1, resets_at: 2 } } }));
    expect(s).toEqual({ writtenAt: null, windows: { five_hour: { usedPercentage: 1, resetsAt: 2 } } });
  });
});

describe("usageView", () => {
  const snap = (writtenAt: number | null, five?: [number, number], week?: [number, number]) => ({
    writtenAt,
    windows: {
      ...(five ? { five_hour: { usedPercentage: five[0], resetsAt: five[1] } } : {}),
      ...(week ? { seven_day: { usedPercentage: week[0], resetsAt: week[1] } } : {}),
    },
  });
  it("Prozent gerundet und Restzeit bis resets_at, 5 Stunden vor Woche", () => {
    const v = usageView(snap(NOW_S - 30, [23.5, NOW_S + 2 * 3600 + 14 * 60], [41.2, NOW_S + 3 * 86400 + 4 * 3600]), NOW.getTime());
    expect(v.rows.map((r) => [r.key, r.label, r.percent, r.remainingSec, r.expired])).toEqual([
      ["five_hour", "5 Stunden", 24, 2 * 3600 + 14 * 60, false],
      ["seven_day", "Woche", 41, 3 * 86400 + 4 * 3600, false],
    ]);
    expect(v.rows[0].text).toBe("24 % · Reset in 2 Std. 14 Min.");
    expect(v.rows[1].text).toBe("41 % · Reset in 3 Tagen 4 Std.");
    expect(v.ageSec).toBe(30);
    expect(v.ageText).toBe("gerade eben");
  });
  it("abgelaufen: zurückgesetzt statt alter Zahl", () => {
    const v = usageView(snap(NOW_S - 7200, [88, NOW_S - 1], [50, NOW_S + 60]), NOW.getTime());
    expect(v.rows[0]).toMatchObject({ key: "five_hour", expired: true, percent: null, remainingSec: null });
    expect(v.rows[0].text).toBe("zurückgesetzt, neuer Stand nach der nächsten Antwort");
    expect(v.rows[0].text).not.toContain("88");
    expect(v.rows[1].expired).toBe(false);
    expect(v.ageText).toBe("vor 2 Std.");
  });
  it("genau zum Reset gilt als abgelaufen", () => {
    expect(usageView(snap(NOW_S, [5, NOW_S]), NOW.getTime()).rows[0].expired).toBe(true);
  });
  it("fehlendes Fenster fehlt nur in seiner Zeile", () => {
    const v = usageView(snap(NOW_S, undefined, [10, NOW_S + 600]), NOW.getTime());
    expect(v.rows.map((r) => r.key)).toEqual(["seven_day"]);
  });
  it("Alter unbekannt und Uhr der Datei in der Zukunft", () => {
    expect(usageView(snap(null), NOW.getTime()).ageText).toBe("Alter unbekannt");
    expect(usageView(snap(NOW_S + 50), NOW.getTime()).ageSec).toBe(0);
  });
});

describe("formatRemaining und formatAge", () => {
  it("Restzeit", () => {
    expect(formatRemaining(59)).toBe("unter 1 Min.");
    expect(formatRemaining(60)).toBe("1 Min.");
    expect(formatRemaining(3599)).toBe("59 Min.");
    expect(formatRemaining(3600)).toBe("1 Std. 0 Min.");
    expect(formatRemaining(86400 + 3600)).toBe("1 Tag 1 Std.");
  });
  it("Alter", () => {
    expect(formatAge(0)).toBe("gerade eben");
    expect(formatAge(59)).toBe("gerade eben");
    expect(formatAge(60)).toBe("vor 1 Min.");
    expect(formatAge(3600)).toBe("vor 1 Std.");
    expect(formatAge(86400)).toBe("vor 1 Tag");
    expect(formatAge(3 * 86400)).toBe("vor 3 Tagen");
  });
});

describe("outputTokensToday", () => {
  it("leer", () => {
    expect(outputTokensToday([], NOW)).toEqual({ tokens: 0, tokensSub: 0, skipped: 0, lines: 0 });
    expect(outputTokensToday(["", "  "], NOW)).toEqual({ tokens: 0, tokensSub: 0, skipped: 0, lines: 0 });
  });
  it("nur gestern zählt nicht", () => {
    expect(outputTokensToday([antwort("m1", 500, GESTERN_23)], NOW)).toEqual({ tokens: 0, tokensSub: 0, skipped: 0, lines: 1 });
  });
  it("heute zählt, Mitternacht lokal gehört zu heute", () => {
    const zeilen = [antwort("m1", 500, GESTERN_23), antwort("m2", 120, new Date(2026, 9, 5, 0, 0, 0)), antwort("m3", 30, HEUTE_9)];
    expect(outputTokensToday(zeilen, NOW).tokens).toBe(150);
  });
  it("andere Zeilentypen zählen nicht und sind nicht defekt", () => {
    const user = JSON.stringify({ type: "user", timestamp: iso(HEUTE_9), message: { role: "user", content: "x" } });
    expect(outputTokensToday([user, antwort("m1", 7, HEUTE_9)], NOW)).toEqual({ tokens: 7, tokensSub: 0, skipped: 0, lines: 2 });
  });
  it("defekte Zeilen werden übersprungen und gezählt", () => {
    const zeilen = [
      "{kaputt",
      "[1]",
      JSON.stringify({ type: "assistant", timestamp: iso(HEUTE_9) }),
      JSON.stringify({ type: "assistant", timestamp: iso(HEUTE_9), message: { id: "x", usage: { output_tokens: "viele" } } }),
      JSON.stringify({ type: "assistant", timestamp: "gestern", message: { id: "y", usage: { output_tokens: 5 } } }),
      JSON.stringify({ type: "assistant", timestamp: iso(HEUTE_9), message: { usage: { output_tokens: 5 } } }),
      antwort("m1", 40, HEUTE_9),
    ];
    expect(outputTokensToday(zeilen, NOW)).toEqual({ tokens: 40, tokensSub: 0, skipped: 6, lines: 7 });
  });
  it("synthetische Zeile ohne ID mit 0 Tokens ist nicht defekt", () => {
    const synth = JSON.stringify({ type: "assistant", timestamp: iso(HEUTE_9), message: { model: "<synthetic>", usage: { output_tokens: 0 } } });
    expect(outputTokensToday([synth], NOW)).toEqual({ tokens: 0, tokensSub: 0, skipped: 0, lines: 1 });
  });
  it("doppelte Antwort zählt einmal, mit dem höchsten Stand", () => {
    // Claude Code schreibt je Inhaltsblock eine Zeile; frühe Zeilen tragen Zwischenstände.
    const zeilen = [antwort("m1", 8, HEUTE_9), antwort("m1", 330, HEUTE_9, { stop_reason: "tool_use" }), antwort("m1", 330, HEUTE_9)];
    expect(outputTokensToday(zeilen, NOW).tokens).toBe(330);
  });
});

describe("TokenTally: Anteil der Sub-Agents (Abend 19d)", () => {
  const tally = () => new TokenTally(localDayStart(NOW), localDayStart(NOW) + 86_400_000);
  const SUB = "/Users/x/.claude/projects/p/abc/subagents/agent-x.jsonl";
  const MAIN = "/Users/x/.claude/projects/p/abc.jsonl";

  it("Zeile aus …/subagents/agent-x.jsonl zählt in tokensSub und in tokens", () => {
    const t = tally();
    t.add(antwort("m1", 300, HEUTE_9), SUB);
    expect(t.result()).toMatchObject({ tokens: 300, tokensSub: 300 });
  });
  it("isSidechain: true zählt auch aus einer Hauptdatei", () => {
    const t = tally();
    t.add(antwort("m1", 120, HEUTE_9, {}).replace('{"type"', '{"isSidechain":true,"type"'), MAIN);
    expect(t.result()).toMatchObject({ tokens: 120, tokensSub: 120 });
  });
  it("isSidechain: false und Hauptzeile zählen nicht in tokensSub", () => {
    const t = tally();
    t.add(antwort("m1", 50, HEUTE_9), MAIN);
    t.add(antwort("m2", 70, HEUTE_9).replace('{"type"', '{"isSidechain":false,"type"'), MAIN);
    expect(t.result()).toMatchObject({ tokens: 120, tokensSub: 0 });
  });
  it("ohne Pfad (outputTokensToday) zählt nur isSidechain", () => {
    expect(outputTokensToday([antwort("m1", 9, HEUTE_9)], NOW).tokensSub).toBe(0);
  });
  it("dieselbe message.id mit 8 und 511: tokensSub ist 511, nicht 519", () => {
    const t = tally();
    t.add(antwort("m1", 8, HEUTE_9), SUB);
    t.add(antwort("m1", 511, HEUTE_9), SUB);
    expect(t.result()).toMatchObject({ tokens: 511, tokensSub: 511 });
  });
  it("Höchstwert unabhängig von der Reihenfolge (511 zuerst, dann 8)", () => {
    const t = tally();
    t.add(antwort("m1", 511, HEUTE_9), SUB);
    t.add(antwort("m1", 8, HEUTE_9), SUB);
    expect(t.result()).toMatchObject({ tokens: 511, tokensSub: 511 });
  });
  it("gemischt: Haupt 100 + Sub 40 ergibt tokens 140, tokensSub 40", () => {
    const t = tally();
    t.add(antwort("m1", 100, HEUTE_9), MAIN);
    t.add(antwort("m2", 40, HEUTE_9), SUB);
    expect(t.result()).toMatchObject({ tokens: 140, tokensSub: 40 });
  });
  it("Scanner reicht den Dateipfad durch", async () => {
    const { fs } = fakeFs({
      "p/s.jsonl": { text: `${antwort("m1", 100, HEUTE_9)}\n`, mtime: HEUTE_9 },
      "p/s/subagents/agent-a.jsonl": { text: `${antwort("m2", 8, HEUTE_9)}\n${antwort("m2", 60, HEUTE_9)}\n`, mtime: HEUTE_9 },
    });
    expect(await new TranscriptScanner(fs).scan(NOW)).toEqual({ tokens: 160, tokensSub: 60, skipped: 0, lines: 3 });
  });
  it("tokensFileContent enthält output_tokens_sub", () => {
    const o = JSON.parse(tokensFileContent({ tokens: 160, tokensSub: 60, skipped: 0, lines: 3 }, NOW));
    expect(o.output_tokens_sub).toBe(60);
  });
});

describe("splitComplete", () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  it("nur vollständige Zeilen, Rest bleibt für später", () => {
    expect(splitComplete(enc("a\nb\nhal"))).toEqual({ text: "a\nb", consumed: 4 });
    expect(splitComplete(enc("halb"))).toEqual({ text: "", consumed: 0 });
    expect(splitComplete(enc(""))).toEqual({ text: "", consumed: 0 });
  });
  it("zählt Bytes, nicht Zeichen", () => {
    expect(splitComplete(enc("ä€\nx"))).toEqual({ text: "ä€", consumed: 6 });
  });
});

/** Dateisystem im Speicher: Inhalt je Pfad, mtime je Pfad, protokolliert die Lesebereiche. */
function fakeFs(files: Record<string, { text: string; mtime: Date }>) {
  const reads: Array<[string, number, number]> = [];
  const fs: TranscriptFs = {
    async list() {
      return Object.entries(files).map(([path, f]) => ({ path, size: new TextEncoder().encode(f.text).length, mtimeMs: f.mtime.getTime() }));
    },
    async read(path, from, to) {
      reads.push([path, from, to]);
      const f = files[path];
      return f ? new TextEncoder().encode(f.text).subarray(from, to) : null;
    },
  };
  return { fs, reads, files };
}

describe("TranscriptScanner", () => {
  it("mehrere Dateien, nur heute geänderte werden gelesen, Antworten über Dateien entdoppelt", async () => {
    const { fs, reads } = fakeFs({
      "a.jsonl": { text: `${antwort("m1", 100, HEUTE_9)}\n${antwort("m2", 20, HEUTE_9)}\n`, mtime: HEUTE_9 },
      "p/s/subagents/b.jsonl": { text: `${antwort("m3", 5, HEUTE_9)}\n${antwort("m1", 100, HEUTE_9)}\n`, mtime: HEUTE_9 },
      "alt.jsonl": { text: `${antwort("m9", 999, HEUTE_9)}\n`, mtime: GESTERN_23 },
    });
    const r = await new TranscriptScanner(fs).scan(NOW);
    expect(r).toEqual({ tokens: 125, tokensSub: 5, skipped: 0, lines: 4 });
    expect(reads.map((x) => x[0]).sort()).toEqual(["a.jsonl", "p/s/subagents/b.jsonl"]);
  });
  it("inkrementell: liest ab der gemerkten Größe, halbe letzte Zeile erst wenn vollständig", async () => {
    const { fs, reads, files } = fakeFs({ "a.jsonl": { text: `${antwort("m1", 10, HEUTE_9)}\n`, mtime: HEUTE_9 } });
    const sc = new TranscriptScanner(fs);
    expect((await sc.scan(NOW)).tokens).toBe(10);
    const erste = files["a.jsonl"].text.length;
    const neu = antwort("m2", 7, HEUTE_9);
    files["a.jsonl"].text += neu.slice(0, 20);
    expect(await sc.scan(NOW)).toEqual({ tokens: 10, tokensSub: 0, skipped: 0, lines: 1 });
    files["a.jsonl"].text += `${neu.slice(20)}\n`;
    expect(await sc.scan(NOW)).toEqual({ tokens: 17, tokensSub: 0, skipped: 0, lines: 2 });
    expect(reads.map((x) => x[1])).toEqual([0, erste, erste]);
    await sc.scan(NOW);
    expect(reads.length).toBe(3);
  });
  it("geschrumpfte Datei: alles neu lesen, ohne doppelt zu zählen", async () => {
    const { fs, files } = fakeFs({ "a.jsonl": { text: `${antwort("m1", 10, HEUTE_9)}\n${antwort("m2", 5, HEUTE_9)}\n`, mtime: HEUTE_9 } });
    const sc = new TranscriptScanner(fs);
    expect((await sc.scan(NOW)).tokens).toBe(15);
    files["a.jsonl"].text = `${antwort("m1", 10, HEUTE_9)}\n`;
    expect(await sc.scan(NOW)).toEqual({ tokens: 10, tokensSub: 0, skipped: 0, lines: 1 });
  });
  it("um Mitternacht beginnt die Summe neu", async () => {
    const { fs, files } = fakeFs({ "a.jsonl": { text: `${antwort("m1", 10, HEUTE_9)}\n`, mtime: HEUTE_9 } });
    const sc = new TranscriptScanner(fs);
    expect((await sc.scan(NOW)).tokens).toBe(10);
    const morgen = new Date(2026, 9, 6, 0, 1, 0);
    files["a.jsonl"].text += `${antwort("m2", 3, new Date(2026, 9, 6, 0, 0, 30))}\n`;
    files["a.jsonl"].mtime = morgen;
    expect(await sc.scan(morgen)).toEqual({ tokens: 3, tokensSub: 0, skipped: 0, lines: 2 });
  });
  it("Datei verschwindet zwischen Liste und Lesen: übersprungen, kein Fehler", async () => {
    const fs: TranscriptFs = { list: async () => [{ path: "weg.jsonl", size: 10, mtimeMs: HEUTE_9.getTime() }], read: async () => null };
    expect(await new TranscriptScanner(fs).scan(NOW)).toEqual({ tokens: 0, tokensSub: 0, skipped: 0, lines: 0 });
  });
});

describe("localDayStart und usagePollDue", () => {
  it("lokale Mitternacht", () => {
    expect(localDayStart(NOW)).toBe(new Date(2026, 9, 5).getTime());
  });
  it("nur sichtbar und frühestens nach pollSec", () => {
    expect(usagePollDue(null, 1000, 60, true)).toBe(true);
    expect(usagePollDue(null, 1000, 60, false)).toBe(false);
    expect(usagePollDue(0, 59_999, 60, true)).toBe(false);
    expect(usagePollDue(0, 60_000, 60, true)).toBe(true);
    expect(usagePollDue(0, 600_000, 60, false)).toBe(false);
  });
});

describe("tokensFileContent (Abend 13)", () => {
  const count: TokenCount = { tokens: 12345, tokensSub: 4000, skipped: 2, lines: 99 };

  it("genau die sechs Felder, written_at in ganzen Unix-Sekunden", () => {
    const now = new Date(2026, 9, 5, 14, 30, 7, 999);
    const o = JSON.parse(tokensFileContent(count, now));
    expect(Object.keys(o).sort()).toEqual(["day", "lines", "output_tokens", "output_tokens_sub", "skipped", "written_at"]);
    expect(o).toEqual({ written_at: Math.floor(now.getTime() / 1000), day: "2026-10-05", output_tokens: 12345, output_tokens_sub: 4000, skipped: 2, lines: 99 });
    expect(Number.isInteger(o.written_at)).toBe(true);
  });
  it("lokaler Tag kurz vor Mitternacht", () => {
    const o = JSON.parse(tokensFileContent(count, new Date(2026, 9, 5, 23, 59, 59, 900)));
    expect(o.day).toBe("2026-10-05");
  });
  it("lokaler Tag kurz nach Mitternacht (nicht der UTC-Tag)", () => {
    const nachher = new Date(2026, 9, 6, 0, 0, 1);
    expect(JSON.parse(tokensFileContent(count, nachher)).day).toBe("2026-10-06");
    // Auch in Zeitzonen vor UTC darf der UTC-Tag nicht durchschlagen: das Datum kommt aus den lokalen Feldern.
    expect(localDayString(new Date(2026, 0, 1, 0, 0, 1))).toBe("2026-01-01");
    expect(localDayString(new Date(2026, 11, 31, 23, 59, 59))).toBe("2026-12-31");
  });
  it("Tageswechsel zwischen den Sekunden: written_at liegt am Tag, den day nennt", () => {
    const vor = JSON.parse(tokensFileContent(count, new Date(2026, 9, 5, 23, 59, 59)));
    const nach = JSON.parse(tokensFileContent(count, new Date(2026, 9, 6, 0, 0, 0)));
    expect(nach.written_at - vor.written_at).toBe(1);
    expect(vor.day).not.toBe(nach.day);
  });
  it("Datei endet mit Zeilenumbruch und ist gültiges JSON", () => {
    const text = tokensFileContent(count, NOW);
    expect(text.endsWith("\n")).toBe(true);
    expect(() => JSON.parse(text)).not.toThrow();
  });
});

describe("TokenCounter (Abend 13)", () => {
  interface Rig { deps: TokenCounterDeps; counter: TokenCounter; scans: Date[]; writes: string[]; logs: string[]; cfg: { writeTokensFile: boolean; usagePollSec: number }; clock: { ms: number } }
  const rig = (over: Partial<TokenCounterDeps> = {}, cfg = { writeTokensFile: true, usagePollSec: 60 }): Rig => {
    const scans: Date[] = [];
    const writes: string[] = [];
    const logs: string[] = [];
    const clock = { ms: NOW.getTime() };
    const deps: TokenCounterDeps = {
      scan: async (now) => { scans.push(now); return { tokens: 100 * scans.length, tokensSub: 30 * scans.length, skipped: 1, lines: 10 }; },
      write: async (content) => { writes.push(content); },
      settings: () => cfg,
      now: () => new Date(clock.ms),
      log: (m) => logs.push(m),
      ...over,
    };
    return { deps, counter: new TokenCounter(deps), scans, writes, logs, cfg, clock };
  };

  it("vor dem ersten Lauf: loading", () => {
    expect(rig().counter.state()).toEqual({ kind: "loading" });
  });
  it("asOf: Zeit des letzten erfolgreichen Laufs in ms, vorher und nach Fehler (ohne früheren Erfolg) null", async () => {
    const r = rig();
    expect(r.counter.asOf()).toBeNull();
    await r.counter.requestRun();
    expect(r.counter.asOf()).toBe(NOW.getTime());
    const f = rig({ scan: async () => { throw new Error("kaputt"); } });
    await f.counter.requestRun();
    expect(f.counter.asOf()).toBeNull();
  });
  it("asOf bleibt beim Stand des letzten Erfolgs, wenn ein späterer Lauf scheitert", async () => {
    let fail = false;
    const r = rig({ scan: async () => { if (fail) throw new Error("x"); return { tokens: 1, tokensSub: 0, skipped: 0, lines: 1 }; } });
    await r.counter.requestRun();
    fail = true;
    r.clock.ms += 61_000;
    await r.counter.requestRun();
    expect(r.counter.state().kind).toBe("error");
    expect(r.counter.asOf()).toBe(NOW.getTime());
  });
  it("Lauf zählt, hält den Stand und schreibt die Datei, wenn writeTokensFile an ist", async () => {
    const r = rig();
    await r.counter.requestRun();
    expect(r.counter.state()).toEqual({ kind: "ok", count: { tokens: 100, tokensSub: 30, skipped: 1, lines: 10 } });
    expect(r.writes).toEqual([tokensFileContent({ tokens: 100, tokensSub: 30, skipped: 1, lines: 10 }, NOW)]);
  });
  it("aus: nichts schreiben, aber weiter zählen", async () => {
    const r = rig({}, { writeTokensFile: false, usagePollSec: 60 });
    await r.counter.requestRun();
    expect(r.writes).toEqual([]);
    expect(r.counter.state()).toEqual({ kind: "ok", count: { tokens: 100, tokensSub: 30, skipped: 1, lines: 10 } });
    r.clock.ms += 61_000;
    await r.counter.requestRun();
    expect(r.counter.state()).toEqual({ kind: "ok", count: { tokens: 200, tokensSub: 60, skipped: 1, lines: 10 } });
    expect(r.writes).toEqual([]);
  });
  it("Einstellung wird bei jedem Lauf frisch gelesen (aus, dann wieder an)", async () => {
    const r = rig();
    r.cfg.writeTokensFile = false;
    await r.counter.requestRun();
    expect(r.writes).toHaveLength(0);
    r.cfg.writeTokensFile = true;
    r.clock.ms += 61_000;
    await r.counter.requestRun();
    expect(r.writes).toHaveLength(1);
  });
  it("jüngerer Lauf als usagePollSec: kein neuer Lauf; ab usagePollSec wieder", async () => {
    const r = rig();
    await r.counter.requestRun();
    r.clock.ms += 59_000;
    await r.counter.requestRun();
    expect(r.scans).toHaveLength(1);
    r.clock.ms += 1_000;
    await r.counter.requestRun();
    expect(r.scans).toHaveLength(2);
  });
  it("usagePollSec wird frisch gelesen", async () => {
    const r = rig();
    await r.counter.requestRun();
    r.cfg.usagePollSec = 10;
    r.clock.ms += 10_000;
    await r.counter.requestRun();
    expect(r.scans).toHaveLength(2);
  });
  it("läuft schon einer, startet kein zweiter", async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    let n = 0;
    const r = rig({ scan: async () => { n++; await gate; return { tokens: 5, tokensSub: 0, skipped: 0, lines: 1 }; } });
    const a = r.counter.requestRun();
    const b = r.counter.requestRun();
    release();
    await Promise.all([a, b]);
    expect(n).toBe(1);
    expect(r.writes).toHaveLength(1);
  });
  it("Schreibfehler: nur ins Log, Stand bleibt ok, kein Wurf", async () => {
    const r = rig({ write: async () => { throw new Error("Platte voll"); } });
    await expect(r.counter.requestRun()).resolves.toBeUndefined();
    expect(r.counter.state().kind).toBe("ok");
    expect(r.logs).toHaveLength(1);
    expect(r.logs[0]).toContain("Platte voll");
  });
  it("Lesefehler: Stand error, nichts geschrieben, Abonnent trotzdem benachrichtigt", async () => {
    const r = rig({ scan: async () => { throw new Error("kein Zugriff"); } });
    let calls = 0;
    r.counter.subscribe(() => { calls++; });
    await r.counter.requestRun();
    expect(r.counter.state()).toEqual({ kind: "error", message: "kein Zugriff" });
    expect(r.writes).toEqual([]);
    expect(calls).toBe(1);
  });
  it("Abonnenten: nach jedem Lauf gerufen, nach dem Abmelden nicht mehr", async () => {
    const r = rig();
    let calls = 0;
    const off = r.counter.subscribe(() => { calls++; });
    await r.counter.requestRun();
    expect(calls).toBe(1);
    off();
    r.clock.ms += 61_000;
    await r.counter.requestRun();
    expect(calls).toBe(1);
  });
  it("Abonnent wird erst nach dem Schreiben gerufen (Karte und Datei zeigen dieselbe Zahl)", async () => {
    const r = rig();
    let writesAtCall = -1;
    r.counter.subscribe(() => { writesAtCall = r.writes.length; });
    await r.counter.requestRun();
    expect(writesAtCall).toBe(1);
  });
  it("ein Abonnent, der wirft, stört den Zähler nicht", async () => {
    const r = rig();
    r.counter.subscribe(() => { throw new Error("Karte kaputt"); });
    let ok = false;
    r.counter.subscribe(() => { ok = true; });
    await r.counter.requestRun();
    expect(ok).toBe(true);
    expect(r.logs.some((l) => l.includes("Karte kaputt"))).toBe(true);
  });
});
