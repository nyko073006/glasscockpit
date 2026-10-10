import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { personalTerms } from "./helpers/denylist";
import { DEFAULT_SETTINGS, parseSettings, validateSetting, normalizeSetting } from "../src/core/settings";
import { RADAR_SLOTS } from "../src/core/constants";
import { UNSET_SHORT, UNSET_SETTING_LABEL, UNSET_TEXT, isUnset, radarShort, unsetHint } from "../src/core/unset";
import { composeFeed, composeRadars, type FeedParts } from "../src/core/feed-compose";
import { fieldValues } from "../src/core/cockpit-panels";
import type { CockpitFeed } from "../src/core/cockpit-feed";

// Abend 21.1: Kein Vorgabewert setzt ein bestimmtes Vault voraus. Leer heißt „nicht eingerichtet“, nie Fehler.

describe("leeres Vault", () => {
  it("parseSettings(undefined) liefert neutrale Vorgaben", () => {
    const s = parseSettings(undefined).settings;
    expect(s.projectsRoot).toBe("");
    expect(s.briefingsDir).toBe("");
    expect(s.inboxDir).toBe("");
    expect(s.dailyDir).toBe("");
    expect(s.indexFile).toBe("");
    expect(s.lintCommand).toBe("");
    expect(s.radars).toEqual([]);
    expect(s.tasksFile).toBe("Cockpit Tasks.md");
    expect(s.skipPermissions).toBe(false);
  });
  it("kein Vorgabewert nennt Inbox-, Daily-, Briefing- oder Lint-Vorgaben", () => {
    const json = JSON.stringify(DEFAULT_SETTINGS);
    for (const wort of ["Inbox", "Daily Notes", "Briefings", "/lint"]) {
      expect(json).not.toContain(wort);
    }
  });
  // Die persönlichen Begriffe stehen nicht im Repo, sondern in der lokalen Sperrliste; ohne sie bleibt der Fall sichtbar übersprungen.
  it.skipIf(personalTerms().length === 0)("kein Vorgabewert nennt persönliche Begriffe (übersprungen ohne lokale Sperrliste)", () => {
    const json = JSON.stringify(DEFAULT_SETTINGS).toLowerCase();
    for (const wort of personalTerms()) expect(json).not.toContain(wort);
  });
});

describe("Validatoren: leer ist erlaubt, Form gilt nur für nicht leere Werte", () => {
  it.each(["projectsRoot", "briefingsDir", "inboxDir", "dailyDir", "indexFile"] as const)("%s darf leer sein", (key) => {
    expect(validateSetting(key, "")).toBeNull();
    expect(validateSetting(key, "  ")).toBeNull();
    expect(validateSetting(key, " / ")).toBeNull();
    expect(parseSettings({ [key]: "" }).invalid).toEqual([]);
  });
  it("Form nicht leerer Werte bleibt geprüft", () => {
    expect(validateSetting("inboxDir", "a/../b")).toBe("darf kein .. enthalten");
    expect(validateSetting("briefingsDir", "../x")).toBe("darf kein .. enthalten");
    expect(validateSetting("dailyDir", "x/..")).toBe("darf kein .. enthalten");
    expect(validateSetting("indexFile", "Index")).toBe("muss auf .md enden");
    expect(validateSetting("indexFile", "../Index.md")).toBe("darf kein .. enthalten");
    expect(validateSetting("indexFile", "Index.md")).toBeNull();
    expect(validateSetting("inboxDir", 5)).not.toBeNull();
    expect(validateSetting("projectsRoot", 5)).not.toBeNull();
  });
  it("tasksFile bleibt nicht leer", () => {
    expect(validateSetting("tasksFile", "")).toBe("darf nicht leer sein");
    expect(parseSettings({ tasksFile: "" }).invalid).toEqual(["tasksFile"]);
    expect(parseSettings({ tasksFile: "" }).settings.tasksFile).toBe("Cockpit Tasks.md");
  });
  it("leere Ordner bleiben beim Normalisieren leer", () => {
    expect(normalizeSetting("inboxDir", " / ")).toBe("");
    expect(parseSettings({ inboxDir: "/Eingang/" }).settings.inboxDir).toBe("Eingang");
  });
});

describe("lintCommand", () => {
  it("beliebiger Text, leer = aus, getrimmt", () => {
    expect(validateSetting("lintCommand", "")).toBeNull();
    expect(validateSetting("lintCommand", "/lint")).toBeNull();
    expect(validateSetting("lintCommand", "prüfe das Vault")).toBeNull();
    expect(validateSetting("lintCommand", 3)).not.toBeNull();
    expect(parseSettings({ lintCommand: "  /lint  " }).settings.lintCommand).toBe("/lint");
    expect(parseSettings({ lintCommand: 3 }).invalid).toEqual(["lintCommand"]);
  });
});

describe("radars: Liste", () => {
  it("gültige Liste wird übernommen und getrimmt", () => {
    const r = parseSettings({ radars: [{ name: " Eins ", stateFile: " ~/a/state.json " }] });
    expect(r.settings.radars).toEqual([{ name: "Eins", stateFile: "~/a/state.json" }]);
    expect(r.invalid).toEqual([]);
  });
  it("ungültige Einträge fliegen einzeln raus, die Liste bleibt", () => {
    const r = parseSettings({ radars: [{ name: "A", stateFile: "x" }, 5, { name: "B" }, { name: 3, stateFile: "y" }, null, { name: "C", stateFile: "z" }] });
    expect(r.settings.radars).toEqual([{ name: "A", stateFile: "x" }, { name: "C", stateFile: "z" }]);
    expect(r.invalid).toEqual(["radars"]);
  });
  it("keine Liste: leer, als ungültig gemeldet", () => {
    const r = parseSettings({ radars: "x" });
    expect(r.settings.radars).toEqual([]);
    expect(r.invalid).toEqual(["radars"]);
  });
  it("leerer stateFile ist erlaubt (nicht eingerichtet)", () => {
    expect(parseSettings({ radars: [{ name: "A", stateFile: "" }] }).settings.radars).toEqual([{ name: "A", stateFile: "" }]);
  });
  it("höchstens RADAR_SLOTS Einträge", () => {
    expect(RADAR_SLOTS).toBe(2);
    const drei = [1, 2, 3].map((i) => ({ name: `R${i}`, stateFile: `f${i}` }));
    expect(parseSettings({ radars: drei }).settings.radars).toHaveLength(2);
    expect(validateSetting("radars", drei)).toBe("höchstens 2 Radare");
    expect(validateSetting("radars", drei.slice(0, 2))).toBeNull();
    expect(validateSetting("radars", [{ name: "A" }])).not.toBeNull();
  });
  it("die Standardliste wird nicht geteilt", () => {
    const a = parseSettings(undefined).settings;
    a.radars.push({ name: "x", stateFile: "y" });
    expect(parseSettings(undefined).settings.radars).toEqual([]);
    expect(DEFAULT_SETTINGS.radars).toEqual([]);
  });
});

describe("isUnset, Hinweistexte, Kürzel", () => {
  it("leer oder nur Leerzeichen ist nicht eingerichtet", () => {
    expect(isUnset("")).toBe(true);
    expect(isUnset("   ")).toBe(true);
    expect(isUnset("\t\n")).toBe(true);
    expect(isUnset("Eingang")).toBe(false);
    expect(isUnset(" a ")).toBe(false);
  });
  it("Hinweis nennt die Einstellung mit dem Namen der Einstellungsseite", () => {
    expect(UNSET_TEXT).toBe("nicht eingerichtet");
    expect(UNSET_SETTING_LABEL.inboxDir).toBe("Inbox-Ordner");
    expect(unsetHint("inboxDir")).toBe("Nicht eingerichtet: Einstellung „Inbox-Ordner“ ausfüllen.");
    expect(unsetHint("radars")).toContain("„Radare“");
    expect(unsetHint("projectsRoot")).toContain("„Projektordner“");
    expect(unsetHint("lintCommand")).toContain("„Lint-Befehl“");
  });
  it("Kürzel: erste zwei Buchstaben groß, Fallback bei leerem Namen", () => {
    expect(radarShort("Projekt-Monitor")).toBe("PR");
    expect(radarShort("  av lager")).toBe("AV");
    expect(radarShort("x")).toBe("X");
    expect(radarShort("Äther")).toBe("ÄT");
    expect(radarShort("")).toBe("··");
    expect(radarShort("  ")).toBe("··");
  });
});

describe("composeRadars", () => {
  const liste = [{ name: "Eins", stateFile: "~/a" }, { name: "Zwei", stateFile: "  " }, { name: "Drei", stateFile: "~/c" }];
  it("leerer Pfad ist unset ohne Lesen, sonst die gelesene Lampe, höchstens zwei sichtbar", () => {
    expect(composeRadars(liste, new Map([["~/a", "green"]]))).toEqual([{ name: "Eins", lamp: "green" }, { name: "Zwei", lamp: "unset" }]);
  });
  it("noch nicht gelesen: grau", () => {
    expect(composeRadars([liste[0]], new Map())).toEqual([{ name: "Eins", lamp: "gray" }]);
  });
  it("leerer Name: Radar n", () => {
    expect(composeRadars([{ name: "", stateFile: "~/a" }], new Map())).toEqual([{ name: "Radar 1", lamp: "gray" }]);
  });
});

const teile = (over: Partial<FeedParts> = {}): FeedParts => ({
  handoffs: [], sessions: [], active: null, sessionFiles: new Map(), tokens: null, focus: [], vault: null, repos: null, day: null, radarLamps: new Map(),
  settings: { ...DEFAULT_SETTINGS }, ...over,
});

describe("composeFeed: unset aus den Einstellungen", () => {
  it("leere Einstellungen: alles unset, Radare leer", () => {
    const f = composeFeed(teile());
    expect(f.unset).toEqual({ projects: true, briefings: true, inbox: true, index: true, daily: true });
    expect(f.radars).toEqual([]);
  });
  it("gesetzte Einstellungen: nichts unset", () => {
    const f = composeFeed(teile({ settings: { ...DEFAULT_SETTINGS, projectsRoot: "~/p", briefingsDir: "B", inboxDir: "I", indexFile: "x.md", dailyDir: "D" } }));
    expect(f.unset).toEqual({ projects: false, briefings: false, inbox: false, index: false, daily: false });
  });
  it("nur Leerzeichen zählt als unset", () => {
    expect(composeFeed(teile({ settings: { ...DEFAULT_SETTINGS, inboxDir: "  " } })).unset.inbox).toBe(true);
  });
  it("Radare aus den Einstellungen mit den gelesenen Lampen", () => {
    const f = composeFeed(teile({ radarLamps: new Map([["~/a", "red"]]), settings: { ...DEFAULT_SETTINGS, radars: [{ name: "A", stateFile: "~/a" }] } }));
    expect(f.radars).toEqual([{ name: "A", lamp: "red" }]);
  });
});

const NOW = new Date(2026, 9, 6, 12, 0, 0).getTime();
const fs = { contextWarn: 150_000, contextHandoff: 175_000, tokensDayMedian: 340_000, tokensDayP90: 870_000, lintAfterDays: 7, lintCommand: "/lint" };
const gesetzt = { projects: false, briefings: false, inbox: false, index: false, daily: false };
const feed = (o: Partial<CockpitFeed> = {}): CockpitFeed => ({
  sessions: [], active: null, handoffs: [], tokensToday: null, focus: [], vault: null, repos: null, day: null, unset: gesetzt,
  radars: [], effort: "high", telegramOn: false, soundOn: false, ...o,
});

describe("fieldValues: nicht eingerichtet", () => {
  it("Vault-Zeilen: unset hat Hinweis, die übrigen nicht; Inbox-Liste leer", () => {
    const v = fieldValues(feed({
      vault: { inbox: ["I/a.md"], indexGeneratedAt: NOW, dailyToday: true },
      unset: { ...gesetzt, inbox: true, daily: true },
    }), fs, NOW).vault;
    const inbox = v.lines.find((l) => l.label === "Inbox")!;
    expect(inbox).toMatchObject({ value: "aus", tone: "gray", hint: unsetHint("inboxDir") });
    expect(v.lines.find((l) => l.label === "Daily")).toMatchObject({ value: "aus", tone: "gray", hint: unsetHint("dailyDir") });
    const index = v.lines.find((l) => l.label === "Index")!;
    expect(index.value).toBe("heute");
    expect(index.hint).toBeUndefined();
    expect(v.inbox).toEqual([]);
  });
  it("Index unset ohne gelesenes Vault", () => {
    const v = fieldValues(feed({ unset: { ...gesetzt, index: true } }), fs, NOW).vault;
    expect(v.lines.find((l) => l.label === "Index")).toMatchObject({ value: "aus", hint: unsetHint("indexFile") });
    expect(v.lines.find((l) => l.label === "Inbox")!.hint).toBeUndefined();
  });
  it("„noch nicht gelesen“ (null) bleibt „–“, nur unset ist „aus“", () => {
    const v = fieldValues(feed({ vault: null, repos: null, day: null }), fs, NOW);
    expect(v.vault.lines.map((l) => l.value)).toEqual(["–", "–", "–"]);
    expect(v.repos.big).toBe("–");
    expect(v.loc.big).toBe("–");
    expect(UNSET_SHORT).toBe("aus");
  });
  it("Fokus: ohne Briefing-Ordner Hinweis und keine Zeilen", () => {
    const v = fieldValues(feed({ focus: ["a"], unset: { ...gesetzt, briefings: true } }), fs, NOW);
    expect(v.focus).toEqual([]);
    expect(v.focusHint).toBe(unsetHint("briefingsDir"));
    expect(fieldValues(feed({ focus: ["a"] }), fs, NOW).focusHint).toBeNull();
  });
  it("Repos, LOC und Commits: ohne Projektordner Hinweis", () => {
    const v = fieldValues(feed({ unset: { ...gesetzt, projects: true } }), fs, NOW);
    expect(v.repos).toMatchObject({ big: "aus", tone: "gray", list: [], hint: unsetHint("projectsRoot") });
    expect(v.loc.big).toBe("aus");
    expect(v.commits.big).toBe("aus");
    expect(v.loc.tooltip).toBe(unsetHint("projectsRoot"));
    expect(v.loc.hint).toBe(unsetHint("projectsRoot"));
    expect(v.commits.hint).toBe(unsetHint("projectsRoot"));
    const ok = fieldValues(feed({ repos: [] }), fs, NOW);
    expect(ok.repos.hint).toBeUndefined();
    expect(ok.loc.hint).toBeUndefined();
  });
  it("Radare: Liste aus dem Feed, höchstens zwei, Kürzel aus dem Namen, unset grau mit Hinweis", () => {
    const v = fieldValues(feed({ radars: [{ name: "Projekt-Monitor", lamp: "green" }, { name: "Depot", lamp: "unset" }, { name: "Dritter", lamp: "red" }] }), fs, NOW).radars;
    expect(v.lamps).toHaveLength(RADAR_SLOTS);
    expect(v.lamps[0]).toMatchObject({ id: "radar0", label: "Projekt-Monitor", short: "PR", tone: "green", text: "heute geschrieben" });
    expect(v.lamps[1]).toMatchObject({ label: "Depot", short: "DE", tone: "gray", text: `${UNSET_TEXT}: Einstellung „${UNSET_SETTING_LABEL.radars}“` });
    expect(v.hint).toBeNull();
  });
  it("keine Radare: leere Lampen und Hinweis", () => {
    const v = fieldValues(feed(), fs, NOW).radars;
    expect(v.lamps).toEqual([]);
    expect(v.hint).toBe(unsetHint("radars"));
  });
});

describe("Radar-Feld ohne Radare (Quelltext der Ansicht)", () => {
  const src = readFileSync(new URL("../src/host/cockpit-layout.ts", import.meta.url), "utf8");
  it("schreibt das kurze „aus“ im Stil der Radar-Beschriftung, nicht den langen Text", () => {
    const i = src.indexOf("cockpit-radars-unset");
    const block = src.slice(i - 100, i + 300);
    expect(block).toContain("UNSET_SHORT");
    expect(block).not.toContain("UNSET_TEXT");
    expect(block).toContain("aria-label");
    expect(block).toContain("title");
  });
});
