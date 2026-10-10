import { describe, expect, it } from "vitest";
import { composeFeed, ownSessionFiles, sessionFilesToDelete, soundOn, telegramOn, toggledSound, toggledTelegram, tokensToday, type FeedParts } from "../src/core/feed-compose";
import type { SessionFile } from "../src/core/session-file";

const ID_A = "90ef2efe-1234-4abc-8def-0123456789ab";
const ID_B = "11111111-2222-4333-8444-555555555555";
const file = (id: string, extra: Partial<SessionFile> = {}): SessionFile => ({ sessionId: id, contextTokens: 80_000, usedPercentage: 40, model: "Opus", writtenAt: 1_000, ...extra });

const basis = (over: Partial<FeedParts> = {}): FeedParts => ({
  handoffs: [], sessions: [], active: null, sessionFiles: new Map(), tokens: null, focus: [], vault: null, repos: null, day: null,
  radarLamps: new Map(), settings: { radars: [], projectsRoot: "~/p", briefingsDir: "B", inboxDir: "I", indexFile: "x.md", dailyDir: "D", nextEffort: "aus", telegramOnDone: false, telegramOnQuestion: false, alertSound: false, alertBanner: false },
  ...over,
});

describe("composeFeed: Handoffs (Abend 19h)", () => {
  it("reicht die offenen Handoffs durch", () => {
    const h = { project: "A", path: "P/A/Handoffs/a.md", created: "2026-01-01", task: "", repo: null };
    expect(composeFeed(basis({ handoffs: [h] })).handoffs).toEqual([h]);
  });
});

describe("composeFeed", () => {
  it("reicht die Teile unverändert durch und leitet Effort und Telegram aus den Einstellungen ab", () => {
    const feed = composeFeed(basis({
      focus: ["a", "b"], tokens: { tokens: 5, asOf: 9 }, repos: [{ name: "x", status: null }],
      radarLamps: new Map([["~/a", "green"], ["~/b", "red"]]), settings: { radars: [{ name: "Eins", stateFile: "~/a" }, { name: "Zwei", stateFile: "~/b" }], projectsRoot: "~/p", briefingsDir: "B", inboxDir: "I", indexFile: "x.md", dailyDir: "D", nextEffort: "high", telegramOnDone: true, telegramOnQuestion: false, alertSound: false, alertBanner: true },
    }));
    expect(feed.focus).toEqual(["a", "b"]);
    expect(feed.tokensToday).toEqual({ tokens: 5, asOf: 9 });
    expect(feed.repos).toEqual([{ name: "x", status: null }]);
    expect(feed.radars).toEqual([{ name: "Eins", lamp: "green" }, { name: "Zwei", lamp: "red" }]);
    expect(feed.effort).toBe("high");
    expect(feed.telegramOn).toBe(true);
    expect(feed.soundOn).toBe(true);
    expect(composeFeed(basis()).soundOn).toBe(false);
    const day = { loc: 5, commits: 1, repos: [{ name: "x", loc: 5, commits: 1 }] };
    expect(composeFeed(basis({ day })).day).toBe(day);
    expect(composeFeed(basis()).day).toBeNull();
  });

  it("aktive Sitzung bekommt die Datei ihrer Claude-ID, nicht die der Cockpit-ID", () => {
    const files = new Map([[ID_B, file(ID_B, { contextTokens: 123 })]]);
    const feed = composeFeed(basis({ active: { id: "cockpit-id", name: "claude 1", claudeId: ID_B }, sessionFiles: files }));
    expect(feed.active).toEqual({ id: "cockpit-id", name: "claude 1", file: file(ID_B, { contextTokens: 123 }) });
  });

  it("aktive Sitzung ohne Datei: file null; ohne aktive Sitzung: active null", () => {
    const files = new Map([[ID_A, file(ID_A)]]);
    expect(composeFeed(basis({ active: { id: "x", name: "n", claudeId: ID_B }, sessionFiles: files })).active?.file).toBeNull();
    expect(composeFeed(basis({ sessionFiles: files })).active).toBeNull();
  });
});

describe("ton", () => {
  const s = (sound: boolean, banner: boolean) => ({ alertSound: sound, alertBanner: banner });
  it("soundOn: an, sobald Ton oder Banner an ist", () => {
    expect(soundOn(s(false, false))).toBe(false);
    expect(soundOn(s(true, false))).toBe(true);
    expect(soundOn(s(false, true))).toBe(true);
    expect(soundOn(s(true, true))).toBe(true);
  });
  it("toggledSound: ist eines an, werden beide aus, sonst beide an", () => {
    expect(toggledSound(s(false, false))).toBe(true);
    expect(toggledSound(s(true, false))).toBe(false);
    expect(toggledSound(s(false, true))).toBe(false);
    expect(toggledSound(s(true, true))).toBe(false);
  });
});

describe("telegram", () => {
  const s = (d: boolean, q: boolean) => ({ telegramOnDone: d, telegramOnQuestion: q });
  it("an, sobald eines an ist", () => {
    expect(telegramOn(s(false, false))).toBe(false);
    expect(telegramOn(s(true, false))).toBe(true);
    expect(telegramOn(s(false, true))).toBe(true);
    expect(telegramOn(s(true, true))).toBe(true);
  });
  it("umschalten: ist eines an, werden beide aus, sonst beide an", () => {
    expect(toggledTelegram(s(false, false))).toBe(true);
    expect(toggledTelegram(s(true, false))).toBe(false);
    expect(toggledTelegram(s(false, true))).toBe(false);
    expect(toggledTelegram(s(true, true))).toBe(false);
  });
});

describe("tokensToday", () => {
  const count = { tokens: 1234, tokensSub: 0, skipped: 0, lines: 3 };
  it("nur bei fertigem Zähler und bekanntem Stand", () => {
    expect(tokensToday({ kind: "ok", count }, 77)).toEqual({ tokens: 1234, asOf: 77 });
    expect(tokensToday({ kind: "ok", count }, null)).toBeNull();
    expect(tokensToday({ kind: "loading" }, 77)).toBeNull();
    expect(tokensToday({ kind: "error", message: "x" }, 77)).toBeNull();
  });
});

describe("ownSessionFiles: nur eigene Sitzungen", () => {
  it("behält Dateien mit eigener Claude-ID, ignoriert fremde, Groß- und Kleinschreibung egal", () => {
    const m = ownSessionFiles([file(ID_A), file(ID_B)], [ID_A.toUpperCase()]);
    expect([...m.keys()]).toEqual([ID_A]);
    expect(m.get(ID_A)?.sessionId).toBe(ID_A);
  });
  it("keine eigenen Sitzungen: leer", () => {
    expect(ownSessionFiles([file(ID_A)], []).size).toBe(0);
  });
});

describe("sessionFilesToDelete: älter als 24 h", () => {
  const now = 1_000_000_000_000;
  const h = 3600_000;
  const e = (name: string, writtenAt: number | null, mtimeMs: number) => ({ name, writtenAt, mtimeMs });
  it("liest written_at (Unix-Sekunden), nicht die Dateizeit, wenn die Datei lesbar ist", () => {
    const frisch = e("a.json", (now - h) / 1000, now - 48 * h);
    const alt = e("b.json", (now - 25 * h) / 1000, now - h);
    expect(sessionFilesToDelete([frisch, alt], now)).toEqual(["b.json"]);
  });
  it("genau 24 h bleibt, darüber geht", () => {
    expect(sessionFilesToDelete([e("a.json", (now - 24 * h) / 1000, 0)], now)).toEqual([]);
    expect(sessionFilesToDelete([e("a.json", (now - 24 * h - 1000) / 1000, 0)], now)).toEqual(["a.json"]);
  });
  it("unlesbar (writtenAt null): Dateizeit entscheidet", () => {
    expect(sessionFilesToDelete([e("kaputt.json", null, now - 25 * h)], now)).toEqual(["kaputt.json"]);
    expect(sessionFilesToDelete([e("kaputt.json", null, now - h)], now)).toEqual([]);
  });
  it("nur .json-Dateien, sonst nichts anfassen", () => {
    expect(sessionFilesToDelete([e("notiz.txt", 0, 0), e(".tmp", 0, 0), e("x.json.123.tmp", null, 0)], now)).toEqual([]);
  });
});
