import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Setting, type App } from "obsidian";
import { DEFAULT_SETTINGS, invalidMessage, type CockpitSettings } from "../src/core/settings";
import type { Platform } from "../src/core/platform-path";
import type { SessionStore } from "../src/core/session-store";
import { hostPlatform } from "../src/host/host-platform";
import { CockpitSettingTab } from "../src/host/settings-tab";
import { ROOT } from "./helpers/files";
import { ON_WINDOWS } from "./helpers/platform";

// Einstellungsseite (Abend 34, Task 4): Zeilen, Reihenfolge und Steuerelemente bleiben beim Umbau von display() auf
// getSettingDefinitions(). Der Fake zeichnet in ein gemeinsames Protokoll auf; der Snapshot entstand gegen den alten Code.

const h = vi.hoisted(() => ({
  log: [] as unknown[],
  rows: [] as unknown[],
  divs: [] as unknown[],
  notices: [] as string[],
  pluginDirOf: vi.fn((): string | null => null),
  nativeInstalled: vi.fn((): boolean => false),
  downloadNative: vi.fn(),
  realDownloadDeps: vi.fn((_platform: string) => ({})),
  loaded: false,
}));

vi.mock("obsidian", () => {
  const log = h.log;
  const newDiv = () => {
    const div = { empty: vi.fn(), createDiv: vi.fn(() => newDiv()), remove: vi.fn() };
    h.divs.push(div);
    return div;
  };
  class InputEl {
    private t = "text";
    private s = "";
    private r = 0;
    listeners: Record<string, () => void> = {};
    get type() { return this.t; }
    set type(v: string) { this.t = v; log.push({ inputType: v }); }
    get step() { return this.s; }
    set step(v: string) { this.s = v; log.push({ inputStep: v }); }
    get rows() { return this.r; }
    set rows(v: number) { this.r = v; log.push({ inputRows: v }); }
    addEventListener(event: string, cb: () => void) { this.listeners[event] = cb; }
    addClass(cls: string) { log.push({ inputClass: cls }); }
  }
  class Comp {
    value: unknown = "";
    text = "";
    tooltip = "";
    changeCb?: (v: unknown) => void;
    clickCb?: () => unknown;
    inputEl = new InputEl();
    readonly kind: string;
    // Wie ToggleComponent in Obsidian (1.14.4, app.js): Startwert false, und setValue ruft den Callback, sobald sich der Wert ändert.
    constructor(kind: string) { this.kind = kind; if (kind === "toggle") this.value = false; }
    setValue(v: unknown) {
      const changed = this.value !== v;
      this.value = v;
      log.push({ value: v });
      if (this.kind === "toggle" && changed) this.changeCb?.(v);
      return this;
    }
    getValue() { return this.value; }
    onChange(cb: (v: unknown) => void) { this.changeCb = cb; return this; }
    setPlaceholder(p: string) { log.push({ placeholder: p }); return this; }
    setButtonText(t: string) { this.text = t; log.push({ button: t }); return this; }
    setDisabled(d: boolean) { if (d) log.push({ buttonDisabled: true }); return this; }
    setIcon() { return this; }
    setTooltip(t: string) { this.tooltip = t; return this; }
    onClick(cb: () => unknown) { this.clickCb = cb; return this; }
    addOption(v: string, l: string) { log.push({ option: [v, l] }); return this; }
  }
  class Setting {
    comps: Comp[] = [];
    lastName = "";
    disabledNow = false;
    private nameIndex = -1;
    descEl = { toggleClass: vi.fn() };
    settingEl = {
      addClass: (cls: string) => { log.push({ rowClass: cls }); },
      insertAdjacentElement: vi.fn(),
      createDiv: vi.fn(() => newDiv()),
      ownerDocument: { createDocumentFragment: () => ({ createDiv: () => newDiv() }) },
    };
    descs: string[] = [];
    readonly containerEl: unknown;
    constructor(containerEl: unknown) { this.containerEl = containerEl; h.rows.push(this); }
    setName(n: string) { this.lastName = n; this.nameIndex = log.length; log.push({ name: n }); return this; }
    setHeading() { log[this.nameIndex] = { heading: this.lastName }; return this; }
    setDesc(d: string) { this.descs.push(d); log.push({ desc: d }); return this; }
    setDisabled(d: boolean) { this.disabledNow = d; if (d) log.push({ disabled: true }); return this; }
    private add(kind: string, control: string, cb: (c: Comp) => unknown) {
      const c = new Comp(kind);
      this.comps.push(c);
      log.push({ control });
      cb(c);
      return this;
    }
    addToggle(cb: (c: Comp) => unknown) { return this.add("toggle", "toggle", cb); }
    addText(cb: (c: Comp) => unknown) { return this.add("text", "text", cb); }
    addTextArea(cb: (c: Comp) => unknown) { return this.add("textarea", "textarea", cb); }
    addDropdown(cb: (c: Comp) => unknown) { return this.add("dropdown", "dropdown", cb); }
    addButton(cb: (c: Comp) => unknown) { return this.add("button", "button", cb); }
    addExtraButton(cb: (c: Comp) => unknown) { return this.add("extra", "extra", cb); }
  }
  class PluginSettingTab {
    containerEl = { empty: vi.fn(), createDiv: vi.fn(() => newDiv()) };
    update = vi.fn();
    readonly app: unknown;
    readonly plugin: unknown;
    constructor(app: unknown, plugin: unknown) { this.app = app; this.plugin = plugin; }
    // Wie die Basisklasse in Obsidian: ohne Überschreibung keine Definitionen.
    getSettingDefinitions(): unknown[] { return []; }
  }
  class Notice { constructor(msg: string) { h.notices.push(msg); } }
  return { PluginSettingTab, Setting, Notice, requestUrl: vi.fn() };
});
vi.mock("../src/host/native-download", () => ({ downloadNative: h.downloadNative, nativeInstalled: h.nativeInstalled }));
vi.mock("../src/host/native-download-fetch", () => ({ pluginDirOf: h.pluginDirOf, realDownloadDeps: h.realDownloadDeps }));

type FakeComp = {
  kind: string; value: unknown; text: string; tooltip: string;
  changeCb?: (v: unknown) => void; clickCb?: () => unknown;
  inputEl: { type: string; listeners: Record<string, () => void> };
  setValue(v: unknown): unknown; getValue(): unknown;
};
type FakeRow = {
  lastName: string; comps: FakeComp[]; descs: string[]; descEl: { toggleClass: ReturnType<typeof vi.fn> };
  settingEl: { insertAdjacentElement: ReturnType<typeof vi.fn>; createDiv: ReturnType<typeof vi.fn> };
  disabledNow: boolean;
};
type Tab = CockpitSettingTab & { update: ReturnType<typeof vi.fn> };

const log = h.log;
let current: CockpitSettings;
const store = {
  settings: () => current,
  updateSetting: vi.fn((): { ok: true } | { ok: false; reason: string } => ({ ok: true })),
};

function makeTab(overrides: Partial<CockpitSettings> = {}, platform: Platform = hostPlatform()): Tab {
  current = {
    ...DEFAULT_SETTINGS,
    radars: [{ name: "Alpha", stateFile: "~/a/state.json" }, { name: "Beta", stateFile: "~/b/state.json" }],
    ...overrides,
  };
  const plugin = { manifest: { version: "9.9.9" }, nativeLoader: { isLoaded: () => h.loaded } };
  return new CockpitSettingTab({} as App, plugin as unknown as ConstructorParameters<typeof CockpitSettingTab>[1], store as unknown as SessionStore, platform) as Tab;
}

beforeEach(() => {
  log.length = 0;
  h.rows.length = 0;
  h.divs.length = 0;
  h.notices.length = 0;
  store.updateSetting.mockClear();
  store.updateSetting.mockImplementation(() => ({ ok: true }));
  h.pluginDirOf.mockClear();
  h.nativeInstalled.mockClear();
  h.downloadNative.mockReset();
  h.realDownloadDeps.mockClear();
  h.loaded = false;
});

type Item = { name?: string; type?: string; heading?: string; items?: Item[]; render?: (s: unknown, g?: unknown) => void | (() => void) };

// Zeichnet auf, was Obsidian beim Aufbau der Seite sähe: Überschrift je Gruppe, dann render jeder Zeile mit einem frischen Setting.
function record(tab: CockpitSettingTab): unknown[] {
  log.length = 0;
  const walk = (items: Item[]) => {
    for (const it of items) {
      if (it.type === "group") { log.push({ heading: it.heading }); walk(it.items ?? []); continue; }
      it.render?.(new Setting({} as HTMLElement));
    }
  };
  walk(tab.getSettingDefinitions() as Item[]);
  return [...log];
}

// Teilt das Protokoll an jedem { name } in Zeilen (Name -> Einträge der Zeile).
function rowsOf(entries: unknown[]): Record<string, unknown[]> {
  const rows: Record<string, unknown[]> = {};
  let cur: unknown[] | null = null;
  for (const e of entries as Record<string, unknown>[]) {
    if ("heading" in e) { cur = null; continue; }
    if ("name" in e) { cur = rows[e.name as string] = []; continue; }
    cur?.push(e);
  }
  return rows;
}

function findDef(defs: Item[], name: string): Item {
  for (const d of defs) {
    if (d.name === name && d.render) return d;
    const inner = d.items ? ((): Item | null => { try { return findDef(d.items, name); } catch { return null; } })() : null;
    if (inner) return inner;
  }
  throw new Error(`Definition nicht gefunden: ${name}`);
}

let lastRow: FakeRow;
let divsBeforeRender = 0;

// render der Definition mit diesem Namen, frischer Fake; liefert die Rückgabe von render (Aufräumfunktion).
function renderRow(tab: CockpitSettingTab, name: string): void | (() => void) {
  const def = findDef(tab.getSettingDefinitions() as Item[], name);
  lastRow = new Setting({} as HTMLElement) as unknown as FakeRow;
  divsBeforeRender = h.divs.length;
  return def.render!(lastRow, {});
}

function openRow(tab: CockpitSettingTab, name: string): FakeRow {
  renderRow(tab, name);
  return lastRow;
}

function clickToggle(tab: CockpitSettingTab, name: string, value: boolean): void {
  openRow(tab, name).comps.find((c) => c.kind === "toggle")!.changeCb!(value);
}

function clickExtra(tab: CockpitSettingTab, name: string): void {
  openRow(tab, name).comps.find((c) => c.kind === "extra")!.clickCb!();
}

function clickButton(tab: CockpitSettingTab, name: string, text: string): void {
  openRow(tab, name).comps.find((c) => c.kind === "button" && c.text === text)!.clickCb!();
}

// Wert des ersten Steuerelements dieser Art, nachdem render auf einem frischen Fake lief.
function valueOf(defs: Item[], name: string, kind: string): unknown {
  const row = new Setting({} as HTMLElement) as unknown as FakeRow;
  findDef(defs, name).render!(row, {});
  const value = row.comps.find((c) => c.kind === kind)!.getValue();
  return kind === "text" ? String(value) : value;
}

// Das erste Element, das render für die Fehlerliste anlegt (spätere sind deren Zeilen).
const lastErrorsDiv = () => h.divs[divsBeforeRender] as { remove: ReturnType<typeof vi.fn> };

describe("Einstellungsseite (Abend 34)", () => {
  // Der Text der Binärdatei-Zeile hängt an process.platform („für diesen Mac“ / „für diesen PC“): Der Stand gilt für den Mac,
  // also läuft der Test mit dieser Plattform auch unter Windows.
  it("Zeilen, Reihenfolge und Steuerelemente bleiben", async () => {
    await mitPlattform("darwin", false, async (tab) => {
      expect(record(tab)).toMatchSnapshot();
    });
  });

  // Abend 42, Task 2: Unter Windows heißt die Taste Ctrl. Der darwin-Snapshot oben bleibt unverändert; hier die Windows-Fassung als Literale.
  describe("Datei-Links: Taste je Plattform (Abend 42)", () => {
    const FILE_LINKS_DESC = (mod: string, save: string) =>
      `An: Dateipfade im Terminal (absolut, mit ~ oder relativ zum Startordner der Sitzung, auch mit :zeile) öffnen per ${mod}+Klick. Dateien im Vault als Tab, alle anderen in einem Fenster zum Lesen und Ändern (${save}+S speichert, Esc schließt). Ein einfacher Klick markiert weiter Text. Wirkt sofort.`;
    const FULLSCREEN_DESC = (copy: string) =>
      `An: Claude läuft im Vollbild-Modus, die Eingabezeile bleibt unten stehen und das Mausrad scrollt den Verlauf in Claude. Ziehen markiert in Claude und kopiert beim Loslassen, Shift+Ziehen markiert im Terminal (dann ${copy}+C). Suchen im Verlauf mit Ctrl+O und /. Der Scrollback des Terminals bleibt leer. Aus: klassisch, der Verlauf liegt im Scrollback. Wirkt für neu gestartete Sitzungen.`;

    it("win32: Name „Pfade per Ctrl+Klick öffnen“, Beschreibungen mit Ctrl+Klick, Ctrl+S und (dann Ctrl+C)", () => {
      const rows = rowsOf(record(makeTab({}, "win32")));
      expect(Object.keys(rows)).toContain("Pfade per Ctrl+Klick öffnen");
      expect(Object.keys(rows)).not.toContain("Pfade per Cmd+Klick öffnen");
      expect(rows["Pfade per Ctrl+Klick öffnen"]).toContainEqual({ desc: FILE_LINKS_DESC("Ctrl", "Ctrl") });
      expect(rows["Eingabezeile fest (Vollbild)"]).toContainEqual({ desc: FULLSCREEN_DESC("Ctrl") });
    });

    it("win32: Gegentest: in keinem Namen und keiner Beschreibung steht noch Cmd", () => {
      const text = JSON.stringify(record(makeTab({}, "win32")));
      expect(text).not.toContain("Cmd");
      expect(text).toContain("Ctrl+Klick");
    });

    it("darwin: Cmd bleibt in Name und Beschreibungen (auch mit ausdrücklicher Plattform)", () => {
      const rows = rowsOf(record(makeTab({}, "darwin")));
      expect(rows["Pfade per Cmd+Klick öffnen"]).toContainEqual({ desc: FILE_LINKS_DESC("Cmd", "Cmd") });
      expect(rows["Eingabezeile fest (Vollbild)"]).toContainEqual({ desc: FULLSCREEN_DESC("Cmd") });
      expect(Object.keys(rows)).not.toContain("Pfade per Ctrl+Klick öffnen");
    });

    it("Abend 43: makeTab() ohne Plattform gilt die des Rechners: unter Windows die Windows-Texte, sonst die Mac-Texte", () => {
      const rows = rowsOf(record(makeTab()));
      expect(Object.keys(rows).includes("Pfade per Ctrl+Klick öffnen")).toBe(ON_WINDOWS);
      expect(Object.keys(rows).includes("Pfade per Cmd+Klick öffnen")).toBe(!ON_WINDOWS);
      expect(rows[ON_WINDOWS ? "Pfade per Ctrl+Klick öffnen" : "Pfade per Cmd+Klick öffnen"]).toContainEqual({ desc: FILE_LINKS_DESC(ON_WINDOWS ? "Ctrl" : "Cmd", ON_WINDOWS ? "Ctrl" : "Cmd") });
    });

    it("die Plattform kommt vom Konstruktor, nicht von process.platform", () => {
      const original = Object.getOwnPropertyDescriptor(process, "platform")!;
      Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
      try {
        expect(Object.keys(rowsOf(record(makeTab({}, "win32"))))).toContain("Pfade per Ctrl+Klick öffnen");
      } finally {
        Object.defineProperty(process, "platform", original);
      }
    });
  });

  // Abend 43, Task 2: Einstellungsseite unter Windows. Die darwin-Texte stehen als Literale, damit der Mac unverändert bleibt.
  describe("Windows-Texte und Sperren (Abend 43)", () => {
    const USAGE_MAC = "So oft liest die Karte „Usage“ den Schnappschuss der Statuszeile und die heutigen Transkripte (10 bis 3600), auch bei geschlossenem Dashboard.";
    const TOKENS_MAC = "Schreibt nach jedem Zählerlauf die heutigen Output-Tokens nach ~/.claude/cockpit/tokens-today.json. Aus: Das Cockpit zählt weiter, die Statuszeile zeigt dann nur noch die letzte Summe mit ihrem Alter.";
    const BANNER_SECONDS_MAC = "So lange bleibt das macOS-Banner stehen (1 bis 60), dann verschwindet es von selbst und steht auch nicht in der Mitteilungszentrale. Je Sitzung gibt es höchstens ein Banner: Ein neues ersetzt das alte.";
    const descs = (tab: CockpitSettingTab, name: string) => rowsOf(record(tab))[name]!.filter((e) => "desc" in (e as object)).map((e) => (e as { desc: string }).desc);

    it("win32: Usage-Abstand endet auf den Hinweis", () => {
      const [d] = descs(makeTab({}, "win32"), "Usage-Abstand (Sekunden)");
      expect(d).toBe(`${USAGE_MAC} Unter Windows noch ohne Statuszeile, Limits fehlen.`);
    });

    it("win32: Tokens für die Statuszeile ist gesperrt und endet auf den Sperrtext", () => {
      const rows = rowsOf(record(makeTab({}, "win32")));
      const row = rows["Tokens für die Statuszeile schreiben"]!;
      expect(row).toContainEqual({ desc: `${TOKENS_MAC} Unter Windows nicht verfügbar: Die Statuszeile gibt es dort noch nicht.` });
      expect(row).toContainEqual({ disabled: true });
    });

    it("win32: ein gespeichertes writeTokensFile: true bleibt nach display() und einem Bedienversuch true", () => {
      // Der Mock schreibt wie der echte Speicher in current; sonst könnte die Zusicherung unten nie fallen.
      store.updateSetting.mockImplementation(((key: keyof CockpitSettings, value: never) => { (current as unknown as Record<string, unknown>)[key] = value; return { ok: true }; }) as never);
      const tab = makeTab({ writeTokensFile: true }, "win32");
      const row = openRow(tab, "Tokens für die Statuszeile schreiben");
      const toggle = row.comps.find((c) => c.kind === "toggle")!;
      expect(toggle.getValue()).toBe(true);
      // Bedienversuch: Ein gesperrter Schalter nimmt keine Eingabe an. Fällt die Sperre weg, speichert der Klick false.
      if (!row.disabledNow) toggle.changeCb!(false);
      record(tab);
      expect(current.writeTokensFile).toBe(true);
      expect(row.disabledNow).toBe(true);
    });

    it("win32: Klangdatei und Banner tragen die Windows-Texte, ohne macOS und afplay", () => {
      const rows = rowsOf(record(makeTab({}, "win32")));
      expect(rows["Klangdatei"]).toContainEqual({ desc: "Pfad zur Klangdatei (WAV oder MP3), abgespielt in Obsidian. Leer oder Mac-Pfad = Windows-Ton." });
      expect(Object.keys(rows)).toContain("Windows-Benachrichtigung");
      expect(Object.keys(rows)).not.toContain("macOS-Banner");
      expect(rows["Banner ausblenden nach (Sekunden)"]).toContainEqual({
        desc: "So lange bleibt die Benachrichtigung stehen (1 bis 60), dann verschwindet sie von selbst. Je Sitzung gibt es höchstens ein Banner: Ein neues ersetzt das alte.",
      });
      expect(JSON.stringify(rows)).not.toContain("Mitteilungszentrale");
      expect(JSON.stringify(rows)).not.toContain("afplay");
    });

    it("win32: das Klangdatei-Feld zeigt den Windows-Ton als Platzhalter (SystemRoot)", () => {
      const old = process.env.SystemRoot;
      process.env.SystemRoot = "D:\\Win";
      try {
        const rows = rowsOf(record(makeTab({}, "win32")));
        expect(rows["Klangdatei"]).toContainEqual({ placeholder: "D:\\Win\\Media\\Windows Notify System Generic.wav" });
      } finally {
        if (old === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = old;
      }
    });

    it("win32: der Rechte-Bypass ist vorhanden und nicht gesperrt", () => {
      const row = rowsOf(record(makeTab({}, "win32")))["Rechteabfragen überspringen"]!;
      expect(row).toBeDefined();
      expect(row).not.toContainEqual({ disabled: true });
      expect(openRow(makeTab({}, "win32"), "Rechteabfragen überspringen").disabledNow).toBe(false);
    });

    // Fix-Welle, Spec Bauweg 10 geprüft: Diese Schwellen wirken auch ohne Statuszeile und bleiben unter Windows frei.
    // contextWarn/contextHandoff färben das Kontext-Instrument (cockpit-panels.ts), clearableMin* steuern den Stop-Hook
    // (hooks/clearable-banner.py); thresholds.json wird deshalb auch unter Windows geschrieben.
    it.each([
      "Kontext: Warnschwelle (Tokens)", "Kontext: Handoff-Schwelle (Tokens)",
      "Handoff frühestens ab Kontext (%)", "Handoff frühestens ab Nachrichten",
    ])("win32: %s ist nicht gesperrt und trägt dieselbe Beschreibung wie auf dem Mac", (name) => {
      const win = rowsOf(record(makeTab({}, "win32")))[name]!;
      const mac = rowsOf(record(makeTab({}, "darwin")))[name]!;
      expect(win).toBeDefined();
      expect(win).not.toContainEqual({ disabled: true });
      expect(win).toEqual(mac);
      expect(openRow(makeTab({}, "win32"), name).disabledNow).toBe(false);
    });

    it("darwin: alle vier Felder wörtlich wie heute, ohne Sperre, ohne Platzhalter", () => {
      const rows = rowsOf(record(makeTab({}, "darwin")));
      expect(rows["Usage-Abstand (Sekunden)"]).toContainEqual({ desc: USAGE_MAC });
      expect(rows["Tokens für die Statuszeile schreiben"]).toContainEqual({ desc: TOKENS_MAC });
      expect(rows["Tokens für die Statuszeile schreiben"]).not.toContainEqual({ disabled: true });
      expect(rows["Klangdatei"]).toContainEqual({ desc: "Pfad zur Klangdatei, abgespielt mit afplay." });
      expect(rows["Klangdatei"]!.some((e) => "placeholder" in (e as object))).toBe(false);
      expect(Object.keys(rows)).toContain("macOS-Banner");
      expect(Object.keys(rows)).not.toContain("Windows-Benachrichtigung");
      expect(rows["Banner ausblenden nach (Sekunden)"]).toContainEqual({ desc: BANNER_SECONDS_MAC });
    });
  });

  it("Textfeld: speichert bei change, ungültig zeigt roten Grund, blur setzt den geltenden Wert zurück", () => {
    const tab = makeTab();
    const row = openRow(tab, "Projektordner");
    const field = row.comps.find((c) => c.kind === "text")!;
    store.updateSetting.mockImplementation(() => ({ ok: false, reason: "zu lang" }));
    field.setValue("neu");
    field.inputEl.listeners.change!();
    expect(store.updateSetting).toHaveBeenCalledWith("projectsRoot", "neu");
    expect(row.descEl.toggleClass).toHaveBeenLastCalledWith("cockpit-setting-error", true);
    expect(row.descs.at(-1)).toBe(invalidMessage("zu lang", current.projectsRoot));
    field.inputEl.listeners.blur!();
    expect(field.getValue()).toBe(String(current.projectsRoot));
  });

  it("Zahlfeld: gültig speichert die Zahl und zeigt die normale Beschreibung, leer geht als NaN an die Prüfung", () => {
    const tab = makeTab();
    const row = openRow(tab, "Schriftgröße");
    const field = row.comps.find((c) => c.kind === "text")!;
    field.setValue("14");
    field.inputEl.listeners.change!();
    expect(store.updateSetting).toHaveBeenLastCalledWith("fontSize", 14);
    expect(row.descEl.toggleClass).toHaveBeenLastCalledWith("cockpit-setting-error", false);
    expect(row.descs.at(-1)).toBe("Schriftgröße im Terminal in Pixeln (8 bis 32). Wirkt sofort auf offene Terminals.");
    field.setValue("");
    field.inputEl.listeners.change!();
    expect(Number.isNaN((store.updateSetting.mock.calls.at(-1) as unknown as [string, number])[1])).toBe(true);
  });

  it("Dropdown speichert sofort, Textarea der Suchen speichert bei change", () => {
    const tab = makeTab();
    const choice = openRow(tab, "Dashboard-Ansicht").comps.find((c) => c.kind === "dropdown")!;
    choice.changeCb!("list");
    expect(store.updateSetting).toHaveBeenLastCalledWith("dashboardLayout", "list");
    const area = openRow(tab, "Suchen").comps.find((c) => c.kind === "textarea")!;
    area.setValue("a | stars | 3");
    area.inputEl.listeners.change!();
    expect(store.updateSetting).toHaveBeenLastCalledWith("researchSearches", "a | stars | 3");
  });

  it("Sitzungen: „Reihenfolge in „Neue Sitzung““ steht direkt nach dem Projektordner, mit Name, Beschreibung und beiden Optionen (Nachtrag 40a)", () => {
    const NAME = "Reihenfolge in „Neue Sitzung“";
    const DESC = "Zuletzt benutzt: Projektordner mit der jüngsten Claude-Unterhaltung zuerst, nie benutzte alphabetisch darunter. Alphabetisch: wie bisher. „Weiter“, Vault und Home bleiben oben.";
    const tab = makeTab();
    const sitzungen = (tab.getSettingDefinitions() as Item[]).find((d) => d.heading === "Sitzungen")!;
    const names = (sitzungen.items ?? []).map((i) => i.name);
    expect(names[names.indexOf("Projektordner") + 1]).toBe(NAME);
    const row = rowsOf(record(tab))[NAME]!;
    expect(row).toContainEqual({ desc: DESC });
    expect(row).toContainEqual({ control: "dropdown" });
    expect(row.filter((e) => "option" in (e as object))).toEqual([{ option: ["recent", "Zuletzt benutzt"] }, { option: ["alpha", "Alphabetisch"] }]);
    openRow(tab, NAME).comps.find((c) => c.kind === "dropdown")!.changeCb!("alpha");
    expect(store.updateSetting).toHaveBeenLastCalledWith("newSessionOrder", "alpha");
  });

  it("Sitzungen: „Ausgeblendete Ordner“ steht direkt nach „Reihenfolge in „Neue Sitzung““ (vor „Shell unter Windows“), mit Beschreibung, auf jeder Plattform, speichert hiddenProjectDirs (Nachtrag Abend 41)", () => {
    const NAME = "Ausgeblendete Ordner";
    const DESC = "Diese Unterordner des Projektordners erscheinen nicht in „Neue Sitzung“. Mehrere mit Komma trennen. Leer = alle zeigen.";
    const original = Object.getOwnPropertyDescriptor(process, "platform")!;
    try {
      for (const plattform of ["darwin", "win32"]) {
        Object.defineProperty(process, "platform", { value: plattform, configurable: true });
        const tab = makeTab();
        const sitzungen = (tab.getSettingDefinitions() as Item[]).find((d) => d.heading === "Sitzungen")!;
        const names = (sitzungen.items ?? []).map((i) => i.name);
        expect(names[names.indexOf("Reihenfolge in „Neue Sitzung“") + 1], plattform).toBe(NAME);
        if (plattform === "win32") expect(names[names.indexOf(NAME) + 1]).toBe("Shell unter Windows");
        const row = rowsOf(record(tab))[NAME]!;
        expect(row).toContainEqual({ desc: DESC });
        expect(row).toContainEqual({ control: "text" });
        const field = openRow(tab, NAME).comps.find((c) => c.kind === "text")!;
        field.setValue("worktrees, tmp");
        field.inputEl.listeners.change!();
        expect(store.updateSetting).toHaveBeenLastCalledWith("hiddenProjectDirs", "worktrees, tmp");
      }
    } finally {
      Object.defineProperty(process, "platform", original);
    }
  });

  describe("Shell unter Windows (Abend 41)", () => {
    const NAME = "Shell unter Windows";
    const DESC = "Leer = automatisch: PowerShell 7 (pwsh.exe), sonst Windows PowerShell.";
    const sitzungenNamen = (tab: CockpitSettingTab) => {
      const sitzungen = (tab.getSettingDefinitions() as Item[]).find((d) => d.heading === "Sitzungen")!;
      return (sitzungen.items ?? []).map((i) => i.name);
    };
    const mitPlattformSync = <T,>(plattform: string, f: () => T): T => {
      const original = Object.getOwnPropertyDescriptor(process, "platform")!;
      Object.defineProperty(process, "platform", { value: plattform, configurable: true });
      try { return f(); } finally { Object.defineProperty(process, "platform", original); }
    };

    it("win32: Textfeld im Abschnitt Sitzungen nach „Reihenfolge in „Neue Sitzung““, mit Beschreibung, speichert windowsShell", () => {
      mitPlattformSync("win32", () => {
        const tab = makeTab();
        const names = sitzungenNamen(tab);
        expect(names).toContain(NAME);
        expect(names.indexOf(NAME)).toBeGreaterThan(names.indexOf("Reihenfolge in „Neue Sitzung“"));
        const row = rowsOf(record(tab))[NAME]!;
        expect(row).toContainEqual({ desc: DESC });
        expect(row).toContainEqual({ control: "text" });
        const field = openRow(tab, NAME).comps.find((c) => c.kind === "text")!;
        field.setValue("D:\\tools\\nu.exe");
        field.inputEl.listeners.change!();
        expect(store.updateSetting).toHaveBeenLastCalledWith("windowsShell", "D:\\tools\\nu.exe");
      });
    });

    it("darwin: das Feld fehlt", () => {
      mitPlattformSync("darwin", () => {
        expect(sitzungenNamen(makeTab())).not.toContain(NAME);
      });
    });

    // Abend 42, Ruling 6: Die Klasse hat genau eine Plattformquelle, den Konstruktor.
    it("die Plattform kommt vom Konstruktor: win32 zeigt das Feld auch auf einem Mac, darwin versteckt es auch unter Windows", () => {
      mitPlattformSync("darwin", () => {
        expect(sitzungenNamen(makeTab({}, "win32"))).toContain(NAME);
      });
      mitPlattformSync("win32", () => {
        expect(sitzungenNamen(makeTab({}, "darwin"))).not.toContain(NAME);
      });
    });
  });

  it("kein display() mehr", () => {
    expect(Object.prototype.hasOwnProperty.call(CockpitSettingTab.prototype, "display")).toBe(false);
  });

  it("jede Zeile hat render und (außer der Hinweiszeile der Radare) einen Namen für den Suchindex", () => {
    const leaves: Item[] = [];
    const walk = (items: Item[]) => { for (const it of items) { if (it.type === "group") walk(it.items ?? []); else leaves.push(it); } };
    walk(makeTab().getSettingDefinitions() as Item[]);
    expect(leaves.length).toBeGreaterThan(50);
    expect(leaves.every((l) => typeof l.render === "function")).toBe(true);
    expect(leaves.filter((l) => !l.name).length).toBe(1);
  });

  it("Diffs gesperrt, wenn die IDE-Brücke aus ist", () => {
    const tab = makeTab({ ideBridge: false });
    const rows = rowsOf(record(tab));
    expect(rows["Diffs in Obsidian zeigen"]).toContainEqual({ disabled: true });
  });

  it("Diffs nicht gesperrt, wenn die IDE-Brücke an ist", () => {
    const rows = rowsOf(record(makeTab({ ideBridge: true })));
    expect(rows["Diffs in Obsidian zeigen"]).toBeDefined();
    expect(rows["Diffs in Obsidian zeigen"]).not.toContainEqual({ disabled: true });
  });

  it("Umschalten der IDE-Brücke zeichnet neu", () => {
    const tab = makeTab();
    clickToggle(tab, "IDE-Brücke für Claude-Sitzungen", false);
    expect(store.updateSetting).toHaveBeenCalledWith("ideBridge", false);
    expect(tab.update).toHaveBeenCalledTimes(1);
  });

  // Obsidians setValue ruft den Callback bei geändertem Wert. Käme onChange vor setValue, löste jedes Zeichnen der IDE-Brücke
  // updateSetting und update() aus, und update() zeichnete wieder: Endlosschleife.
  it("Zeichnen der IDE-Brücke schreibt nichts und zeichnet nicht neu, erst ein echter Wechsel tut es", () => {
    const tab = makeTab({ ideBridge: true });
    const row = openRow(tab, "IDE-Brücke für Claude-Sitzungen");
    expect(store.updateSetting).not.toHaveBeenCalled();
    expect(tab.update).not.toHaveBeenCalled();
    // Gegenprobe: Der Fake ruft den Callback bei einem Wechsel, sonst prüfte der Test nichts.
    row.comps.find((c) => c.kind === "toggle")!.setValue(false);
    expect(store.updateSetting).toHaveBeenCalledWith("ideBridge", false);
    expect(tab.update).toHaveBeenCalledTimes(1);
  });

  it("Umschalten eines anderen Schalters zeichnet nicht neu", () => {
    const tab = makeTab();
    clickToggle(tab, "Unterhaltung fortsetzen", false);
    expect(tab.update).not.toHaveBeenCalled();
  });

  it("Vorgabe-Knopf zeichnet über update() neu", () => {
    const tab = makeTab();
    clickExtra(tab, "Schriftgröße");
    expect(store.updateSetting).toHaveBeenCalledWith("fontSize", DEFAULT_SETTINGS.fontSize);
    expect(tab.update).toHaveBeenCalledTimes(1);
  });

  it("Vorgabe-Knopf nennt den Grund, wenn die Vorgabe abgelehnt wird, und zeichnet trotzdem neu", () => {
    const tab = makeTab();
    store.updateSetting.mockImplementation(() => ({ ok: false, reason: "Paar passt nicht" }));
    clickExtra(tab, "Kontext: Warnschwelle (Tokens)");
    expect(h.notices).toEqual(["Vorgabe geht nicht: Paar passt nicht"]);
    expect(tab.update).toHaveBeenCalledTimes(1);
  });

  it("Radare: eine Zeile je Radar plus Hinzufügen, Entfernen und Hinzufügen zeichnen neu", () => {
    const tab = makeTab();
    const names = record(tab).filter((e) => "name" in (e as object)).map((e) => (e as { name: string }).name);
    expect(names.filter((n) => /^Radar \d$/.test(n))).toEqual(["Radar 1", "Radar 2"]);
    expect(names).toContain("Radar hinzufügen");
    clickButton(tab, "Radar 1", "Entfernen");
    clickButton(tab, "Radar hinzufügen", "Radar hinzufügen");
    expect(tab.update).toHaveBeenCalledTimes(2);
  });

  it("Radare: die Liste kommt bei jedem getSettingDefinitions() frisch aus dem Store", () => {
    const tab = makeTab();
    current.radars = [{ name: "Nur", stateFile: "~/n.json" }];
    const names = record(tab).filter((e) => "name" in (e as object)).map((e) => (e as { name: string }).name);
    expect(names.filter((n) => /^Radar \d$/.test(n))).toEqual(["Radar 1"]);
  });

  it("render liest den aktuellen Wert, nicht den beim Definieren", () => {
    const tab = makeTab();
    const defs = tab.getSettingDefinitions() as Item[];
    current.fontSize = 21;
    expect(valueOf(defs, "Schriftgröße", "text")).toBe("21");
  });

  it("render liest den aktuellen Wert auch bei Text, Schalter, Auswahl und Suchen-Feld", () => {
    const tab = makeTab({ projectsRoot: "~/alt", reopenAfterDisable: false, dashboardLayout: "cockpit", researchSearches: "alt" });
    const defs = tab.getSettingDefinitions() as Item[];
    Object.assign(current, { projectsRoot: "~/neu", reopenAfterDisable: true, dashboardLayout: "list", researchSearches: "neu" });
    expect(valueOf(defs, "Projektordner", "text")).toBe("~/neu");
    expect(valueOf(defs, "Tabs nach dem Abschalten wieder öffnen", "toggle")).toBe(true);
    expect(valueOf(defs, "Dashboard-Ansicht", "dropdown")).toBe("list");
    expect(valueOf(defs, "Suchen", "textarea")).toBe("neu");
  });

  it("Radare: render liest Eintrag und Platzstand frisch, nicht den beim Definieren", () => {
    const tab = makeTab({ radars: [{ name: "Alt", stateFile: "~/alt.json" }] });
    const defs = tab.getSettingDefinitions() as Item[];
    current.radars = [{ name: "Neu", stateFile: "~/neu.json" }, { name: "Zwei", stateFile: "~/zwei.json" }];
    const row = new Setting({} as HTMLElement) as unknown as FakeRow;
    findDef(defs, "Radar 1").render!(row, {});
    expect(row.comps.filter((c) => c.kind === "text").map((c) => c.getValue())).toEqual(["Neu", "~/neu.json"]);
    log.length = 0;
    findDef(defs, "Radar hinzufügen").render!(new Setting({} as HTMLElement), {});
    expect(log).toContainEqual({ buttonDisabled: true });
  });

  it("Fehlerliste der Suchen räumt beim Neuzeichnen auf", () => {
    const tab = makeTab();
    const cleanup = renderRow(tab, "Suchen");
    expect(typeof cleanup).toBe("function");
    const errors = lastErrorsDiv();
    expect(errors.remove).not.toHaveBeenCalled();
    cleanup?.();
    expect(errors.remove).toHaveBeenCalled();
  });

  // Obsidian setzt nach render die Kinder der Gruppe auf genau die Zeilen (Node.setChildrenInPlace, gelesen in app.js 1.14.4).
  // Ein Nachbar der Zeile (insertAdjacentElement) würde sofort entfernt; die Fehlerliste muss ein Kind der Zeile sein.
  it("Fehlerliste der Suchen hängt als Kind in der Zeile, nicht als Nachbar dahinter", () => {
    const tab = makeTab();
    renderRow(tab, "Suchen");
    expect(lastRow.settingEl.createDiv).toHaveBeenCalledWith({ cls: "cockpit-setting-error" });
    expect(lastRow.settingEl.insertAdjacentElement).not.toHaveBeenCalled();
  });

  it("Fehlerliste liegt im CSS unter dem Feld in voller Breite und ist leer ausgeblendet", () => {
    const css = readFileSync(join(ROOT, "src/styles.css"), "utf8");
    expect(css).toMatch(/\.cockpit-research-setting > \.cockpit-setting-error \{[^}]*flex:\s*1 1 100%/);
    expect(css).toMatch(/\.cockpit-research-setting > \.cockpit-setting-error:empty \{[^}]*display:\s*none/);
  });

  // Obsidian zeichnet eine Zeile bei update() im selben Setting neu (nur die Bedienspalte wird geleert, gelesen in app.js 1.14.4).
  it("Diffs bleibt nach dem Neuzeichnen im selben Setting nicht gesperrt, wenn die IDE-Brücke wieder an ist", () => {
    const tab = makeTab({ ideBridge: false });
    const def = findDef(tab.getSettingDefinitions() as Item[], "Diffs in Obsidian zeigen");
    const row = new Setting({} as HTMLElement) as unknown as FakeRow;
    def.render!(row, {});
    expect(row.disabledNow).toBe(true);
    current.ideBridge = true;
    def.render!(row, {});
    expect(row.disabledNow).toBe(false);
  });

  it("Roter Grund der vorigen Eingabe bleibt nach dem Neuzeichnen im selben Setting nicht stehen", () => {
    const tab = makeTab();
    const defs = tab.getSettingDefinitions() as Item[];
    for (const name of ["Schriftgröße", "Projektordner", "Radar hinzufügen"]) {
      const def = findDef(defs, name);
      const row = new Setting({} as HTMLElement) as unknown as FakeRow;
      def.render!(row, {});
      store.updateSetting.mockImplementation(() => ({ ok: false, reason: "geht nicht" }));
      if (name === "Radar hinzufügen") row.comps[0]!.clickCb!();
      else row.comps[0]!.inputEl.listeners.change!();
      expect(row.descEl.toggleClass).toHaveBeenLastCalledWith("cockpit-setting-error", true);
      def.render!(row, {});
      expect(row.descEl.toggleClass).toHaveBeenLastCalledWith("cockpit-setting-error", false);
      store.updateSetting.mockImplementation(() => ({ ok: true }));
    }
  });

  it("Namen sind je Gruppe eindeutig (Obsidian bildet daraus den Schlüssel der Zeile)", () => {
    const groups = (makeTab().getSettingDefinitions() as Item[]).filter((d) => d.type === "group");
    expect(groups.map((g) => g.heading)).toEqual(["Sitzungen", "Binärdateien", "Terminal", "Benachrichtigung", "Telegram", "Dashboard", "Radare", "Research"]);
    for (const g of groups) {
      const names = (g.items ?? []).map((i) => i.name).filter((n): n is string => !!n);
      expect(new Set(names).size, g.heading).toBe(names.length);
    }
  });

  it("getSettingDefinitions() liest weder Plugin-Ordner noch Installationsstand, beides erst in render", () => {
    const tab = makeTab();
    tab.getSettingDefinitions();
    expect(h.pluginDirOf).not.toHaveBeenCalled();
    expect(h.nativeInstalled).not.toHaveBeenCalled();
    // Gegenprobe: render ruft beide, sonst zählte der Test nichts.
    h.pluginDirOf.mockReturnValueOnce("/plugin");
    renderRow(tab, "Terminal-Binärdateien (node-pty)");
    expect(h.pluginDirOf).toHaveBeenCalledTimes(1);
    expect(h.nativeInstalled).toHaveBeenCalledTimes(1);
  });

  it("Binärdateien laden: Ergebnis als Notice, danach zeichnet update() die Seite neu", async () => {
    const tab = makeTab();
    h.pluginDirOf.mockReturnValue("/plugin");
    h.downloadNative.mockResolvedValue({ ok: true, files: 3 });
    clickButton(tab, "Terminal-Binärdateien (node-pty)", "Binärdateien laden");
    await vi.waitFor(() => expect(tab.update).toHaveBeenCalledTimes(1));
    expect(h.notices).toEqual(["Binärdateien geladen (3 Dateien). Neue Sitzungen starten jetzt."]);
    h.pluginDirOf.mockReturnValue(null);
  });

  // Der Host liest process.platform erst in render; die Attrappe gilt für Aufbau und Klick und wird danach zurückgelegt.
  async function mitPlattform(plattform: string, geladen: boolean, ablauf: (tab: Tab) => Promise<void>): Promise<void> {
    const original = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: plattform, configurable: true });
    try {
      h.loaded = geladen;
      await ablauf(makeTab());
    } finally {
      Object.defineProperty(process, "platform", original);
    }
  }

  it("Binärdateien: Hinweis und Download-Abhängigkeiten folgen der Plattform des Konstruktors, nicht process.platform", async () => {
    h.pluginDirOf.mockReturnValue("/plugin");
    h.downloadNative.mockResolvedValue({ ok: true, files: 3 });
    const original = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    try {
      const tab = makeTab({}, "win32");
      clickButton(tab, "Terminal-Binärdateien (node-pty)", "Binärdateien laden");
      await vi.waitFor(() => expect(tab.update).toHaveBeenCalledTimes(1));
      expect(lastRow.descs.some((d) => d.includes("für diesen PC"))).toBe(true);
      expect(h.realDownloadDeps).toHaveBeenCalledWith("win32");
    } finally {
      Object.defineProperty(process, "platform", original);
      h.pluginDirOf.mockReturnValue(null);
    }
  });

  it("Binärdateien laden: Plattform und Stand des Laders bestimmen Beschreibung, Abhängigkeiten und Notice", async () => {
    h.pluginDirOf.mockReturnValue("/plugin");
    h.downloadNative.mockResolvedValue({ ok: true, files: 3 });
    const neu = "Binärdateien geladen (3 Dateien). Neue Sitzungen starten jetzt.";
    const neustart = "Binärdateien geladen (3 Dateien). Obsidian neu starten, damit sie gelten.";
    for (const [plattform, geladen, hinweis, notice] of [
      ["win32", true, "für diesen PC", neustart],
      ["win32", false, "für diesen PC", neu],
      ["darwin", true, "für diesen Mac", neu],
      ["darwin", false, "für diesen Mac", neu],
    ] as const) {
      h.notices.length = 0;
      h.realDownloadDeps.mockClear();
      await mitPlattform(plattform, geladen, async (tab) => {
        clickButton(tab, "Terminal-Binärdateien (node-pty)", "Binärdateien laden");
        await vi.waitFor(() => expect(tab.update).toHaveBeenCalledTimes(1));
        expect(lastRow.descs.some((d) => d.includes(hinweis)), `${plattform}: ${hinweis}`).toBe(true);
      });
      expect(h.notices, `${plattform}, geladen ${geladen}`).toEqual([notice]);
      expect(h.realDownloadDeps).toHaveBeenCalledWith(plattform);
    }
    h.pluginDirOf.mockReturnValue(null);
  });
});

describe("Ausschluss-Schalter (Abend 33)", () => {
  const SPERRE = "Ausgeschlossene Dateien für Claude sperren";
  const SANDBOX = "Auch Shell-Befehle sperren (Sandbox)";

  it("beide Schalter im Abschnitt Terminal direkt nach „Rechteabfragen überspringen“ und vor der IDE-Brücke", () => {
    const terminal: string[] = [];
    let inTerminal = false;
    for (const e of record(makeTab()) as Record<string, unknown>[]) {
      if ("heading" in e) { inTerminal = e.heading === "Terminal"; continue; }
      if (inTerminal && "name" in e) terminal.push(e.name as string);
    }
    const i = terminal.indexOf("Rechteabfragen überspringen");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(terminal.slice(i, i + 4)).toEqual(["Rechteabfragen überspringen", SPERRE, SANDBOX, "IDE-Brücke für Claude-Sitzungen"]);
  });

  it("Sandbox gesperrt, wenn die Sperre aus ist, frei, wenn sie an ist", () => {
    // darwin ausdrücklich: unter Windows ist der Schalter immer gesperrt (eigene Tests unten)
    expect(rowsOf(record(makeTab({ claudeExclusion: false }, "darwin")))[SANDBOX]).toContainEqual({ disabled: true });
    const an = rowsOf(record(makeTab({ claudeExclusion: true }, "darwin")))[SANDBOX];
    expect(an).toBeDefined();
    expect(an).not.toContainEqual({ disabled: true });
  });

  // Abend 42, Task 5: Unter Windows hat Claude Code keine Sandbox; der Schalter ist gesperrt, der gespeicherte Wert bleibt.
  describe("Sandbox-Schalter je Plattform (Abend 42)", () => {
    const GRUND = "Unter Windows nicht verfügbar: Claude Code hat dort keine Sandbox.";
    const AN = { claudeExclusion: true, claudeExclusionSandbox: true };
    const descOf = (rows: Record<string, unknown[]>) => (rows[SANDBOX].find((x) => "desc" in (x as object)) as { desc: string }).desc;

    it("win32: gesperrt (auch bei eingeschalteter Sperre), Beschreibung endet mit dem Grund", () => {
      const rows = rowsOf(record(makeTab(AN, "win32")));
      expect(rows[SANDBOX]).toContainEqual({ disabled: true });
      expect(descOf(rows).endsWith(` ${GRUND}`)).toBe(true);
      expect(descOf(rows)).toContain("Gilt ab dem nächsten Sitzungsstart.");
    });

    it("win32: der gespeicherte Wert bleibt unverändert (nichts wird beim Zeichnen geschrieben)", () => {
      const tab = makeTab(AN, "win32");
      record(tab);
      expect(store.updateSetting).not.toHaveBeenCalled();
      expect(current.claudeExclusionSandbox).toBe(true);
      const row = rowsOf(record(tab))[SANDBOX];
      expect(row).toContainEqual({ control: "toggle" });
    });

    it("Abend 43: makeTab() ohne Plattform gilt die des Rechners: unter Windows gesperrt mit Grund, sonst frei", () => {
      const rows = rowsOf(record(makeTab(AN)));
      expect(rows[SANDBOX].some((x) => (x as object) && "disabled" in (x as object))).toBe(ON_WINDOWS);
      expect(descOf(rows).endsWith(` ${GRUND}`)).toBe(ON_WINDOWS);
    });

    it("darwin: Beschreibung ohne den Grund, frei bei eingeschalteter Sperre (Snapshot unverändert)", () => {
      const rows = rowsOf(record(makeTab(AN, "darwin")));
      expect(descOf(rows)).not.toContain("Windows");
      expect(descOf(rows).endsWith("Gilt ab dem nächsten Sitzungsstart.")).toBe(true);
      expect(rows[SANDBOX]).not.toContainEqual({ disabled: true });
    });

    it("die Plattform kommt vom Konstruktor, nicht von process.platform", () => {
      const original = Object.getOwnPropertyDescriptor(process, "platform")!;
      Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
      try {
        expect(rowsOf(record(makeTab(AN, "win32")))[SANDBOX]).toContainEqual({ disabled: true });
      } finally {
        Object.defineProperty(process, "platform", original);
      }
    });
  });

  it("Umschalten der Sperre speichert und zeichnet über update() neu, Umschalten der Sandbox zeichnet nicht neu", () => {
    const tab = makeTab();
    clickToggle(tab, SPERRE, false);
    expect(store.updateSetting).toHaveBeenCalledWith("claudeExclusion", false);
    expect(tab.update).toHaveBeenCalledTimes(1);
    tab.update.mockClear();
    clickToggle(tab, SANDBOX, true);
    expect(store.updateSetting).toHaveBeenCalledWith("claudeExclusionSandbox", true);
    expect(tab.update).not.toHaveBeenCalled();
  });

  it("Sandbox bleibt nach dem Neuzeichnen im selben Setting nicht gesperrt, wenn die Sperre wieder an ist", () => {
    const tab = makeTab({ claudeExclusion: false }, "darwin");
    const def = findDef(tab.getSettingDefinitions() as Item[], SANDBOX);
    const row = new Setting({} as HTMLElement) as unknown as FakeRow;
    def.render!(row, {});
    expect(row.disabledNow).toBe(true);
    current.claudeExclusion = true;
    def.render!(row, {});
    expect(row.disabledNow).toBe(false);
  });
});
