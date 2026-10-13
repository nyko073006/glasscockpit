import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Setting, type App, type Plugin } from "obsidian";
import { DEFAULT_SETTINGS, invalidMessage, type CockpitSettings } from "../src/core/settings";
import type { SessionStore } from "../src/core/session-store";
import { CockpitSettingTab } from "../src/host/settings-tab";
import { ROOT } from "./helpers/files";

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
vi.mock("../src/host/native-download-fetch", () => ({ pluginDirOf: h.pluginDirOf, REAL_DOWNLOAD_DEPS: {} }));

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

function makeTab(overrides: Partial<CockpitSettings> = {}): Tab {
  current = {
    ...DEFAULT_SETTINGS,
    radars: [{ name: "Alpha", stateFile: "~/a/state.json" }, { name: "Beta", stateFile: "~/b/state.json" }],
    ...overrides,
  };
  const plugin = { manifest: { version: "9.9.9" } };
  return new CockpitSettingTab({} as App, plugin as unknown as Plugin, store as unknown as SessionStore) as Tab;
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
  it("Zeilen, Reihenfolge und Steuerelemente bleiben", () => {
    expect(record(makeTab())).toMatchSnapshot();
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
});
