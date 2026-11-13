import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type CockpitSettings as Settings } from "../src/core/settings";
import type { SessionMeta } from "../src/core/session-manager";
import type { TerminalDeps } from "../src/host/terminal-view";

// Weich scrollen (Nachtrag 43f): Verhalten der Entscheidung `enabled` und des Tempos, die die echte TerminalView der Pane gibt.
// Die Pane ist eine Attrappe (Aufbau wie in terminal-drop.test.ts) und merkt sich das source von attachSmoothWheel.

const { sources } = vi.hoisted(() => ({ sources: [] as Array<{ enabled(): boolean; tuning(): { speed: number; maxPerFrame: number } }> }));

vi.mock("obsidian", () => ({
  ItemView: class {
    leaf: { app: unknown };
    app: unknown;
    contentEl = {
      empty() {},
      addClass() {},
      createDiv: () => ({}),
      onWindowMigrated: () => () => {},
      win: { addEventListener() {}, removeEventListener() {} },
    };
    constructor(leaf: { app: unknown }) {
      this.leaf = leaf;
      this.app = leaf.app;
    }
    registerEvent() {}
    registerDomEvent() {}
  },
  Notice: class {},
  Modal: class {},
}));
vi.mock("../src/host/attention-alert", () => ({ playSound: vi.fn(), showBanner: vi.fn() }));
vi.mock("../src/host/code-block-bar", () => ({ CodeBlockBar: class {}, copyCodeBlock: vi.fn() }));
vi.mock("../src/host/terminal-pane", () => ({
  TerminalPane: class {
    registerLinkProvider() {
      return () => {};
    }
    attachSmoothWheel(source: (typeof sources)[number]) {
      sources.push(source);
      return () => {};
    }
  },
}));
vi.mock("../src/host/file-links", () => ({ FileLinkProvider: class {}, UrlLinkProvider: class {} }));
vi.mock("../src/host/file-viewer-fs", () => ({ isDirSync: () => false, isFileSync: () => false }));
vi.mock("../src/host/rename-modal", () => ({ RenameModal: class {} }));

const { TerminalView } = await import("../src/host/terminal-view");

beforeEach(() => {
  sources.length = 0;
  vi.spyOn(console, "debug").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

async function aufbau(opts: { settings: Partial<Settings>; meta: SessionMeta | null; session?: boolean }) {
  let aktuell: Settings = { ...DEFAULT_SETTINGS, ...opts.settings };
  const app = { metadataCache: {}, workspace: { on: () => ({}), getActiveViewOfType: () => null } };
  const leaf = { app, updateHeader: vi.fn(), tabHeaderEl: { setAttr: vi.fn() } };
  const deps = {
    settings: () => aktuell,
    vaultBase: () => "/v",
    home: "/h",
    record: () => null,
    manager: { meta: () => opts.meta },
    onSettingsChange: () => () => {},
    onRecordChange: () => () => {},
  };
  const view = new TerminalView(leaf as never, deps as unknown as TerminalDeps);
  await view.onOpen();
  if (opts.session !== false) (view as unknown as { sessionId: string }).sessionId = "sitzung-1";
  expect(sources).toHaveLength(1);
  return { source: sources[0], setze: (patch: Partial<Settings>) => { aktuell = { ...aktuell, ...patch }; } };
}

const NEU: SessionMeta = { kind: "claude", title: "t", smoothScroll: true };

describe("TerminalView: Übernahme des Scrollens (43f)", () => {
  it("(a) an, Meta mit smoothScroll, Sitzung gesetzt: enabled true, Tempo aus den Einstellungen", async () => {
    const { source } = await aufbau({ settings: { smoothScroll: true, scrollSpeed: 2.5, scrollMaxPerFrame: 7 }, meta: NEU });
    expect(source.enabled()).toBe(true);
    expect(source.tuning()).toEqual({ speed: 2.5, maxPerFrame: 7 });
  });

  it("(b) Einstellung aus: false", async () => {
    const { source } = await aufbau({ settings: { smoothScroll: false }, meta: NEU });
    expect(source.enabled()).toBe(false);
  });

  it("(c) Sitzung ohne smoothScroll im Meta (lief vor dem Einschalten): false", async () => {
    const { source } = await aufbau({ settings: { smoothScroll: true }, meta: { kind: "claude", title: "t" } });
    expect(source.enabled()).toBe(false);
  });

  it("(d) keine Sitzung: false", async () => {
    const { source } = await aufbau({ settings: { smoothScroll: true }, meta: NEU, session: false });
    expect(source.enabled()).toBe(false);
  });

  it("(e) Einstellung zwischen zwei Aufrufen ausgeschaltet: erst true, dann false (je Ereignis frisch)", async () => {
    const { source, setze } = await aufbau({ settings: { smoothScroll: true }, meta: NEU });
    expect(source.enabled()).toBe(true);
    setze({ smoothScroll: false });
    expect(source.enabled()).toBe(false);
  });
});
