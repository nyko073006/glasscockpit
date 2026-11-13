import { Window } from "happy-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Observable } from "../src/core/observable";
import { DEFAULT_SETTINGS, type CockpitSettings } from "../src/core/settings";
import type { TodayView } from "../src/core/today";
import type { RemindersController } from "../src/host/reminders";
import type { DashboardDeps } from "../src/host/dashboard-view";
import type { TasksCardDeps } from "../src/host/tasks-card";

// Wikilinks in Aufgaben und im Briefing (Abend 29): echte TasksCard und echte DashboardView, Obsidian und die Nachbar-Karten ersetzt.
// Klicks laufen als DOM-Ereignisse durch die echten Listener; gemessen wird, was der Workspace und der Vault bekommen.
// Das DOM kommt aus einem eigenen happy-dom-Fenster, nicht aus der Umgebung der Datei: In der happy-dom-Umgebung löst Vite den
// Import "obsidian" in src/host auf und scheitert daran (das Paket bringt nur Typen), im Node-Modus greift vi.mock.

// Die Klassen kommen aus vi.hoisted, damit der Test sie benutzen kann: "obsidian" selbst lässt sich hier nicht importieren (nur Typen).
const { TFile, MarkdownRenderer, notices, mocks } = vi.hoisted(() => {
  class TFile {
    path: string;
    name: string;
    constructor(path: string) {
      this.path = path;
      this.name = path.slice(path.lastIndexOf("/") + 1);
    }
  }
  class Component {}
  // Merkt sich, was als Notice gezeigt wurde (Abend 29, Aufgabenzustand).
  const notices: string[] = [];
  class Notice {
    constructor(message: string) {
      notices.push(message);
    }
  }
  class ItemView {
    app: unknown;
    constructor(leaf: { app: unknown }) {
      this.app = leaf.app;
    }
    getState(): Record<string, unknown> {
      return {};
    }
    async setState(): Promise<void> {}
    addChild<T>(child: T): T {
      return child;
    }
    removeChild(): void {}
  }
  const MarkdownRenderer = { render: vi.fn() };
  return { TFile, MarkdownRenderer, notices, mocks: { Notice, TFile, Component, ItemView, MarkdownRenderer } };
});
vi.mock("obsidian", () => mocks);
vi.mock("../src/host/dashboard-layout-controller", () => ({ DashboardLayoutController: class {} }));
vi.mock("../src/host/research-card", () => ({ ResearchCard: class {} }));
vi.mock("../src/host/skills-card", () => ({ SkillsCard: class {} }));
vi.mock("../src/host/usage-card", () => ({ UsageCard: class {} }));

const { TasksCard } = await import("../src/host/tasks-card");
const { DashboardView } = await import("../src/host/dashboard-view");

const win = new Window();
const doc = win.document as unknown as Document;

/** Die DOM-Helfer, die Obsidian an Element und window hängt (createDiv, createSpan, createEl, empty); happy-dom kennt sie nicht. */
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
  (globalThis as Record<string, unknown>).createDiv = (info?: Info) => baue("div", info);
});

/** Zeitstempel je Klick eine Sekunde weiter: Die Karte „Heute“ verwirft Zeilenklicks binnen 350 ms (Fix-Runde 2 zu Abend 44). */
let uhr = 1_000_000;
const click = (target: Element): MouseEvent => {
  const ev = new win.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as MouseEvent;
  uhr += 1000;
  Object.defineProperty(ev, "timeStamp", { value: uhr });
  target.dispatchEvent(ev);
  return ev;
};
/** Mittelklick (Abend 30): Der Browser meldet ihn als auxclick mit button 1, nicht als click; button 2 ist die rechte Taste. */
const mittelklick = (target: Element, button = 1): MouseEvent => {
  const ev = new win.MouseEvent("auxclick", { bubbles: true, cancelable: true, button }) as unknown as MouseEvent;
  target.dispatchEvent(ev);
  return ev;
};
/** Lässt async-Pfade (toggle, openLinkText) durchlaufen, bevor "nicht passiert" geprüft wird. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));
const all = (root: ParentNode, sel: string): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(sel)];

/** Abhängigkeiten der Karte „Heute“ (Abend 44) ohne Briefing und Erinnerungen; „Erledigt“ aufgeklappt, damit erledigte Aufgaben sichtbar sind. */
function kartenDeps(settings: CockpitSettings): TasksCardDeps {
  const reminders = { state: new Observable({ kind: "off" }), isBusy: () => false, setCompleted: vi.fn(), refresh: vi.fn() } as unknown as RemindersController;
  return {
    settings: () => settings,
    onSettingsChange: () => () => {},
    now: () => new Date(2026, 10, 11, 9, 0),
    briefingDone: () => [],
    setBriefingDone: vi.fn(),
    remindersDone: () => [],
    setReminderDone: vi.fn(),
    onTodayChange: () => () => {},
    reminders,
    doneOpen: () => true,
    setDoneOpen: vi.fn(),
  };
}

describe("Aufgabenkarte: Wikilinks klickbar", () => {
  const FILE = "Listen/Aufgaben.md";
  const START = [
    "# Aufgaben",
    "",
    "- [ ] Siehe [[Notiz#Abschnitt|Alias]] und [[Zweite Notiz]] jetzt",
    "- [ ] Nur Text mit **fett** und [Link](x)",
  ].join("\n");

  let data: string;
  let el: HTMLElement;
  let process: ReturnType<typeof vi.fn>;
  let openLinkText: ReturnType<typeof vi.fn>;

  async function aufbau(): Promise<void> {
    notices.length = 0;
    data = START;
    el = doc.createElement("div");
    const file = new TFile(FILE);
    process = vi.fn(async (_f: unknown, fn: (d: string) => string) => { data = fn(data); return data; });
    openLinkText = vi.fn(async () => {});
    const app = {
      vault: {
        getFileByPath: (p: string) => (p === FILE ? file : null),
        cachedRead: async () => data,
        process,
        on: () => ({}),
      },
      metadataCache: {
        getFileCache: () => ({
          headings: [{ position: { start: { line: 0 } }, level: 1, heading: "Aufgaben" }],
          listItems: [2, 3].map((line) => ({ position: { start: { line } }, task: " ", parent: -1 })),
        }),
        on: () => ({}),
      },
      workspace: { openLinkText },
    };
    const owner = { app, containerEl: { win }, registerEvent: vi.fn(), register: vi.fn() };
    const settings: CockpitSettings = { ...DEFAULT_SETTINGS, tasksFile: FILE };
    new TasksCard(owner as never, el, kartenDeps(settings)).start();
    await vi.waitFor(() => expect(all(el, ".cockpit-task")).toHaveLength(2));
  }
  beforeEach(aufbau);

  const zeile = (i: number) => all(el, ".cockpit-task")[i];
  /** Der i-te Wikilink der Zeile; fehlt er, scheitert die Zusicherung hier statt an einem undefined im Klick. */
  const link = (zeilenNr: number, i: number): HTMLElement => {
    const links = all(zeile(zeilenNr), "a.internal-link");
    expect(links.length).toBeGreaterThan(i);
    return links[i];
  };

  it("Wikilinks stehen als a.internal-link mit data-href = Ziel und Text = Anzeige im Satz, der Rest bleibt Text", () => {
    const links = all(zeile(0), "a.internal-link");
    expect(links.map((a) => [a.getAttribute("data-href"), a.textContent])).toEqual([
      ["Notiz#Abschnitt", "Alias"],
      ["Zweite Notiz", "Zweite Notiz"],
    ]);
    expect(zeile(0).querySelector(".cockpit-task-text")?.textContent).toBe("Siehe Alias und Zweite Notiz jetzt");
  });

  it("andere Markdown-Formate bleiben roh, ohne Wikilink gibt es keinen Link", () => {
    expect(all(zeile(1), "a")).toHaveLength(0);
    expect(zeile(1).querySelector(".cockpit-task-text")?.textContent).toBe("Nur Text mit **fett** und [Link](x)");
  });

  it("Klick auf den Link öffnet das Ziel im neuen Tab (Quelle = Aufgabendatei), verhindert den Standard und schaltet NICHT um", async () => {
    const ev = click(link(0, 0));
    await flush();
    expect(openLinkText).toHaveBeenCalledTimes(1);
    expect(openLinkText).toHaveBeenCalledWith("Notiz#Abschnitt", FILE, "tab");
    expect(ev.defaultPrevented).toBe(true);
    expect(process).not.toHaveBeenCalled();
    expect(data).toBe(START);
  });

  it("zweiter Link derselben Zeile öffnet sein eigenes Ziel", async () => {
    click(link(0, 1));
    await flush();
    expect(openLinkText).toHaveBeenCalledWith("Zweite Notiz", FILE, "tab");
    expect(process).not.toHaveBeenCalled();
  });

  it("Mittelklick auf den Link öffnet das Ziel genau einmal im neuen Tab, verhindert den Standard und erreicht die Zeile nicht (Abend 30)", async () => {
    const anZeile = vi.fn();
    zeile(0).addEventListener("auxclick", anZeile);
    const ev = mittelklick(link(0, 0));
    await flush();
    expect(openLinkText).toHaveBeenCalledTimes(1);
    expect(openLinkText).toHaveBeenCalledWith("Notiz#Abschnitt", FILE, "tab");
    expect(ev.defaultPrevented).toBe(true);
    expect(anZeile).not.toHaveBeenCalled();
    expect(process).not.toHaveBeenCalled();
    expect(data).toBe(START);
  });

  it("rechte Taste (auxclick, button 2) auf den Link öffnet nichts und lässt den Standard (Kontextmenü) stehen", async () => {
    const ev = mittelklick(link(0, 0), 2);
    await flush();
    expect(openLinkText).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
    expect(process).not.toHaveBeenCalled();
  });

  it("Öffnen scheitert: Notice mit Ziel und Grund, die Aufgabe bleibt, wie sie ist (Abend 30)", async () => {
    openLinkText.mockRejectedValueOnce(new Error("kaputt"));
    click(link(0, 1));
    await vi.waitFor(() => expect(notices).toEqual(["Link lässt sich nicht öffnen: Zweite Notiz (kaputt)"]));
    expect(process).not.toHaveBeenCalled();
  });

  it("Klick auf den übrigen Zeilentext (und auf die Box) schaltet weiter um, ohne einen Link zu öffnen", async () => {
    click(zeile(0).querySelector(".cockpit-task-text")!);
    await vi.waitFor(() => expect(process).toHaveBeenCalledTimes(1));
    expect(data).toContain("- [x] Siehe [[Notiz#Abschnitt|Alias]]");
    click(zeile(1).querySelector(".cockpit-task-box")!);
    await vi.waitFor(() => expect(process).toHaveBeenCalledTimes(2));
    expect(data).toContain("- [x] Nur Text mit **fett**");
    expect(openLinkText).not.toHaveBeenCalled();
  });
});

describe("Aufgabenkarte: Zustand beim Umschalten (Abend 29)", () => {
  const FILE = "Listen/Aufgaben.md";
  const START = "# Aufgaben\n\n- [ ] Erste\n- [x] Zweite\n";

  let data: string;
  let el: HTMLElement;
  let process: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    notices.length = 0;
    data = START;
    el = doc.createElement("div");
    const file = new TFile(FILE);
    process = vi.fn(async (_f: unknown, fn: (d: string) => string) => { data = fn(data); return data; });
    const app = {
      vault: { getFileByPath: (p: string) => (p === FILE ? file : null), cachedRead: async () => data, process, on: () => ({}) },
      metadataCache: {
        getFileCache: () => ({
          headings: [{ position: { start: { line: 0 } }, level: 1, heading: "Aufgaben" }],
          listItems: [2, 3].map((line) => ({ position: { start: { line } }, task: data.split("\n")[line][3], parent: -1 })),
        }),
        on: () => ({}),
      },
      workspace: { openLinkText: vi.fn() },
    };
    const owner = { app, containerEl: { win }, registerEvent: vi.fn(), register: vi.fn() };
    const settings: CockpitSettings = { ...DEFAULT_SETTINGS, tasksFile: FILE };
    new TasksCard(owner as never, el, kartenDeps(settings)).start();
    await vi.waitFor(() => expect(all(el, ".cockpit-task")).toHaveLength(2));
  });

  const box = (i: number) => all(el, ".cockpit-task")[i].querySelector(".cockpit-task-box")!;

  it("die angezeigte Zeile stimmt mit der Datei überein: umgeschaltet, in beide Richtungen", async () => {
    click(box(0));
    await vi.waitFor(() => expect(data).toBe("# Aufgaben\n\n- [x] Erste\n- [x] Zweite\n"));
    click(box(1));
    await vi.waitFor(() => expect(data).toBe("# Aufgaben\n\n- [x] Erste\n- [ ] Zweite\n"));
    expect(notices).toEqual([]);
  });

  it("Datei inzwischen abgehakt, Anzeige noch offen: nichts geschrieben, eine Notice nur mit dem Grund (kein „Datei geändert“-Präfix)", async () => {
    data = "# Aufgaben\n\n- [x] Erste\n- [x] Zweite\n"; // von außen abgehakt, die Karte zeigt „Erste“ noch offen
    click(box(0));
    await vi.waitFor(() => expect(process).toHaveBeenCalledTimes(1));
    await flush();
    expect(data).toBe("# Aufgaben\n\n- [x] Erste\n- [x] Zweite\n");
    expect(notices).toEqual(["Aufgabe ist schon abgehakt"]);
  });

  it("Datei inzwischen wieder offen, Anzeige noch erledigt: nichts geschrieben, Grund „schon offen“", async () => {
    data = "# Aufgaben\n\n- [ ] Erste\n- [ ] Zweite\n"; // von außen geöffnet, die Karte zeigt „Zweite“ noch erledigt
    click(box(1));
    await vi.waitFor(() => expect(process).toHaveBeenCalledTimes(1));
    await flush();
    expect(data).toBe("# Aufgaben\n\n- [ ] Erste\n- [ ] Zweite\n");
    expect(notices).toEqual(["Aufgabe ist schon offen"]);
  });

  it("Aufgabe verschwunden: nichts geschrieben, der Grund behält den Präfix „Die Datei hat sich geändert“", async () => {
    data = "# Aufgaben\n\n- [ ] Andere\n- [x] Zweite\n"; // „Erste“ ist von außen entfernt worden
    click(box(0));
    await vi.waitFor(() => expect(process).toHaveBeenCalledTimes(1));
    await flush();
    expect(data).toBe("# Aufgaben\n\n- [ ] Andere\n- [x] Zweite\n");
    expect(notices).toEqual(["Die Datei hat sich geändert: Aufgabe nicht gefunden"]);
  });

  it("Aufgabe mehrfach in der Nähe: nichts geschrieben, der Grund behält den Präfix", async () => {
    data = "# Aufgaben\n- [ ] Erste\n- [ ] Andere\n- [ ] Erste\n"; // „Erste“ steht nicht mehr an Zeile 2, aber zweimal darum herum
    click(box(0));
    await vi.waitFor(() => expect(process).toHaveBeenCalledTimes(1));
    await flush();
    expect(data).toBe("# Aufgaben\n- [ ] Erste\n- [ ] Andere\n- [ ] Erste\n");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/^Die Datei hat sich geändert: Aufgabe mehrdeutig/);
  });
});

describe("Briefing: Wikilinks klickbar", () => {
  const DIR = "Briefings";
  const PFAD = `${DIR}/2026-10-12.md`;

  let openLinkText: ReturnType<typeof vi.fn>;
  let requestSaveLayout: ReturnType<typeof vi.fn>;
  let send: ReturnType<typeof vi.fn>;
  let card: HTMLElement;
  let intern: { opened: boolean; expanded: boolean; cardEl: HTMLElement | null; loadBriefings(): Promise<void> };

  beforeEach(async () => {
    notices.length = 0;
    vi.mocked(MarkdownRenderer.render).mockImplementation(async (_app, _md, el) => {
      el.innerHTML =
        '<p>Heute <a class="internal-link" data-href="Notiz#Abschnitt" href="Notiz#Abschnitt"><strong>Anzeige</strong></a>' +
        ' und <a class="external-link" href="https://example.org/">extern</a> sowie Text.</p>';
    });
    const file = new TFile(PFAD);
    openLinkText = vi.fn(async () => {});
    requestSaveLayout = vi.fn();
    send = vi.fn();
    const app = {
      vault: {
        getFolderByPath: (p: string) => (p === DIR ? { children: [file] } : null),
        getFileByPath: (p: string) => (p === PFAD ? file : null),
        cachedRead: async () => "# Briefing\n",
      },
      workspace: { openLinkText, requestSaveLayout },
    };
    const settings: CockpitSettings = { ...DEFAULT_SETTINGS, briefingsDir: DIR };
    const deps = { settings: () => settings, send, actions: { openSettings: vi.fn() } } as unknown as DashboardDeps;
    const view = new DashboardView({ app } as never, deps);
    intern = view as unknown as typeof intern;
    card = doc.createElement("div");
    intern.cardEl = card;
    intern.opened = true;
    intern.expanded = true;
    await intern.loadBriefings();
  });

  const text = () => card.querySelector<HTMLElement>(".cockpit-briefing-text")!;

  it("das gerenderte Briefing steht in der Karte", () => {
    expect(text().querySelectorAll("a.internal-link")).toHaveLength(1);
  });

  it("Klick auf einen internen Link (auch auf ein Kind im Link) öffnet ihn im neuen Tab, Quelle = Briefing-Datei, Standard verhindert", async () => {
    const ev = click(text().querySelector("a.internal-link strong")!);
    await flush();
    expect(openLinkText).toHaveBeenCalledTimes(1);
    expect(openLinkText).toHaveBeenCalledWith("Notiz#Abschnitt", PFAD, "tab");
    expect(ev.defaultPrevented).toBe(true);
  });

  it("Mittelklick auf einen internen Link öffnet ihn genau einmal im neuen Tab, Standard verhindert (Abend 30)", async () => {
    const ev = mittelklick(text().querySelector("a.internal-link strong")!);
    await flush();
    expect(openLinkText).toHaveBeenCalledTimes(1);
    expect(openLinkText).toHaveBeenCalledWith("Notiz#Abschnitt", PFAD, "tab");
    expect(ev.defaultPrevented).toBe(true);
  });

  it("rechte Taste auf einen internen Link und Mittelklick auf Text oder externen Link tun nichts, der Standard bleibt", async () => {
    const rechts = mittelklick(text().querySelector("a.internal-link")!, 2);
    const aufText = mittelklick(text().querySelector("p")!);
    const aufExtern = mittelklick(text().querySelector("a.external-link")!);
    await flush();
    expect(openLinkText).not.toHaveBeenCalled();
    expect([rechts.defaultPrevented, aufText.defaultPrevented, aufExtern.defaultPrevented]).toEqual([false, false, false]);
  });

  it("Öffnen wirft: Notice mit Ziel und Grund statt einer unbehandelten Ablehnung (Abend 30)", async () => {
    openLinkText.mockImplementationOnce(() => { throw new Error("weg"); });
    click(text().querySelector("a.internal-link")!);
    await vi.waitFor(() => expect(notices).toEqual(["Link lässt sich nicht öffnen: Notiz#Abschnitt (weg)"]));
  });

  it("Klick auf Text oder externen Link tut nichts (kein Öffnen, Standard bleibt)", async () => {
    const aufText = click(text().querySelector("p")!);
    const aufExtern = click(text().querySelector("a.external-link")!);
    await flush();
    expect(openLinkText).not.toHaveBeenCalled();
    expect(aufText.defaultPrevented).toBe(false);
    expect(aufExtern.defaultPrevented).toBe(false);
  });

  it("Kopfzeile klappt weiter zu und \"Hiermit weiterarbeiten\" sendet, beides ohne einen Link zu öffnen", async () => {
    click(card.querySelector<HTMLElement>(".cockpit-card-continue")!);
    expect(send).toHaveBeenCalledTimes(1);
    click(card.querySelector<HTMLElement>(".cockpit-card-head")!);
    await flush();
    expect(intern.expanded).toBe(false);
    expect(requestSaveLayout).toHaveBeenCalledTimes(1);
    expect(openLinkText).not.toHaveBeenCalled();
  });
});

describe("Dashboard: Karte „Heute“ im View-State und im Instrument (Abend 44)", () => {
  const today: TodayView = {
    open: [{ kind: "source", text: "Briefing" }, { kind: "briefing", key: "a", text: "Punkt [[Ziel|Alias]]", done: false, locked: false }],
    done: [{ kind: "task", line: 3, text: "Fertig", done: true, depth: 0 }, { kind: "task", line: 4, text: "Auch fertig", done: true, depth: 0 }],
    doneCount: 2,
    total: 3,
    openTexts: ["Punkt [[Ziel|Alias]]"],
    tasksMissing: true,
  };
  let view: InstanceType<typeof DashboardView>;
  let requestSaveLayout: ReturnType<typeof vi.fn>;
  let intern: { tasks: unknown; opened: boolean; cockpitInputs(): { tasks: unknown } };

  beforeEach(() => {
    requestSaveLayout = vi.fn();
    const settings: CockpitSettings = { ...DEFAULT_SETTINGS };
    const deps = {
      settings: () => settings,
      pull: { state: { snapshot: () => ({ status: "ok", at: null, error: null }) } },
    } as unknown as DashboardDeps;
    view = new DashboardView({ app: { workspace: { requestSaveLayout } } } as never, deps);
    intern = view as unknown as typeof intern;
  });

  it("cockpitInputs bildet TasksInput aus dem Stand der Karte: offene Texte, Gesamtzahl, fehlende Liste", () => {
    intern.tasks = { data: new Observable({ kind: "ok", today }) };
    expect(intern.cockpitInputs().tasks).toEqual({ open: ["Punkt [[Ziel|Alias]]"], total: 3, tasksMissing: true });
    intern.tasks = { data: new Observable(null) };
    expect(intern.cockpitInputs().tasks).toBeNull();
  });

  it("doneOpen steht im View-State und kommt aus setState zurück", async () => {
    expect(view.getState()).toMatchObject({ doneOpen: false });
    await view.setState({ doneOpen: true }, {} as never);
    expect(view.getState()).toMatchObject({ doneOpen: true });
    await view.setState({ doneOpen: "ja" }, {} as never);
    expect(view.getState()).toMatchObject({ doneOpen: false });
  });

  it("setState({ doneOpen: true }) nach dem ersten Zeichnen klappt „Erledigt“ der Karte sofort auf", async () => {
    const FILE = "Listen/Aufgaben.md";
    const file = new TFile(FILE);
    const data = "# Aufgaben\n\n- [ ] Erste\n- [x] Zweite\n";
    const app = {
      vault: { getFileByPath: (p: string) => (p === FILE ? file : null), cachedRead: async () => data, process: vi.fn(), on: () => ({}) },
      metadataCache: {
        getFileCache: () => ({ headings: [], listItems: [2, 3].map((line) => ({ position: { start: { line } }, task: data.split("\n")[line][3], parent: -1 })) }),
        on: () => ({}),
      },
      workspace: { openLinkText: vi.fn() },
    };
    const el = doc.createElement("div");
    const owner = { app, containerEl: { win }, registerEvent: vi.fn(), register: vi.fn() };
    const card = new TasksCard(owner as never, el, { ...kartenDeps({ ...DEFAULT_SETTINGS, tasksFile: FILE }), doneOpen: () => (view as unknown as { doneOpen: boolean }).doneOpen });
    card.start();
    intern.tasks = card;
    await vi.waitFor(() => expect(el.querySelector(".cockpit-today-done-toggle")?.textContent).toBe("Erledigt (1)"));
    expect(all(el, ".cockpit-today-done .cockpit-task")).toHaveLength(0);
    await view.setState({ doneOpen: true }, {} as never);
    expect(all(el, ".cockpit-today-done .cockpit-task")).toHaveLength(1);
  });
});

describe("Dashboard: Öffnen und Schließen beim Erinnerungen-Controller paarig (Fix-Runde 1)", () => {
  let view: InstanceType<typeof DashboardView>;
  let reminders: { dashboardOpened: ReturnType<typeof vi.fn>; dashboardClosed: ReturnType<typeof vi.fn> };
  let intern: { remindersCounted: boolean; tasks: unknown };

  beforeEach(() => {
    reminders = { dashboardOpened: vi.fn(), dashboardClosed: vi.fn() };
    const deps = { settings: () => DEFAULT_SETTINGS, pull: { dashboardClosed: vi.fn() }, reminders } as unknown as DashboardDeps;
    view = new DashboardView({ app: { workspace: {} } } as never, deps);
    intern = view as unknown as typeof intern;
  });

  it("nicht gezählt (onOpen scheiterte davor): onClose meldet kein Schließen", async () => {
    await view.onClose();
    expect(reminders.dashboardClosed).not.toHaveBeenCalled();
  });

  it("gezählt: Schließen auch, wenn das Aufräumen wirft, und nur einmal", async () => {
    intern.remindersCounted = true;
    intern.tasks = { stop: () => { throw new Error("kaputt"); } };
    await expect(view.onClose()).rejects.toThrow("kaputt");
    expect(reminders.dashboardClosed).toHaveBeenCalledTimes(1);
    intern.tasks = null;
    await view.onClose();
    expect(reminders.dashboardClosed).toHaveBeenCalledTimes(1);
  });
});
