// Diff-Ansicht (Abend 17): Steuerung ohne Obsidian: Handler der Tools, Warten auf die Entscheidung, Aufräumen.
import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { jsonResult } from "../src/core/ide-protocol";
import type { DiffRequest } from "../src/core/diff-sessions";
import type { OpenDiffArgs } from "../src/core/ide-diff";
import { IdeDiff, type IdeDiffDeps } from "../src/host/ide-diff";
import { MAX_OLD_FILE_BYTES, readOldFile } from "../src/host/ide-diff-fs";
import { IdeServer, pidAlive } from "../src/host/ide-server";

const args = (over: Partial<OpenDiffArgs> = {}): OpenDiffArgs => ({ oldFilePath: "/r/a.txt", newFilePath: "/r/a.txt", newFileContents: "neu\n", tabName: "t1", ...over });
const settled = async (p: Promise<unknown>): Promise<unknown> => Promise.race([p, new Promise((r) => setTimeout(() => r("offen"), 25))]);

let files: Record<string, string | null | Error>;
let shown: Array<{ req: DiffRequest; id: string }>;
let hidden: string[];
let attention: Array<number | null>;
let d: IdeDiff;

beforeEach(() => {
  files = { "/r/a.txt": "alt\n" };
  shown = [];
  hidden = [];
  attention = [];
  const deps: IdeDiffDeps = {
    readOld: async (p) => {
      const f = files[p];
      if (f instanceof Error) throw f;
      return f ?? null;
    },
    show: (req, id) => shown.push({ req, id }),
    hide: (id) => hidden.push(id),
    attention: (c) => attention.push(c),
  };
  d = new IdeDiff(deps);
});

describe("openDiff", () => {
  it("liest die alte Fassung, zeigt den Tab, löst die Aufmerksamkeit aus und wartet", async () => {
    const p = d.handlers().openDiff(args(), 3);
    await settled(p);
    expect(shown).toHaveLength(1);
    expect(shown[0].req).toEqual({ tabName: "t1", oldFilePath: "/r/a.txt", newFilePath: "/r/a.txt", newFileContents: "neu\n", oldContents: "alt\n", clientId: 3 });
    expect(attention).toEqual([3]);
    expect(await settled(p)).toBe("offen");
    expect(d.pending).toBe(1);
  });
  it("Annehmen: FILE_SAVED und der Inhalt; geschrieben wird nichts (Claude schreibt selbst)", async () => {
    const p = d.handlers().openDiff(args(), 1);
    await settled(p);
    expect(d.decide(shown[0].id, "accepted")).toBe(true);
    expect(await p).toEqual({ content: [{ type: "text", text: "FILE_SAVED" }, { type: "text", text: "neu\n" }] });
    expect(d.pending).toBe(0);
  });
  it("Ablehnen: DIFF_REJECTED", async () => {
    const p = d.handlers().openDiff(args(), 1);
    await settled(p);
    d.decide(shown[0].id, "rejected");
    expect(await p).toEqual({ content: [{ type: "text", text: "DIFF_REJECTED" }] });
  });
  it("Tab schließen ohne Entscheidung: DIFF_REJECTED", async () => {
    const p = d.handlers().openDiff(args(), 1);
    await settled(p);
    d.viewClosed(shown[0].id);
    expect(await p).toEqual({ content: [{ type: "text", text: "DIFF_REJECTED" }] });
    expect(hidden).toEqual([]);
  });
  it("Datei fehlt (neue Datei): oldContents ist null, der Diff wird trotzdem gezeigt", async () => {
    const p = d.handlers().openDiff(args({ oldFilePath: "/r/neu.txt", newFilePath: "/r/neu.txt" }), 1);
    await settled(p);
    expect(shown[0].req.oldContents).toBeNull();
    d.decide(shown[0].id, "accepted");
    expect((await p).isError).toBeUndefined();
  });
  it("alte Fassung nicht lesbar: Fehlerergebnis, kein Tab, nichts hängt", async () => {
    files["/r/a.txt"] = new Error("EACCES: permission denied");
    const r = await d.handlers().openDiff(args(), 1);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("EACCES");
    expect(shown).toHaveLength(0);
    expect(attention).toEqual([]);
    expect(d.pending).toBe(0);
  });
  it("Datei außerhalb des Vaults ist erlaubt (kein Vault-Filter)", async () => {
    files["/Users/x/Repo/src/a.ts"] = "x\n";
    const p = d.handlers().openDiff(args({ oldFilePath: "/Users/x/Repo/src/a.ts", newFilePath: "/Users/x/Repo/src/a.ts" }), 1);
    await settled(p);
    expect(shown[0].req.oldContents).toBe("x\n");
    d.decide(shown[0].id, "rejected");
    await p;
  });
  it("gleicher tab_name ersetzt: der erste Aufruf endet mit DIFF_REJECTED, der zweite wartet", async () => {
    const a = d.handlers().openDiff(args({ newFileContents: "1\n" }), 1);
    await settled(a);
    const b = d.handlers().openDiff(args({ newFileContents: "2\n" }), 1);
    expect(await a).toEqual({ content: [{ type: "text", text: "DIFF_REJECTED" }] });
    expect(await settled(b)).toBe("offen");
    expect(d.pending).toBe(1);
  });
  it("die Aufmerksamkeit wirft: der Diff bleibt offen und normal entscheidbar (kein Ablehnen)", async () => {
    const dd = new IdeDiff({ readOld: async () => "alt\n", show: (r, id) => shown.push({ req: r, id }), hide: () => undefined, attention: () => { throw new Error("kaputt"); } });
    const p = dd.handlers().openDiff(args(), 1);
    expect(await settled(p)).toBe("offen");
    expect(dd.pending).toBe(1);
    expect(dd.decide(shown[0].id, "accepted")).toBe(true);
    expect(await p).toEqual({ content: [{ type: "text", text: "FILE_SAVED" }, { type: "text", text: "neu\n" }] });
  });
  it("show wirft: DIFF_REJECTED statt hängen", async () => {
    const dd = new IdeDiff({ readOld: async () => "alt\n", show: () => { throw new Error("Tab nicht möglich"); }, hide: () => undefined, attention: () => undefined });
    expect(await dd.handlers().openDiff(args(), 1)).toEqual({ content: [{ type: "text", text: "DIFF_REJECTED" }] });
  });
});

describe("Aufräumen während des Lesens der alten Fassung", () => {
  const rejected = { content: [{ type: "text", text: "DIFF_REJECTED" }] };
  /** Ein readOld, das erst auf release() antwortet. */
  function gated() {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    return { readOld: async () => { await gate; return "alt\n"; }, release };
  }
  const make = (g: { readOld: () => Promise<string> }, extra: Partial<IdeDiffDeps> = {}) =>
    new IdeDiff({ readOld: g.readOld, show: (r, id) => shown.push({ req: r, id }), hide: (id) => hidden.push(id), attention: () => undefined, ...extra });

  it("Verbindung weg während des Lesens: DIFF_REJECTED, kein Tab, kein Waisen-Diff", async () => {
    const g = gated();
    const dd = make(g);
    const p = dd.handlers().openDiff(args(), 5);
    dd.closeClient(5);
    g.release();
    expect(await p).toEqual(rejected);
    expect(shown).toHaveLength(0);
    expect(dd.pending).toBe(0);
  });
  it("closeAll (Einstellung aus) während des Lesens: DIFF_REJECTED, kein Tab", async () => {
    const g = gated();
    const dd = make(g);
    const p = dd.handlers().openDiff(args(), 5);
    dd.closeAll();
    g.release();
    expect(await p).toEqual(rejected);
    expect(shown).toHaveLength(0);
    expect(dd.pending).toBe(0);
  });
  it("closeAllDiffTabs derselben Verbindung während des Lesens: ebenso", async () => {
    const g = gated();
    const dd = make(g);
    const p = dd.handlers().openDiff(args(), 5);
    dd.handlers().closeAllDiffTabs(5);
    g.release();
    expect(await p).toEqual(rejected);
    expect(dd.pending).toBe(0);
  });
  it("eine andere Verbindung räumt auf: der lesende Aufruf bleibt gültig", async () => {
    const g = gated();
    const dd = make(g);
    const p = dd.handlers().openDiff(args(), 5);
    dd.closeClient(6);
    g.release();
    expect(await settled(p)).toBe("offen");
    expect(dd.pending).toBe(1);
  });
  it("Verbindung nach dem Lesen nicht mehr da (clientAlive false) oder ideDiff aus (enabled false): DIFF_REJECTED, kein Tab", async () => {
    const g1 = gated();
    const a = make(g1, { clientAlive: () => false });
    const pa = a.handlers().openDiff(args(), 5);
    g1.release();
    expect(await pa).toEqual(rejected);
    const g2 = gated();
    const b = make(g2, { enabled: () => false });
    const pb = b.handlers().openDiff(args(), 5);
    g2.release();
    expect(await pb).toEqual(rejected);
    expect(shown).toHaveLength(0);
  });
  it("dispose während des Lesens: DIFF_REJECTED, kein Tab", async () => {
    const g = gated();
    const dd = make(g);
    const p = dd.handlers().openDiff(args(), 5);
    dd.dispose();
    g.release();
    expect(await p).toEqual(rejected);
    expect(shown).toHaveLength(0);
  });
});

describe("close_tab und closeAllDiffTabs", () => {
  it("close_tab: TAB_CLOSED, der offene Diff wird abgelehnt, der Tab geschlossen", async () => {
    const p = d.handlers().openDiff(args(), 1);
    await settled(p);
    expect(await d.handlers().closeTab("t1", 1)).toEqual({ content: [{ type: "text", text: "TAB_CLOSED" }] });
    expect(await p).toEqual({ content: [{ type: "text", text: "DIFF_REJECTED" }] });
    expect(hidden).toEqual([shown[0].id]);
  });
  it("close_tab für einen unbekannten Namen: trotzdem TAB_CLOSED", async () => {
    expect(await d.handlers().closeTab("gibt-es-nicht", 1)).toEqual({ content: [{ type: "text", text: "TAB_CLOSED" }] });
  });
  it("close_tab einer anderen Verbindung lässt den Diff stehen", async () => {
    const p = d.handlers().openDiff(args(), 1);
    await settled(p);
    await d.handlers().closeTab("t1", 2);
    expect(await settled(p)).toBe("offen");
  });
  it("closeAllDiffTabs: nur die eigenen Diffs der Verbindung, Zahl im Ergebnis", async () => {
    const a = d.handlers().openDiff(args({ tabName: "a" }), 1);
    const b = d.handlers().openDiff(args({ tabName: "b" }), 1);
    const c = d.handlers().openDiff(args({ tabName: "c" }), 2);
    await settled(a);
    expect(await d.handlers().closeAllDiffTabs(1)).toEqual({ content: [{ type: "text", text: "CLOSED_2_DIFF_TABS" }] });
    expect((await a).content[0].text).toBe("DIFF_REJECTED");
    expect((await b).content[0].text).toBe("DIFF_REJECTED");
    expect(await settled(c)).toBe("offen");
    expect(d.pending).toBe(1);
  });
  it("closeAllDiffTabs ohne offene Diffs: CLOSED_0_DIFF_TABS (Claude sendet es zu Beginn jedes Zuges)", async () => {
    expect(await d.handlers().closeAllDiffTabs(1)).toEqual({ content: [{ type: "text", text: "CLOSED_0_DIFF_TABS" }] });
  });
});

describe("Aufräumen", () => {
  it("Verbindung weg: ihre Diffs sind abgelehnt, die Tabs zu", async () => {
    const a = d.handlers().openDiff(args({ tabName: "a" }), 1);
    await settled(a);
    expect(d.closeClient(1)).toBe(1);
    expect((await a).content[0].text).toBe("DIFF_REJECTED");
    expect(hidden).toHaveLength(1);
  });
  it("closeAll (Einstellung aus): alle abgelehnt und geschlossen", async () => {
    const a = d.handlers().openDiff(args({ tabName: "a" }), 1);
    const b = d.handlers().openDiff(args({ tabName: "b" }), 2);
    await settled(a);
    expect(d.closeAll()).toBe(2);
    expect((await a).content[0].text).toBe("DIFF_REJECTED");
    expect((await b).content[0].text).toBe("DIFF_REJECTED");
    expect(hidden).toHaveLength(2);
  });
  it("dispose (Entladen): alle abgelehnt, Tabs zu, danach lehnt jeder neue Aufruf sofort ab und öffnet nichts", async () => {
    const a = d.handlers().openDiff(args({ tabName: "a" }), 1);
    await settled(a);
    expect(d.dispose()).toBe(1);
    expect((await a).content[0].text).toBe("DIFF_REJECTED");
    expect(hidden).toHaveLength(1);
    shown.length = 0;
    expect((await d.handlers().openDiff(args({ tabName: "z" }), 1)).content[0].text).toBe("DIFF_REJECTED");
    expect(shown).toHaveLength(0);
  });
  it("request(id) liefert die offene Anfrage für die Ansicht, nach dem Ende null", async () => {
    const p = d.handlers().openDiff(args(), 1);
    await settled(p);
    expect(d.request(shown[0].id)?.tabName).toBe("t1");
    d.decide(shown[0].id, "accepted");
    await p;
    expect(d.request(shown[0].id)).toBeNull();
  });
});

describe("readOldFile (echte Dateien)", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "diff-fs-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  it("liest UTF-8", async () => {
    writeFileSync(join(dir, "a.txt"), "äöü\n");
    expect(await readOldFile(join(dir, "a.txt"))).toBe("äöü\n");
  });
  it("fehlt die Datei: null", async () => {
    expect(await readOldFile(join(dir, "gibt-es-nicht"))).toBeNull();
  });
  it("Ordner statt Datei: Fehler, nicht null", async () => {
    mkdirSync(join(dir, "ordner"));
    await expect(readOldFile(join(dir, "ordner"))).rejects.toThrow();
  });
  it("zu große Datei: Fehler mit Größenhinweis", async () => {
    const f = join(dir, "gross.bin");
    writeFileSync(f, "");
    truncateSync(f, MAX_OLD_FILE_BYTES + 1);
    await expect(readOldFile(f)).rejects.toThrow(/zu groß/);
  });
  it("genau an der Grenze wird gelesen", async () => {
    const f = join(dir, "grenze.txt");
    writeFileSync(f, "");
    truncateSync(f, MAX_OLD_FILE_BYTES);
    expect((await readOldFile(f))?.length).toBe(MAX_OLD_FILE_BYTES);
  });
});

describe("IdeDiff am echten Server (ws-Client wie Claude)", () => {
  // Die Folge aus der echten Probe: closeAllDiffTabs, openDiff (blockiert), Antwort, close_tab.
  let dir: string;
  let server: IdeServer;
  let sock: WebSocket | null;
  const TOKEN = "ab".repeat(16);

  async function start(diff: IdeDiff, an = true): Promise<WebSocket> {
    server = new IdeServer({
      lockDir: dir, workspaceFolders: () => ["/v"], vaultBase: () => "/v", pid: process.pid, isPidAlive: pidAlive, newToken: () => TOKEN, warn: () => undefined,
      handlers: {
        getCurrentSelection: () => jsonResult({}), getLatestSelection: () => jsonResult({}), getOpenEditors: () => jsonResult({}), getWorkspaceFolders: () => jsonResult({}),
        openFile: () => jsonResult({}), checkDocumentDirty: () => jsonResult({}), saveDocument: () => jsonResult({}), diff: diff.handlers(),
      },
      diffEnabled: () => an,
      onClientClose: (id) => diff.closeClient(id),
    });
    const port = await server.start();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`, ["mcp"], { headers: { "x-claude-code-ide-authorization": TOKEN } });
    sock = ws;
    await new Promise<void>((resolve, reject) => { ws.once("open", () => resolve()); ws.once("error", reject); });
    return ws;
  }
  const call = (ws: WebSocket, id: number, name: string, a: object): Promise<any> =>
    new Promise((resolve) => {
      const on = (data: WebSocket.RawData) => { const m = JSON.parse(data.toString()); if (m.id === id) { ws.off("message", on); resolve(m); } };
      ws.on("message", on);
      ws.send(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: a } }));
    });
  const until = async (cond: () => boolean) => { const end = Date.now() + 2000; while (!cond()) { if (Date.now() > end) throw new Error("Bedingung nicht erreicht"); await new Promise((r) => setTimeout(r, 10)); } };
  const wire = { old_file_path: "/r/a.txt", new_file_path: "/r/a.txt", new_file_contents: "neu\n", tab_name: "✻ [Claude Code] a.txt (14dda6) ⧉" };

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ide-diffctl-")); sock = null; });
  afterEach(async () => { sock?.terminate(); await server?.stop(); rmSync(dir, { recursive: true, force: true }); });

  it("Annehmen: closeAllDiffTabs (0), openDiff blockiert, dann FILE_SAVED plus Inhalt, close_tab", async () => {
    const ws = await start(d);
    expect((await call(ws, 1, "closeAllDiffTabs", {})).result.content[0].text).toBe("CLOSED_0_DIFF_TABS");
    const open = call(ws, 2, "openDiff", wire);
    await until(() => shown.length === 1);
    expect(await settled(open)).toBe("offen");
    expect(shown[0].req.clientId).toBe(server.clients()[0].id);
    d.decide(shown[0].id, "accepted");
    expect((await open).result).toEqual({ content: [{ type: "text", text: "FILE_SAVED" }, { type: "text", text: "neu\n" }] });
    expect((await call(ws, 3, "close_tab", { tab_name: wire.tab_name })).result.content[0].text).toBe("TAB_CLOSED");
  });
  it("Ablehnen: DIFF_REJECTED", async () => {
    const ws = await start(d);
    const open = call(ws, 2, "openDiff", wire);
    await until(() => shown.length === 1);
    d.decide(shown[0].id, "rejected");
    expect((await open).result).toEqual({ content: [{ type: "text", text: "DIFF_REJECTED" }] });
  });
  it("Verbindung zu, während der Diff wartet: Tab geschlossen, nichts bleibt offen", async () => {
    const ws = await start(d);
    void call(ws, 2, "openDiff", wire);
    await until(() => shown.length === 1);
    ws.close();
    await until(() => hidden.length === 1);
    expect(d.pending).toBe(0);
  });
  it("Server stoppt (Brücke aus, Entladen), während der Diff wartet: Tab geschlossen", async () => {
    const ws = await start(d);
    void call(ws, 2, "openDiff", wire);
    await until(() => shown.length === 1);
    await server.stop();
    expect(hidden).toEqual([shown[0].id]);
    expect(d.pending).toBe(0);
  });
  it("ideDiff aus: openDiff ergibt einen Protokollfehler, kein Tab", async () => {
    const ws = await start(d, false);
    const r = await call(ws, 2, "openDiff", wire);
    expect(r.error.code).toBe(-32602);
    expect(shown).toHaveLength(0);
  });
});
