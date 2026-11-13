import { Window } from "happy-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Observable } from "../src/core/observable";
import type { Reminder } from "../src/core/reminders";
import type { ReminderDone } from "../src/core/session-model";
import { DEFAULT_SETTINGS, type CockpitSettings } from "../src/core/settings";
import type { RemindersController, RemindersState } from "../src/host/reminders";
import type { TasksCardDeps } from "../src/host/tasks-card";

// Karte „Heute“ (Abend 44): echte TasksCard, Obsidian, Vault, Store und Erinnerungen-Controller ersetzt. Muster wie
// test/wikilinks-host.test.ts: eigenes happy-dom-Fenster, "obsidian" per vi.mock (das Paket bringt nur Typen).

const { notices, mocks } = vi.hoisted(() => {
  class TFile {
    path: string;
    name: string;
    constructor(path: string) {
      this.path = path;
      this.name = path.slice(path.lastIndexOf("/") + 1);
    }
  }
  const notices: string[] = [];
  class Notice {
    constructor(message: string) {
      notices.push(message);
    }
  }
  return { notices, mocks: { Notice, TFile } };
});
vi.mock("obsidian", () => mocks);

const { TasksCard } = await import("../src/host/tasks-card");

const win = new Window();
const doc = win.document as unknown as Document;

interface Info { cls?: string; text?: string; value?: string; attr?: Record<string, string> }
function baue(tag: string, info: Info = {}): HTMLElement {
  const el = doc.createElement(tag);
  if (info.cls) el.className = info.cls;
  if (info.text !== undefined) el.textContent = info.text;
  if (info.value !== undefined) (el as HTMLInputElement).value = info.value;
  for (const [k, v] of Object.entries(info.attr ?? {})) el.setAttribute(k, v);
  return el;
}
beforeAll(() => {
  const proto = win.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.empty = function (this: HTMLElement) { this.replaceChildren(); };
  proto.createEl = function (this: HTMLElement, tag: string, info?: Info) { const el = baue(tag, info); this.append(el); return el; };
  proto.createDiv = function (this: HTMLElement, info?: Info) { return (this as unknown as { createEl(t: string, i?: Info): HTMLElement }).createEl("div", info); };
  proto.createSpan = function (this: HTMLElement, info?: Info) { return (this as unknown as { createEl(t: string, i?: Info): HTMLElement }).createEl("span", info); };
});

/** Zeitstempel der Testklicks: je Klick eine Sekunde weiter, damit die Zeitsperre der Karte (Fix-Runde 2) nicht greift. */
let uhr = 1_000_000;
/** Mausklick mit gesetztem Zeitstempel (happy-dom setzt sonst die echte Zeit, Klicks im Test lägen Millisekunden auseinander). */
const klickUm = (target: Element, timeStamp: number, detail = 1): void => {
  const ev = new win.MouseEvent("click", { bubbles: true, cancelable: true, detail }) as unknown as MouseEvent;
  Object.defineProperty(ev, "timeStamp", { value: timeStamp });
  target.dispatchEvent(ev);
};
const click = (target: Element): void => {
  uhr += 1000;
  klickUm(target, uhr);
};
const enter = (target: Element): void => {
  target.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }) as unknown as KeyboardEvent);
};
const flush = () => new Promise<void>((r) => setTimeout(r, 0));
const all = (root: ParentNode, sel: string): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(sel)];
const texts = (root: ParentNode, sel: string): string[] => all(root, sel).map((e) => e.textContent ?? "");

const TASKS = "Listen/Aufgaben.md";
const DIR = "Briefings";
const HEUTE = "2026-11-11";
const MORGEN = "2026-11-12";
const BRIEFING = "# Briefing\n\n## Heute dran\n\n- Punkt eins\n- Siehe [[Notiz]]\n";
const LISTE = "# Liste\n\n- [ ] Offen\n- [x] Fertig\n";

/** Metadaten wie Obsidians Cache, aus dem Inhalt: Überschriften und Listenpunkte oberster Ebene. */
function fileCache(content: string) {
  const lines = content.split("\n");
  const headings: unknown[] = [];
  const listItems: unknown[] = [];
  lines.forEach((l, line) => {
    const h = /^(#+) (.*)$/.exec(l);
    if (h) headings.push({ position: { start: { line } }, level: h[1].length, heading: h[2] });
    const t = /^- \[(.)\]/.exec(l);
    if (t) listItems.push({ position: { start: { line } }, task: t[1], parent: -1 });
  });
  return { headings, listItems };
}

type Handler = (...args: unknown[]) => void;

interface Welt {
  card: InstanceType<typeof TasksCard>;
  /** Meldet die (geänderten) Einstellungen an jedes Abo, wie store.onSettingsChange. */
  fireSettings: () => void;
  el: HTMLElement;
  files: Map<string, string>;
  settings: CockpitSettings;
  now: { value: Date };
  cachedRead: ReturnType<typeof vi.fn>;
  getFileByPath: ReturnType<typeof vi.fn>;
  process: ReturnType<typeof vi.fn>;
  openLinkText: ReturnType<typeof vi.fn>;
  fireVault: (event: string, path: string) => void;
  fireToday: () => void;
  state: Observable<RemindersState>;
  setCompleted: ReturnType<typeof vi.fn>;
  busy: Set<string>;
  refresh: ReturnType<typeof vi.fn>;
  briefingDone: ReturnType<typeof vi.fn>;
  setBriefingDone: ReturnType<typeof vi.fn>;
  remindersDone: ReturnType<typeof vi.fn>;
  setReminderDone: ReturnType<typeof vi.fn>;
  setDoneOpen: ReturnType<typeof vi.fn>;
  doneOpen: { value: boolean };
}

function aufbau(o: { files?: Record<string, string>; settings?: Partial<CockpitSettings>; doneOpen?: boolean; state?: RemindersState } = {}): Welt {
  notices.length = 0;
  const files = new Map(Object.entries(o.files ?? { [TASKS]: LISTE, [`${DIR}/${HEUTE}.md`]: BRIEFING }));
  const vaultHandlers = new Map<string, Handler[]>();
  const todayHandlers = new Set<() => void>();
  const getFileByPath = vi.fn((p: string) => (files.has(p) ? new mocks.TFile(p) : null));
  const cachedRead = vi.fn(async (f: { path: string }) => files.get(f.path) ?? "");
  const process = vi.fn(async (f: { path: string }, fn: (d: string) => string) => {
    const next = fn(files.get(f.path) ?? "");
    files.set(f.path, next);
    return next;
  });
  const openLinkText = vi.fn(async () => {});
  const app = {
    vault: {
      getFileByPath,
      getAbstractFileByPath: getFileByPath,
      cachedRead,
      process,
      on: (event: string, cb: Handler) => {
        vaultHandlers.set(event, [...(vaultHandlers.get(event) ?? []), cb]);
        return {};
      },
    },
    metadataCache: {
      getFileCache: (f: { path: string }) => fileCache(files.get(f.path) ?? ""),
      on: () => ({}),
    },
    workspace: { openLinkText },
  };
  const owner = { app, containerEl: { win }, registerEvent: vi.fn(), register: vi.fn() };
  const settings: CockpitSettings = {
    ...DEFAULT_SETTINGS,
    tasksFile: TASKS,
    briefingsDir: DIR,
    focusHeading: "Heute dran",
    todayBriefing: true,
    tasksAddHeading: "",
    remindersEnabled: true,
    remindersLists: "",
    remindersOverdue: true,
    ...o.settings,
  };
  const now = { value: new Date(2026, 10, 11, 9, 30) };
  const briefingStore = new Map<string, string[]>();
  const reminderStore = new Map<string, ReminderDone[]>();
  const fireToday = () => { for (const cb of [...todayHandlers]) cb(); };
  const briefingDone = vi.fn((today: string) => [...(briefingStore.get(today) ?? [])]);
  const setBriefingDone = vi.fn((today: string, key: string, done: boolean) => {
    const keys = (briefingStore.get(today) ?? []).filter((k) => k !== key);
    briefingStore.set(today, done ? [...keys, key] : keys);
    fireToday();
  });
  const remindersDone = vi.fn((today: string) => [...(reminderStore.get(today) ?? [])]);
  const setReminderDone = vi.fn((today: string, item: ReminderDone, done: boolean) => {
    const items = (reminderStore.get(today) ?? []).filter((i) => i.id !== item.id);
    reminderStore.set(today, done ? [...items, item] : items);
    fireToday();
  });
  const state = new Observable<RemindersState>(o.state ?? { kind: "ok", items: [] });
  const busy = new Set<string>();
  const setCompleted = vi.fn(async () => true);
  const refresh = vi.fn(async () => {});
  const reminders = { state, setCompleted, isBusy: (id: string) => busy.has(id), refresh } as unknown as RemindersController;
  const doneOpen = { value: o.doneOpen ?? false };
  const setDoneOpen = vi.fn((open: boolean) => { doneOpen.value = open; });
  const el = doc.createElement("div");
  doc.body.append(el);
  const settingsHandlers = new Set<(s: CockpitSettings) => void>();
  const deps: TasksCardDeps = {
    settings: () => settings,
    onSettingsChange: (cb) => { settingsHandlers.add(cb); return () => settingsHandlers.delete(cb); },
    now: () => now.value,
    briefingDone,
    setBriefingDone,
    remindersDone,
    setReminderDone,
    onTodayChange: (cb) => { todayHandlers.add(cb); return () => todayHandlers.delete(cb); },
    reminders,
    doneOpen: () => doneOpen.value,
    setDoneOpen,
  };
  const card = new TasksCard(owner as never, el, deps);
  card.start();
  const fireVault = (event: string, path: string) => { for (const cb of vaultHandlers.get(event) ?? []) cb({ path }); };
  return {
    card,
    fireSettings: () => { for (const cb of [...settingsHandlers]) cb(settings); },
    el, files, settings, now, cachedRead, getFileByPath, process, openLinkText, fireVault, fireToday, state, setCompleted, busy, refresh,
    briefingDone, setBriefingDone, remindersDone, setReminderDone, setDoneOpen, doneOpen,
  };
}

const kopf = (w: Welt) => w.el.querySelector<HTMLElement>(".cockpit-card-head")!;
const rumpf = (w: Welt) => w.el.querySelector<HTMLElement>(".cockpit-card-body")!;
const eingabe = (w: Welt) => w.el.querySelector<HTMLInputElement>("input.cockpit-today-input")!;
const erledigtKnopf = (w: Welt) => w.el.querySelector<HTMLElement>(".cockpit-today-done-toggle");
/** Zeilen des offenen Teils (ohne den Bereich „Erledigt“). */
const offen = (w: Welt) => all(rumpf(w), ".cockpit-task").filter((e) => !e.closest(".cockpit-today-done"));
const erledigt = (w: Welt) => all(w.el, ".cockpit-today-done .cockpit-task");
const zeile = (rows: HTMLElement[], text: string): HTMLElement => {
  const r = rows.find((e) => e.querySelector(".cockpit-task-text")?.textContent === text);
  expect(r, `Zeile „${text}“`).toBeDefined();
  return r!;
};
const geladen = async (w: Welt) => { await vi.waitFor(() => expect(kopf(w).textContent).toMatch(/\d+\/\d+/)); };

describe("Karte „Heute“: Aufbau", () => {
  it("a) Briefing, Aufgaben, Zähler und Erledigt zugeklappt", async () => {
    const w = aufbau();
    await vi.waitFor(() => expect(texts(kopf(w), ".cockpit-card-date")).toEqual(["1/4"]));
    expect(texts(kopf(w), ".cockpit-card-title")).toEqual(["Heute"]);
    expect(texts(rumpf(w), ".cockpit-today-source")).toEqual(["Briefing"]);
    expect(offen(w).map((e) => e.querySelector(".cockpit-task-text")?.textContent)).toEqual(["Punkt eins", "Siehe Notiz", "Offen"]);
    expect(texts(rumpf(w), ".cockpit-task-heading")).toEqual(["Liste"]);
    // Reihenfolge: Quelle, zwei Punkte, Überschrift, Aufgabe.
    const reihe = all(rumpf(w), ".cockpit-today-source, .cockpit-task, .cockpit-task-heading")
      .filter((e) => !e.closest(".cockpit-today-done"))
      .map((e) => e.textContent?.replace(/^[☐☑]/, ""));
    expect(reihe).toEqual(["Briefing", "Punkt eins", "Siehe Notiz", "Liste", "Offen"]);
    expect(erledigtKnopf(w)?.textContent).toBe("Erledigt (1)");
    expect(erledigtKnopf(w)?.getAttribute("aria-expanded")).toBe("false");
    expect(erledigt(w)).toHaveLength(0);
    expect(kopf(w).querySelector(".cockpit-progress-fill")?.getAttribute("style")).toMatch(/width: 25%/);
  });

  it("Erledigt aufklappen: setDoneOpen(true), aria-expanded, die Zeilen durchgestrichen", async () => {
    const w = aufbau();
    await geladen(w);
    expect(erledigtKnopf(w)?.textContent).toBe("Erledigt (1)");
    click(erledigtKnopf(w)!);
    expect(w.setDoneOpen).toHaveBeenCalledWith(true);
    expect(erledigtKnopf(w)?.getAttribute("aria-expanded")).toBe("true");
    expect(erledigt(w).map((e) => [e.querySelector(".cockpit-task-text")?.textContent, e.classList.contains("cockpit-task-done")])).toEqual([["Fertig", true]]);
    click(erledigtKnopf(w)!);
    expect(w.setDoneOpen).toHaveBeenLastCalledWith(false);
    expect(erledigt(w)).toHaveLength(0);
  });

  it("nichts offen: Hinweis „Nichts offen“", async () => {
    const w = aufbau({ files: { [TASKS]: "- [x] Fertig\n" } });
    await vi.waitFor(() => expect(texts(rumpf(w), ".cockpit-hint")).toEqual(["Nichts offen"]));
    expect(offen(w)).toHaveLength(0);
  });

  it("Knopf „↻“ nur bei eingeschalteten Erinnerungen, er liest neu", async () => {
    const w = aufbau();
    await geladen(w);
    const knopf = kopf(w).querySelector<HTMLElement>("button[aria-label='Erinnerungen neu lesen']");
    expect(knopf?.textContent).toBe("↻");
    click(knopf!);
    expect(w.refresh).toHaveBeenCalledTimes(1);
    // Abschluss: Der Knopf folgt dem Zustand des Controllers (bei ausgeschaltetem Schalter `off`), nicht dem Schalter allein.
    const aus = aufbau({ settings: { remindersEnabled: false }, state: { kind: "off" } });
    await geladen(aus);
    // Fix-Runde 1: Der Knopf wird einmal angelegt und bei ausgeschalteten Erinnerungen nur versteckt.
    expect(kopf(aus).querySelector<HTMLElement>("button[aria-label='Erinnerungen neu lesen']")?.hidden).toBe(true);
  });

  it("Wikilink im Briefing-Punkt öffnet mit Quelle = heutiges Briefing und hakt nicht ab", async () => {
    const w = aufbau();
    await geladen(w);
    click(zeile(offen(w), "Siehe Notiz").querySelector("a.internal-link")!);
    await flush();
    expect(w.openLinkText).toHaveBeenCalledWith("Notiz", `${DIR}/${HEUTE}.md`, "tab");
    expect(w.setBriefingDone).not.toHaveBeenCalled();
  });
});

describe("Karte „Heute“: Briefing-Punkte abhaken", () => {
  it("b) Klick hakt ab (heute, Schlüssel, true), danach unter Erledigt; Klick dort setzt zurück", async () => {
    const w = aufbau({ doneOpen: true });
    await geladen(w);
    click(zeile(offen(w), "Punkt eins"));
    expect(w.setBriefingDone).toHaveBeenCalledWith(HEUTE, "punkt eins", true);
    await vi.waitFor(() => expect(erledigt(w).map((e) => e.querySelector(".cockpit-task-text")?.textContent)).toContain("Punkt eins"));
    expect(offen(w).map((e) => e.querySelector(".cockpit-task-text")?.textContent)).not.toContain("Punkt eins");
    click(zeile(erledigt(w), "Punkt eins"));
    expect(w.setBriefingDone).toHaveBeenLastCalledWith(HEUTE, "punkt eins", false);
    await vi.waitFor(() => expect(offen(w).map((e) => e.querySelector(".cockpit-task-text")?.textContent)).toContain("Punkt eins"));
  });

  it("Rundweg des Tages: der Tag beim Abhaken hat die Form JJJJ-MM-TT", async () => {
    const w = aufbau();
    await geladen(w);
    click(zeile(offen(w), "Punkt eins"));
    expect(w.setBriefingDone.mock.calls[0][0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("im Briefing abgehakter Punkt steht gesperrt unter Erledigt: Klick ohne Wirkung", async () => {
    const w = aufbau({ doneOpen: true, files: { [TASKS]: LISTE, [`${DIR}/${HEUTE}.md`]: "- [x] Fest erledigt\n" } });
    await geladen(w);
    const r = zeile(erledigt(w), "Fest erledigt");
    expect(r.classList.contains("cockpit-task-done")).toBe(true);
    click(r);
    expect(w.setBriefingDone).not.toHaveBeenCalled();
  });
});

describe("Karte „Heute“: Eingabezeile", () => {
  it("c) überlebt das Neuzeichnen durch onTodayChange und Vault-Ereignis: derselbe Knoten, Wert und Fokus bleiben", async () => {
    const w = aufbau();
    await geladen(w);
    const input = eingabe(w);
    input.focus();
    input.value = "halb getippt";
    const vorher = w.cachedRead.mock.calls.length;
    w.fireToday();
    await vi.waitFor(() => expect(w.cachedRead.mock.calls.length).toBeGreaterThan(vorher));
    const mitte = w.cachedRead.mock.calls.length;
    w.fireVault("modify", TASKS);
    await vi.waitFor(() => expect(w.cachedRead.mock.calls.length).toBeGreaterThan(mitte), { timeout: 2000 });
    await flush();
    expect(eingabe(w)).toBe(input);
    expect(input.value).toBe("halb getippt");
    expect(doc.activeElement).toBe(input);
    expect(input.getAttribute("placeholder")).toBe("Aufgabe für heute …");
    expect(input.getAttribute("aria-label")).toBe("Neue Aufgabe");
  });

  it("d) Enter schreibt über vault.process und leert das Feld; leerer Text schreibt nicht", async () => {
    const w = aufbau({ settings: { tasksAddHeading: "Liste" } });
    await geladen(w);
    const input = eingabe(w);
    input.value = "   ";
    enter(input);
    await flush();
    expect(w.process).not.toHaveBeenCalled();
    input.value = "Test 44";
    enter(input);
    await vi.waitFor(() => expect(w.process).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(input.value).toBe(""));
    expect(w.files.get(TASKS)).toContain("- [ ] Test 44");
    // Unter der Überschrift aus tasksAddHeading, hinter dem letzten Listenpunkt.
    expect(w.files.get(TASKS)).toBe("# Liste\n\n- [ ] Offen\n- [x] Fertig\n- [ ] Test 44\n");
  });

  it("d) ohne Aufgabenliste: Feld gesperrt, Hinweis mit Pfad und Knopf „Anlegen“; Briefing-Punkte zählen weiter", async () => {
    const w = aufbau({ files: { [`${DIR}/${HEUTE}.md`]: BRIEFING } });
    await vi.waitFor(() => expect(eingabe(w).disabled).toBe(true));
    expect(w.el.textContent).toContain(`Aufgabenliste ${TASKS} fehlt`);
    expect(all(w.el, "button").map((b) => b.textContent)).toContain("Anlegen");
    expect(texts(kopf(w), ".cockpit-card-date")).toEqual(["0/2"]);
    eingabe(w).value = "Test 44";
    enter(eingabe(w));
    await flush();
    expect(w.process).not.toHaveBeenCalled();
  });
});

describe("Karte „Heute“: Tag und Einstellungen", () => {
  it("e) Tageswechsel: der nächste Ladeanlass liest das Briefing des neuen Tags und fragt den Erledigt-Stand des neuen Tags", async () => {
    const w = aufbau({ files: { [TASKS]: LISTE, [`${DIR}/${HEUTE}.md`]: BRIEFING, [`${DIR}/${MORGEN}.md`]: "## Heute dran\n\n- Neuer Tag\n" } });
    await geladen(w);
    w.now.value = new Date(2026, 10, 12, 0, 5);
    w.fireToday();
    await vi.waitFor(() => expect(offen(w).map((e) => e.querySelector(".cockpit-task-text")?.textContent)).toContain("Neuer Tag"));
    expect(w.cachedRead.mock.calls.map((c) => (c[0] as { path: string }).path)).toContain(`${DIR}/${MORGEN}.md`);
    expect(w.briefingDone).toHaveBeenLastCalledWith(MORGEN);
    click(zeile(offen(w), "Neuer Tag"));
    expect(w.setBriefingDone).toHaveBeenCalledWith(MORGEN, "neuer tag", true);
  });

  it("g) todayBriefing aus: das Briefing wird nicht gelesen", async () => {
    const w = aufbau({ settings: { todayBriefing: false } });
    await geladen(w);
    expect(w.cachedRead.mock.calls.map((c) => (c[0] as { path: string }).path)).not.toContain(`${DIR}/${HEUTE}.md`);
    expect(texts(rumpf(w), ".cockpit-today-source")).toEqual([]);
    expect(texts(kopf(w), ".cockpit-card-date")).toEqual(["1/2"]);
  });
});

describe("Karte „Heute“: Erinnerungen", () => {
  const items: Reminder[] = [
    { id: "r1", name: "Anrufen", list: "Arbeit", due: HEUTE },
    { id: "r2", name: "Alt", list: "Privat", due: "2026-11-09" },
  ];

  /** Promise, das der Test von Hand auflöst. */
  function aufgeschoben<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
  }

  it("Quelle „Erinnerungen“ mit „seit TT.MM.“ bei überfälligen", async () => {
    const w = aufbau({ state: { kind: "ok", items } });
    await vi.waitFor(() => expect(texts(rumpf(w), ".cockpit-today-source")).toEqual(["Briefing", "Erinnerungen"]));
    expect(texts(zeile(offen(w), "Alt"), ".cockpit-today-since")).toEqual(["seit 09.11."]);
    expect(texts(zeile(offen(w), "Anrufen"), ".cockpit-today-since")).toEqual([]);
  });

  it("f) Klick setzt erst in Erinnerungen, erst nach Erfolg den Tagesstand", async () => {
    const w = aufbau({ state: { kind: "ok", items } });
    await vi.waitFor(() => expect(texts(rumpf(w), ".cockpit-today-source")).toContain("Erinnerungen"));
    const d = aufgeschoben<boolean>();
    w.setCompleted.mockImplementationOnce(() => d.promise);
    click(zeile(offen(w), "Anrufen"));
    expect(w.setCompleted).toHaveBeenCalledWith("r1", true);
    await flush();
    expect(w.setReminderDone).not.toHaveBeenCalled();
    d.resolve(true);
    await vi.waitFor(() => expect(w.setReminderDone).toHaveBeenCalledWith(HEUTE, { id: "r1", name: "Anrufen" }, true));
  });

  it("f) setCompleted liefert false: kein Tagesstand", async () => {
    const w = aufbau({ state: { kind: "ok", items } });
    await vi.waitFor(() => expect(texts(rumpf(w), ".cockpit-today-source")).toContain("Erinnerungen"));
    w.setCompleted.mockResolvedValueOnce(false);
    click(zeile(offen(w), "Anrufen"));
    await vi.waitFor(() => expect(w.setCompleted).toHaveBeenCalledTimes(1));
    await flush();
    await flush();
    expect(w.setReminderDone).not.toHaveBeenCalled();
  });

  it("f) belegte Erinnerung: Klasse cockpit-task-busy, Klick ohne Wirkung", async () => {
    const w = aufbau({ state: { kind: "ok", items } });
    await vi.waitFor(() => expect(texts(rumpf(w), ".cockpit-today-source")).toContain("Erinnerungen"));
    w.busy.add("r1");
    w.fireToday();
    await vi.waitFor(() => expect(zeile(offen(w), "Anrufen").classList.contains("cockpit-task-busy")).toBe(true));
    click(zeile(offen(w), "Anrufen"));
    await flush();
    expect(w.setCompleted).not.toHaveBeenCalled();
  });

  it("die Zeile ist schon beim Start des Setzens gesperrt (Neuzeichnen direkt nach dem Aufruf)", async () => {
    const w = aufbau({ state: { kind: "ok", items } });
    await vi.waitFor(() => expect(texts(rumpf(w), ".cockpit-today-source")).toContain("Erinnerungen"));
    const d = aufgeschoben<boolean>();
    w.setCompleted.mockImplementationOnce(() => { w.busy.add("r1"); return d.promise; });
    click(zeile(offen(w), "Anrufen"));
    expect(zeile(offen(w), "Anrufen").classList.contains("cockpit-task-busy")).toBe(true);
    w.busy.delete("r1");
    d.resolve(false);
    await vi.waitFor(() => expect(zeile(offen(w), "Anrufen").classList.contains("cockpit-task-busy")).toBe(false));
  });

  it("heute im Cockpit abgehakt steht unter Erledigt; Klick dort setzt zurück", async () => {
    const w = aufbau({ state: { kind: "ok", items }, doneOpen: true });
    await vi.waitFor(() => expect(texts(rumpf(w), ".cockpit-today-source")).toContain("Erinnerungen"));
    click(zeile(offen(w), "Anrufen"));
    await vi.waitFor(() => expect(w.setReminderDone).toHaveBeenCalledTimes(1));
    // Der Controller nimmt erledigte Einträge aus seiner Liste.
    w.state.set({ kind: "ok", items: items.filter((r) => r.id !== "r1") });
    await vi.waitFor(() => expect(erledigt(w).map((e) => e.querySelector(".cockpit-task-text")?.textContent)).toContain("Anrufen"));
    click(zeile(erledigt(w), "Anrufen"));
    expect(w.setCompleted).toHaveBeenLastCalledWith("r1", false);
    await vi.waitFor(() => expect(w.setReminderDone).toHaveBeenLastCalledWith(HEUTE, { id: "r1", name: "Anrufen" }, false));
  });

  it("f) Zustand error: Fehlerzeile unter der Quelle, keine Notice", async () => {
    const w = aufbau({ state: { kind: "ok", items } });
    await vi.waitFor(() => expect(texts(rumpf(w), ".cockpit-today-source")).toContain("Erinnerungen"));
    w.state.set({ kind: "error", message: "Kein Zugriff auf Erinnerungen", items });
    await vi.waitFor(() => expect(texts(rumpf(w), ".cockpit-hint")).toContain("Kein Zugriff auf Erinnerungen"));
    const quelle = all(rumpf(w), ".cockpit-today-source").find((e) => e.textContent === "Erinnerungen")!;
    expect(quelle.nextElementSibling?.textContent).toBe("Kein Zugriff auf Erinnerungen");
    expect(notices).toEqual([]);
  });

  it("Fehler ohne fällige Einträge: Quelle und Fehlerzeile stehen trotzdem da", async () => {
    const w = aufbau({ state: { kind: "error", message: "Kein Zugriff auf Erinnerungen", items: [] } });
    await vi.waitFor(() => expect(texts(rumpf(w), ".cockpit-hint")).toContain("Kein Zugriff auf Erinnerungen"));
    expect(texts(rumpf(w), ".cockpit-today-source")).toEqual(["Briefing", "Erinnerungen"]);
    expect(notices).toEqual([]);
  });
});

const txt = (rows: HTMLElement[]) => rows.map((e) => e.querySelector(".cockpit-task-text")?.textContent);
function aufgeschoben<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
const taste = (target: Element, key: string, repeat = false): KeyboardEvent => {
  const ev = new win.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }) as unknown as KeyboardEvent;
  Object.defineProperty(ev, "repeat", { value: repeat });
  target.dispatchEvent(ev);
  return ev;
};
/** Fokus wie per Tastatur (true) oder per Maus (false): `matches(":focus-visible")` am Element entsprechend. */
const fokus = (el: HTMLElement, perTastatur: boolean): void => {
  el.focus();
  const echt = el.matches.bind(el);
  (el as { matches: (sel: string) => boolean }).matches = (sel: string) => (sel === ":focus-visible" ? perTastatur : echt(sel));
};
/** Alles, was im Rumpf eine eigene Zeile belegt, in Reihenfolge. */
const sichtbar = (w: Welt) => all(rumpf(w), ".cockpit-today-source, .cockpit-task, .cockpit-task-heading, .cockpit-hint, .cockpit-today-done-toggle");
const faellig: Reminder[] = [
  { id: "r1", name: "Anrufen", list: "Arbeit", due: HEUTE },
  { id: "r2", name: "Alt", list: "Privat", due: "2026-11-09" },
];

// Fix-Runde 2: Zeitsperre je Karte statt Klickzähler. Nach einem angenommenen Mausklick auf eine Zeile verwirft die Karte
// weitere Mausklicks auf Zeilen für TODAY_CLICK_GUARD_MS (350 ms); gemessen mit dem Zeitstempel des Ereignisses.
describe("Karte „Heute“: Doppelklick und Zeitsperre", () => {
  it("Pop-out: kleinerer Zeitstempel als beim letzten Klick (andere Fensteruhr) sperrt nicht", async () => {
    const w = aufbau();
    await geladen(w);
    klickUm(zeile(offen(w), "Punkt eins"), 3_600_000);
    klickUm(zeile(offen(w), "Siehe Notiz"), 5_000);
    expect(w.setBriefingDone.mock.calls.map((c) => c[1])).toEqual(["punkt eins", "siehe notiz"]);
  });

  it("Kontrolle: größerer Zeitstempel über der Sperre wirkt ebenfalls", async () => {
    const w = aufbau();
    await geladen(w);
    klickUm(zeile(offen(w), "Punkt eins"), 5_000);
    klickUm(zeile(offen(w), "Siehe Notiz"), 3_600_000);
    expect(w.setBriefingDone.mock.calls.map((c) => c[1])).toEqual(["punkt eins", "siehe notiz"]);
  });

  it("G1 zweiter Klick 100 ms später auf die nachgerückte Zeile hakt sie nicht ab", async () => {
    const w = aufbau();
    await geladen(w);
    klickUm(sichtbar(w)[1], 50_000, 1);
    expect(w.setBriefingDone).toHaveBeenCalledWith(HEUTE, "punkt eins", true);
    await vi.waitFor(() => expect(txt(offen(w))).not.toContain("Punkt eins"), { interval: 1 });
    klickUm(sichtbar(w)[1], 50_100, 2);
    await flush();
    expect(w.setBriefingDone.mock.calls.map((c) => [c[1], c[2]])).toEqual([["punkt eins", true]]);
  });

  it("G1b zweiter Klick auf den einzigen Briefing-Punkt schreibt nicht in die Aufgabenliste", async () => {
    const w = aufbau({ files: { [TASKS]: LISTE, [`${DIR}/${HEUTE}.md`]: "## Heute dran\n\n- Einziger\n" } });
    await geladen(w);
    klickUm(sichtbar(w)[1], 50_000, 1);
    await vi.waitFor(() => expect(txt(offen(w))).not.toContain("Einziger"), { interval: 1 });
    klickUm(sichtbar(w)[1] ?? sichtbar(w)[0], 50_100, 2);
    await flush();
    expect(w.process).not.toHaveBeenCalled();
  });

  it("G1c zwei Klicks im Abstand 100 ms: nur der erste wirkt, für Briefing, Erinnerung, Aufgabe und unter Erledigt", async () => {
    const welt = () => aufbau({ state: { kind: "ok", items: faellig }, doneOpen: true });
    const bereit = async (w: Welt) => { await vi.waitFor(() => expect(txt(offen(w))).toContain("Anrufen")); };

    let w = welt();
    await bereit(w);
    klickUm(zeile(offen(w), "Punkt eins"), 50_000);
    klickUm(zeile(offen(w), "Siehe Notiz"), 50_100, 1);
    expect(w.setBriefingDone).toHaveBeenCalledTimes(1);

    w = welt();
    await bereit(w);
    klickUm(zeile(offen(w), "Anrufen"), 50_000);
    klickUm(zeile(offen(w), "Alt"), 50_100, 1);
    await flush();
    expect(w.setCompleted.mock.calls).toEqual([["r1", true]]);

    w = welt();
    await bereit(w);
    klickUm(zeile(offen(w), "Offen"), 50_000);
    klickUm(zeile(offen(w), "Punkt eins"), 50_100, 1);
    await vi.waitFor(() => expect(w.process).toHaveBeenCalledTimes(1));
    expect(w.setBriefingDone).not.toHaveBeenCalled();

    w = welt();
    await bereit(w);
    klickUm(zeile(erledigt(w), "Fertig"), 50_000);
    klickUm(zeile(offen(w), "Offen"), 50_100, 1);
    await vi.waitFor(() => expect(w.process).toHaveBeenCalledTimes(1));
    await flush();
    expect(w.process).toHaveBeenCalledTimes(1);
    expect(w.files.get(TASKS)).toContain("- [ ] Fertig");
  });

  it("drei Klicks im Abstand 400 ms wirken alle, auch mit Klickzähler 1, 2, 3", async () => {
    const w = aufbau({ files: { [TASKS]: LISTE, [`${DIR}/${HEUTE}.md`]: "## Heute dran\n\n- Erster\n- Zweiter\n- Dritter\n" } });
    await geladen(w);
    for (const [i, name] of ["Erster", "Zweiter", "Dritter"].entries()) {
      klickUm(sichtbar(w)[1], 60_000 + i * 400, i + 1);
      await vi.waitFor(() => expect(txt(offen(w))).not.toContain(name), { interval: 1 });
    }
    expect(w.setBriefingDone.mock.calls.map((c) => c[1])).toEqual(["erster", "zweiter", "dritter"]);
  });

  it("Zeitstempel 0: gemessen wird mit performance.now(), direkt nacheinander einmal, nach 400 ms wieder", async () => {
    const w = aufbau();
    await geladen(w);
    klickUm(zeile(offen(w), "Punkt eins"), 0);
    klickUm(zeile(offen(w), "Siehe Notiz"), 0);
    expect(w.setBriefingDone).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 400));
    klickUm(zeile(offen(w), "Siehe Notiz"), 0);
    expect(w.setBriefingDone.mock.calls.map((c) => c[1])).toEqual(["punkt eins", "siehe notiz"]);
  });

  it("die Tastatur ist von der Zeitsperre nicht betroffen", async () => {
    const w = aufbau();
    await geladen(w);
    klickUm(zeile(offen(w), "Punkt eins"), performance.now());
    taste(zeile(offen(w), "Siehe Notiz"), " ");
    expect(w.setBriefingDone.mock.calls.map((c) => c[1])).toEqual(["punkt eins", "siehe notiz"]);
  });
});

describe("Karte „Heute“: Lesen", () => {
  it("G2 remindersOverdue und remindersLists wirken nach einer Einstellungsänderung (Neuladen über loadKey)", async () => {
    const w = aufbau({ state: { kind: "ok", items: faellig } });
    await vi.waitFor(() => expect(txt(offen(w))).toContain("Alt"));
    w.settings.remindersOverdue = false;
    w.fireSettings();
    await vi.waitFor(() => expect(txt(offen(w))).not.toContain("Alt"), { timeout: 2000 });
    expect(txt(offen(w))).toContain("Anrufen");
    w.settings.remindersOverdue = true;
    w.settings.remindersLists = "privat";
    w.fireSettings();
    await vi.waitFor(() => expect(txt(offen(w))).toContain("Alt"), { timeout: 2000 });
    expect(txt(offen(w))).not.toContain("Anrufen");
  });

  it("G2 neuer Briefing-Ordner und andere Überschrift laden neu", async () => {
    const w = aufbau({ files: { [TASKS]: LISTE, [`${DIR}/${HEUTE}.md`]: BRIEFING, [`Andere/${HEUTE}.md`]: "## Fokus\n\n- Aus dem anderen Ordner\n" } });
    await geladen(w);
    w.settings.briefingsDir = "Andere";
    w.settings.focusHeading = "Fokus";
    w.fireSettings();
    await vi.waitFor(() => expect(txt(offen(w))).toContain("Aus dem anderen Ordner"), { timeout: 2000 });
  });

  it("G2b fremde Einstellung (tasksAddHeading) lädt nicht neu", async () => {
    const w = aufbau();
    await geladen(w);
    const vorher = w.cachedRead.mock.calls.length;
    w.settings.tasksAddHeading = "Anders";
    w.fireSettings();
    await new Promise((r) => setTimeout(r, 500));
    expect(w.cachedRead.mock.calls.length).toBe(vorher);
  });

  it("G2c Vault-Ereignis im Briefing-Ordner lädt neu, fremde Datei nicht", async () => {
    const w = aufbau();
    await geladen(w);
    const vorher = w.cachedRead.mock.calls.length;
    w.fireVault("modify", "Sonstwo/Notiz.md");
    await new Promise((r) => setTimeout(r, 500));
    expect(w.cachedRead.mock.calls.length).toBe(vorher);
    w.files.set(`${DIR}/${HEUTE}.md`, "## Heute dran\n\n- Ganz neu\n");
    w.fireVault("modify", `${DIR}/${HEUTE}.md`);
    await vi.waitFor(() => expect(txt(offen(w))).toContain("Ganz neu"), { timeout: 2000 });
  });

  it("G3 ein älterer Ladelauf, der später fertig wird, überschreibt den neueren nicht", async () => {
    const w = aufbau();
    await geladen(w);
    const d = aufgeschoben<string>();
    w.cachedRead.mockImplementationOnce(() => d.promise);
    w.fireToday();
    w.files.set(TASKS, "# Liste\n\n- [ ] Neu\n");
    w.fireToday();
    await vi.waitFor(() => expect(txt(offen(w))).toContain("Neu"));
    d.resolve(LISTE);
    await flush();
    await flush();
    expect(txt(offen(w))).toContain("Neu");
    expect(txt(offen(w))).not.toContain("Offen");
  });

  it("G3 auch ein älterer Briefing-Lauf überschreibt den neueren nicht", async () => {
    const w = aufbau();
    await geladen(w);
    const d = aufgeschoben<string>();
    // Erster Lauf: Aufgabenliste sofort, Briefing hängt.
    w.cachedRead.mockImplementationOnce(async (f: { path: string }) => w.files.get(f.path) ?? "").mockImplementationOnce(() => d.promise);
    w.fireToday();
    await flush();
    w.files.set(`${DIR}/${HEUTE}.md`, "## Heute dran\n\n- Frisch\n");
    w.fireToday();
    await vi.waitFor(() => expect(txt(offen(w))).toContain("Frisch"));
    d.resolve(BRIEFING);
    await flush();
    await flush();
    expect(txt(offen(w))).toContain("Frisch");
    expect(txt(offen(w))).not.toContain("Punkt eins");
  });
});

describe("Karte „Heute“: Tastaturfokus beim Neuzeichnen", () => {
  it("G6 der Knopf „↻“ ist nach einem Leselauf derselbe Knoten und behält den Fokus", async () => {
    const w = aufbau();
    await geladen(w);
    const knopf = kopf(w).querySelector<HTMLElement>(".cockpit-today-refresh")!;
    knopf.focus();
    w.state.set({ kind: "ok", items: [] });
    await flush();
    await flush();
    expect(kopf(w).querySelector(".cockpit-today-refresh")).toBe(knopf);
    expect(doc.activeElement).toBe(knopf);
  });

  it("„↻“ ist versteckt, wenn der Controller `off` meldet, auch bei eingeschaltetem Schalter (Windows)", async () => {
    const w = aufbau({ settings: { remindersEnabled: true }, state: { kind: "off" } });
    await geladen(w);
    expect(kopf(w).querySelector<HTMLElement>(".cockpit-today-refresh")?.hidden).toBe(true);
  });

  it("„↻“ verschwindet beim Ausschalten und kommt als derselbe Knoten wieder", async () => {
    const w = aufbau();
    await geladen(w);
    const knopf = kopf(w).querySelector<HTMLElement>(".cockpit-today-refresh")!;
    // Wie der Controller: Ausschalten meldet `off`, Einschalten `loading`.
    w.settings.remindersEnabled = false;
    w.state.set({ kind: "off" });
    await vi.waitFor(() => expect(knopf.hidden).toBe(true));
    w.settings.remindersEnabled = true;
    w.state.set({ kind: "loading" });
    await vi.waitFor(() => expect(knopf.hidden).toBe(false));
    expect(kopf(w).querySelector(".cockpit-today-refresh")).toBe(knopf);
  });

  it("G7 Fokus auf „Erledigt“ übersteht ein Neuzeichnen im Hintergrund", async () => {
    const w = aufbau();
    await geladen(w);
    fokus(erledigtKnopf(w)!, true);
    w.state.set({ kind: "ok", items: [] });
    await flush();
    await flush();
    expect(doc.activeElement).toBe(erledigtKnopf(w));
  });

  it("Fokus auf „Erledigt“ bleibt nach dem Aufklappen per Klick", async () => {
    const w = aufbau();
    await geladen(w);
    fokus(erledigtKnopf(w)!, true);
    click(erledigtKnopf(w)!);
    expect(erledigtKnopf(w)?.getAttribute("aria-expanded")).toBe("true");
    expect(doc.activeElement).toBe(erledigtKnopf(w));
  });

  it("Fokus auf einer Zeile geht nach dem Neuzeichnen auf die Zeile an derselben Stelle", async () => {
    const w = aufbau();
    await geladen(w);
    fokus(zeile(offen(w), "Siehe Notiz"), true);
    w.fireToday();
    await flush();
    await flush();
    expect(doc.activeElement).toBe(zeile(offen(w), "Siehe Notiz"));
  });

  it("gibt es die Stelle nicht mehr, geht der Fokus auf die Zeile davor", async () => {
    const w = aufbau();
    await geladen(w);
    fokus(zeile(offen(w), "Offen"), true);
    w.files.set(TASKS, "# Liste\n\n- [x] Fertig\n");
    w.fireToday();
    await vi.waitFor(() => expect(txt(offen(w))).not.toContain("Offen"));
    expect(doc.activeElement).toBe(zeile(offen(w), "Siehe Notiz"));
  });

  it("Fokus per Maus (ohne :focus-visible) auf Zeile oder „Erledigt“ wird nicht mitgenommen", async () => {
    const w = aufbau();
    await geladen(w);
    fokus(zeile(offen(w), "Siehe Notiz"), false);
    w.fireToday();
    await flush();
    await flush();
    expect(doc.activeElement).not.toBe(zeile(offen(w), "Siehe Notiz"));
    expect(w.el.contains(doc.activeElement)).toBe(false);
    fokus(erledigtKnopf(w)!, false);
    w.fireToday();
    await flush();
    await flush();
    expect(w.el.contains(doc.activeElement)).toBe(false);
  });

  it("matches(\":focus-visible\") wirft: keine Mitnahme", async () => {
    const w = aufbau();
    await geladen(w);
    const r = zeile(offen(w), "Siehe Notiz");
    r.focus();
    (r as { matches: (sel: string) => boolean }).matches = () => { throw new Error("unbekannter Selektor"); };
    w.fireToday();
    await flush();
    await flush();
    expect(w.el.contains(doc.activeElement)).toBe(false);
  });

  it("die Mitnahme ruft focus mit preventScroll, damit die Ansicht nicht springt", async () => {
    const w = aufbau({ doneOpen: true });
    await geladen(w);
    const spion = vi.spyOn(win.HTMLElement.prototype, "focus");
    try {
      fokus(zeile(offen(w), "Siehe Notiz"), true);
      spion.mockClear();
      w.fireToday();
      await vi.waitFor(() => expect(spion).toHaveBeenCalled());
      expect((spion.mock.calls as unknown[][]).every((c) => (c[0] as FocusOptions | undefined)?.preventScroll === true)).toBe(true);
      fokus(erledigtKnopf(w)!, true);
      spion.mockClear();
      w.fireToday();
      await vi.waitFor(() => expect(spion).toHaveBeenCalled());
      expect((spion.mock.calls as unknown[][]).every((c) => (c[0] as FocusOptions | undefined)?.preventScroll === true)).toBe(true);
    } finally {
      spion.mockRestore();
    }
  });
});

describe("Karte „Heute“: Tastatur", () => {
  it("anklickbare Zeilen sind Checkboxen mit Tabstopp, Wikilinks eigene Tabstopps", async () => {
    const w = aufbau({ doneOpen: true });
    await geladen(w);
    const r = zeile(offen(w), "Punkt eins");
    expect([r.getAttribute("role"), r.getAttribute("aria-checked"), r.getAttribute("tabindex")]).toEqual(["checkbox", "false", "0"]);
    expect(zeile(erledigt(w), "Fertig").getAttribute("aria-checked")).toBe("true");
    expect(zeile(offen(w), "Siehe Notiz").querySelector("a.internal-link")?.getAttribute("tabindex")).toBe("0");
  });

  it("Leertaste und Enter schalten wie ein Klick, die Leertaste ohne Scrollen", async () => {
    const w = aufbau();
    await geladen(w);
    const ev = taste(zeile(offen(w), "Punkt eins"), " ");
    expect(ev.defaultPrevented).toBe(true);
    expect(w.setBriefingDone).toHaveBeenCalledWith(HEUTE, "punkt eins", true);
    taste(zeile(offen(w), "Offen"), "Enter");
    await vi.waitFor(() => expect(w.files.get(TASKS)).toContain("- [x] Offen"));
    taste(zeile(offen(w), "Siehe Notiz"), "a");
    expect(w.setBriefingDone).toHaveBeenCalledTimes(1);
  });

  it("gehaltene Leertaste (repeat) schaltet nicht erneut", async () => {
    const w = aufbau();
    await geladen(w);
    const ev = taste(zeile(offen(w), "Punkt eins"), " ", true);
    expect(ev.defaultPrevented).toBe(true);
    taste(zeile(offen(w), "Offen"), "Enter", true);
    await flush();
    expect(w.setBriefingDone).not.toHaveBeenCalled();
    expect(w.process).not.toHaveBeenCalled();
  });

  it("Leertaste auf dem Wikilink in der Zeile schaltet die Zeile nicht", async () => {
    const w = aufbau();
    await geladen(w);
    taste(zeile(offen(w), "Siehe Notiz").querySelector("a.internal-link")!, " ");
    await flush();
    expect(w.setBriefingDone).not.toHaveBeenCalled();
  });

  it("Enter auf dem Wikilink öffnet ihn und schaltet die Zeile nicht", async () => {
    const w = aufbau();
    await geladen(w);
    taste(zeile(offen(w), "Siehe Notiz").querySelector("a.internal-link")!, "Enter");
    await flush();
    expect(w.openLinkText).toHaveBeenCalledWith("Notiz", `${DIR}/${HEUTE}.md`, "tab");
    expect(w.setBriefingDone).not.toHaveBeenCalled();
  });

  it("gesperrte Zeile: aria-disabled, Tasten ohne Wirkung", async () => {
    const w = aufbau({ doneOpen: true, files: { [TASKS]: LISTE, [`${DIR}/${HEUTE}.md`]: "- [x] Fest erledigt\n" } });
    await geladen(w);
    const r = zeile(erledigt(w), "Fest erledigt");
    expect(r.getAttribute("aria-disabled")).toBe("true");
    taste(r, " ");
    taste(r, "Enter");
    expect(w.setBriefingDone).not.toHaveBeenCalled();
  });

  it("belegte Erinnerung: aria-disabled, Tasten ohne Wirkung", async () => {
    const w = aufbau({ state: { kind: "ok", items: faellig } });
    await vi.waitFor(() => expect(txt(offen(w))).toContain("Anrufen"));
    w.busy.add("r1");
    w.fireToday();
    await vi.waitFor(() => expect(zeile(offen(w), "Anrufen").getAttribute("aria-disabled")).toBe("true"));
    taste(zeile(offen(w), "Anrufen"), " ");
    taste(zeile(offen(w), "Anrufen"), "Enter");
    await flush();
    expect(w.setCompleted).not.toHaveBeenCalled();
  });
});

describe("Karte „Heute“: Erinnerungen, Fix-Runde 1", () => {
  it("G16 Erinnerungen aus: abgehakte Erinnerung unter Erledigt ist gesperrt und nicht anklickbar", async () => {
    const w = aufbau({ state: { kind: "ok", items: faellig }, doneOpen: true });
    await vi.waitFor(() => expect(txt(offen(w))).toContain("Anrufen"));
    click(zeile(offen(w), "Anrufen"));
    await vi.waitFor(() => expect(w.setReminderDone).toHaveBeenCalledTimes(1));
    w.settings.remindersEnabled = false;
    w.state.set({ kind: "off" });
    await vi.waitFor(() => expect(txt(offen(w))).not.toContain("Alt"));
    const r = zeile(erledigt(w), "Anrufen");
    expect(r.getAttribute("aria-disabled")).toBe("true");
    click(r);
    taste(r, " ");
    await flush();
    expect(w.setCompleted).toHaveBeenCalledTimes(1);
  });

  it("nach Mitternacht ohne Neuladen schreibt der Klick den Tag des Klicks", async () => {
    const w = aufbau({ state: { kind: "ok", items: faellig } });
    await vi.waitFor(() => expect(txt(offen(w))).toContain("Anrufen"));
    w.now.value = new Date(2026, 10, 12, 0, 1);
    click(zeile(offen(w), "Anrufen"));
    await vi.waitFor(() => expect(w.setReminderDone).toHaveBeenCalledWith(MORGEN, { id: "r1", name: "Anrufen" }, true));
  });

  it("gestoppte Karte: nach dem Setzen kein Neuzeichnen mehr, der Tagesstand wird trotzdem geschrieben", async () => {
    const w = aufbau({ state: { kind: "ok", items: faellig } });
    await vi.waitFor(() => expect(txt(offen(w))).toContain("Anrufen"));
    const d = aufgeschoben<boolean>();
    w.setCompleted.mockImplementationOnce(() => { w.busy.add("r1"); return d.promise; });
    click(zeile(offen(w), "Anrufen"));
    const gesperrt = zeile(offen(w), "Anrufen");
    expect(gesperrt.classList.contains("cockpit-task-busy")).toBe(true);
    w.card.stop();
    w.busy.delete("r1");
    d.resolve(true);
    await vi.waitFor(() => expect(w.setReminderDone).toHaveBeenCalledTimes(1));
    await flush();
    // Kein Neuzeichnen: dieselbe Zeile, noch als belegt gezeichnet.
    expect(zeile(offen(w), "Anrufen")).toBe(gesperrt);
    expect(gesperrt.classList.contains("cockpit-task-busy")).toBe(true);
  });
});
