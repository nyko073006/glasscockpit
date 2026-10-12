import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalOptions } from "../src/core/terminal-options";
import { DEFAULT_SETTINGS } from "../src/core/settings";
import type { TerminalDeps } from "../src/host/terminal-view";
import { TerminalInput, type TerminalInputOptions } from "../src/host/terminal-input";

// Drop-Verdrahtung (Abend 29): Was der Host aus planDrop macht und wie der Name-Resolver bis zum Drop kommt.
// Teil 1 fährt die echte TerminalInput mit Fake-Container und Fake-DataTransfer (Node-Modus, kein DOM): Der Drop-Listener, den die
// Klasse am Dokument anmeldet, wird mit einem Ereignis aufgerufen, gemessen werden write und notify.
// Teil 2 fährt die echte TerminalView bis onOpen und liest ab, was sie der TerminalPane als Drop-Optionen übergibt.

const { notices, paneArgs } = vi.hoisted(() => ({ notices: [] as string[], paneArgs: [] as unknown[][] }));

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
  Notice: class {
    constructor(text: string) {
      notices.push(text);
    }
  },
  Modal: class {},
}));
vi.mock("../src/host/attention-alert", () => ({ playSound: vi.fn(), showBanner: vi.fn() }));
vi.mock("../src/host/code-block-bar", () => ({ CodeBlockBar: class {}, copyCodeBlock: vi.fn() }));
vi.mock("../src/host/terminal-pane", () => ({
  TerminalPane: class {
    constructor(...args: unknown[]) {
      paneArgs.push(args);
    }
    registerLinkProvider() {
      return () => {};
    }
  },
}));
vi.mock("../src/host/file-links", () => ({ FileLinkProvider: class {} }));
vi.mock("../src/host/file-viewer-fs", () => ({ isFileSync: () => false }));
vi.mock("../src/host/rename-modal", () => ({ RenameModal: class {} }));

const { TerminalView } = await import("../src/host/terminal-view");

const BASE = "/Users/alex/vault-a";
const OK = '/Users/alex/projekt-a/x"y.txt'; // " ohne Leerzeichen: lesbar, unmaskiert
const MIT_LEERZEICHEN = "/Users/alex/projekt-a/ok datei.txt"; // lesbar, in Anführungsform
const ABGELEHNT = '/Users/alex/projekt-a/a "b" c.txt'; // " und Leerzeichen: unlesbar
const ABGELEHNT_2 = '/Users/alex/projekt-a/d"e f.txt';
const fileUrl = (pfad: string): string => `file://${encodeURI(pfad).replace(/"/g, "%22")}`;

beforeEach(() => {
  notices.length = 0;
  paneArgs.length = 0;
  vi.spyOn(console, "debug").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("TerminalInput.drop: Meldung und Schreiben aus planDrop", () => {
  /** Echte TerminalInput; der Drop-Listener am Fake-Dokument ist der, den die Klasse selbst anmeldet. */
  function aufbau(resolveName: TerminalInputOptions["resolveName"] = () => null) {
    const geschrieben: string[] = [];
    const gemeldet: string[] = [];
    const listener: Record<string, (ev: unknown) => void> = {};
    const doc = {
      addEventListener: (type: string, fn: (ev: unknown) => void) => {
        listener[type] = fn;
      },
      removeEventListener: () => {},
    };
    const container = { doc, win: {}, contains: () => true, onWindowMigrated: () => () => {} };
    const term = { attachCustomKeyEventHandler: () => {}, element: undefined };
    new TerminalInput({
      term: term as never,
      container: container as never,
      write: (data) => geschrieben.push(data),
      vaultBase: () => BASE,
      resolveName,
      notify: (text) => gemeldet.push(text),
    });
    /** Ein Drop mit Fake-DataTransfer: `texte` je Typ, `dateien` als File-Attrappen mit `path`. */
    const drop = (texte: Record<string, string>, dateien: Array<{ path: string }> = []): void => {
      const dt = { types: Object.keys(texte), getData: (typ: string) => texte[typ] ?? "", files: dateien };
      listener.drop({ target: { nodeType: 1 }, preventDefault() {}, stopPropagation() {}, dataTransfer: dt });
    };
    return { geschrieben, gemeldet, drop };
  }

  it("gemischter Drop (text/uri-list): lesbare Pfade werden eingefügt, der abgelehnte kommt als Meldung mit Dateiname", () => {
    const { geschrieben, gemeldet, drop } = aufbau();
    drop({ "text/uri-list": [OK, ABGELEHNT, MIT_LEERZEICHEN].map(fileUrl).join("\r\n") });
    expect(geschrieben).toEqual([`@${OK} @"${MIT_LEERZEICHEN}" `]);
    expect(gemeldet).toEqual(['Pfad mit " kann Claude nicht als @-Erwähnung lesen: a "b" c.txt']);
  });

  it("alles abgelehnt: nichts wird geschrieben (auch kein leerer Text), die Meldung nennt jeden Dateinamen", () => {
    const { geschrieben, gemeldet, drop } = aufbau();
    drop({ "text/uri-list": [ABGELEHNT, ABGELEHNT_2].map(fileUrl).join("\n") });
    expect(geschrieben).toEqual([]);
    expect(gemeldet).toEqual(['Claude kann Pfade mit " nicht als @-Erwähnung lesen: a "b" c.txt, d"e f.txt']);
  });

  it("ein einziger abgelehnter Pfad: nichts geschrieben, Meldung im Singular", () => {
    const { geschrieben, gemeldet, drop } = aufbau();
    drop({ "text/uri-list": fileUrl(ABGELEHNT) });
    expect(geschrieben).toEqual([]);
    expect(gemeldet).toEqual(['Pfad mit " kann Claude nicht als @-Erwähnung lesen: a "b" c.txt']);
  });

  it("nichts abgelehnt: geschrieben, keine Meldung", () => {
    const { geschrieben, gemeldet, drop } = aufbau();
    drop({ "text/uri-list": [OK, MIT_LEERZEICHEN].map(fileUrl).join("\n") });
    expect(geschrieben).toEqual([`@${OK} @"${MIT_LEERZEICHEN}" `]);
    expect(gemeldet).toEqual([]);
  });

  it("dasselbe gilt für Dateien mit Pfad (erste Stufe, File.path)", () => {
    const { geschrieben, gemeldet, drop } = aufbau();
    drop({}, [{ path: MIT_LEERZEICHEN }, { path: ABGELEHNT }]);
    expect(geschrieben).toEqual([`@"${MIT_LEERZEICHEN}" `]);
    expect(gemeldet).toEqual(['Pfad mit " kann Claude nicht als @-Erwähnung lesen: a "b" c.txt']);
  });

  it("obsidian://-Drop (text/plain): der Name geht an resolveName, eingefügt wird der volle Pfad im Vault", () => {
    const resolveName = vi.fn((name: string) => (name === "Notiz" ? "Ordner/Notiz.md" : null));
    const { geschrieben, gemeldet, drop } = aufbau(resolveName);
    drop({ "text/plain": "obsidian://open?vault=vault-a&file=Notiz" });
    expect(resolveName).toHaveBeenCalledWith("Notiz");
    expect(geschrieben).toEqual([`@${BASE}/Ordner/Notiz.md `]);
    expect(gemeldet).toEqual([]);
  });

  it("obsidian://-Drop mit unbekanntem Namen: resolveName liefert null, nichts wird geschrieben", () => {
    const resolveName = vi.fn(() => null);
    const { geschrieben, gemeldet, drop } = aufbau(resolveName);
    drop({ "text/plain": "obsidian://open?vault=vault-a&file=Gibt%20es%20nicht" });
    expect(resolveName).toHaveBeenCalledWith("Gibt es nicht");
    expect(geschrieben).toEqual([]);
    expect(gemeldet).toEqual([]);
  });
});

describe("TerminalView.onOpen: Drop-Optionen der Pane", () => {
  /** Echte TerminalView bis onOpen; das Plugin-Umfeld ist Fake, die Pane zeichnet ihre Konstruktor-Argumente auf. */
  async function aufbau(findet: (name: string, quelle: string) => { path: string } | null) {
    const getFirstLinkpathDest = vi.fn(findet);
    const app = { metadataCache: { getFirstLinkpathDest }, workspace: { on: () => ({}), getActiveViewOfType: () => null } };
    const leaf = { app, updateHeader: vi.fn(), tabHeaderEl: { setAttr: vi.fn() } };
    const deps = {
      settings: () => ({ ...DEFAULT_SETTINGS }),
      vaultBase: () => BASE,
      home: "/Users/alex",
      record: () => null,
      onSettingsChange: () => () => {},
      onRecordChange: () => () => {},
    };
    const view = new TerminalView(leaf as never, deps as unknown as TerminalDeps);
    await view.onOpen();
    expect(paneArgs).toHaveLength(1);
    const [, , , optionen, drop] = paneArgs[0] as [unknown, unknown, unknown, TerminalOptions, Pick<TerminalInputOptions, "resolveName" | "notify">];
    return { drop, getFirstLinkpathDest, optionen };
  }

  it("resolveName fragt metadataCache.getFirstLinkpathDest(name, \"\") und gibt den Vault-Pfad der Datei zurück", async () => {
    const { drop, getFirstLinkpathDest } = await aufbau((name) => (name === "Notiz" ? { path: "Ordner/Notiz.md" } : null));
    expect(drop.resolveName("Notiz")).toBe("Ordner/Notiz.md");
    expect(getFirstLinkpathDest).toHaveBeenCalledTimes(1);
    expect(getFirstLinkpathDest).toHaveBeenCalledWith("Notiz", "");
  });

  it("resolveName gibt null zurück, wenn es die Datei im Vault nicht gibt", async () => {
    const { drop, getFirstLinkpathDest } = await aufbau(() => null);
    expect(drop.resolveName("Gibt es nicht")).toBeNull();
    expect(getFirstLinkpathDest).toHaveBeenCalledWith("Gibt es nicht", "");
  });

  it("notify zeigt den Text als Obsidian-Notice", async () => {
    const { drop } = await aufbau(() => null);
    drop.notify('Pfad mit " kann Claude nicht als @-Erwähnung lesen: a "b" c.txt');
    expect(notices).toEqual(['Pfad mit " kann Claude nicht als @-Erwähnung lesen: a "b" c.txt']);
  });
});
