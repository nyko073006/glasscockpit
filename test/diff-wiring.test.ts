import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listFilesRecursive, relativeToRoot, ROOT } from "./helpers/files";

// Wächter der Diff-Ansicht (Abend 17): Das Cockpit schreibt nie eine Datei (Claude schreibt beim Annehmen selbst, gemessen),
// Annehmen nur über den Knopf, ideDiff aus heißt keine Diff-Tools, Aufräumen bei Entladen, Ende der Verbindung, Einstellung aus.
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const srcFiles = () => listFilesRecursive(join(ROOT, "src")).filter((f) => /\.ts$/.test(f));
const noComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const DIFF_FILES = [
  "src/core/line-diff.ts", "src/core/diff-view-model.ts", "src/core/diff-sessions.ts", "src/core/ide-diff.ts",
  "src/host/ide-diff.ts", "src/host/ide-diff-fs.ts", "src/host/diff-view.ts", "src/host/diff-tabs.ts",
];
const SCHREIBEN = /\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|copyFile|copyFileSync|rename|renameSync|unlink|unlinkSync|rm|rmSync|mkdir|mkdirSync|truncate|ftruncate|writeSync|openSync)\b|vault\.(modify|create|process|delete|trash|rename)|adapter\.(write|append|remove|rename|mkdir)/;

describe("Das Cockpit schreibt für Diffs nie eine Datei", () => {
  it("das Muster trifft Schreibaufrufe", () => {
    for (const z of ['await writeFile(p, x);', 'import { renameSync } from "node:fs";', "this.app.vault.modify(f, t)", "adapter.write(p, t)", "fs.rmSync(p)"]) expect(z).toMatch(SCHREIBEN);
    expect("readFile(p)").not.toMatch(SCHREIBEN);
  });
  it("keine der Diff-Dateien enthält einen Schreibzugriff", () => {
    for (const f of DIFF_FILES) {
      const code = noComments(read(f));
      expect({ datei: f, treffer: code.match(SCHREIBEN)?.[0] ?? null }).toEqual({ datei: f, treffer: null });
    }
  });
  it("node:fs wird in den Diff-Dateien nur von ide-diff-fs.ts importiert, und nur zum Lesen", () => {
    const mit = DIFF_FILES.filter((f) => /from\s+["']node:fs/.test(read(f)));
    expect(mit).toEqual(["src/host/ide-diff-fs.ts"]);
    expect(read("src/host/ide-diff-fs.ts")).toMatch(/import \{ readFile, stat \} from "node:fs\/promises";/);
  });
  it("die Antwort auf openDiff trägt beim Annehmen den Inhalt (daraus schreibt Claude), sonst nichts", () => {
    const src = read("src/core/ide-diff.ts");
    expect(src).toMatch(/\{ type: "text", text: "FILE_SAVED" \}, \{ type: "text", text: finalContents \}/);
  });
});

describe("Annehmen nur über den Knopf", () => {
  it("das Wort accepted steht nur in ide-diff.ts (Typ und Antwort), diff-sessions.ts (Typ) und genau einmal als Aufruf in diff-view.ts", () => {
    const treffer = srcFiles().filter((f) => /["']accepted["']/.test(readFileSync(f, "utf8"))).map(relativeToRoot);
    expect(treffer).toEqual(["src/core/ide-diff.ts", "src/host/diff-view.ts"]);
    const view = read("src/host/diff-view.ts");
    expect(view.match(/"accepted"/g)).toHaveLength(1);
    expect(view).toMatch(/text: "Annehmen"[^\n]*addEventListener\("click", \(\) => this\.deps\.decide\(id, "accepted"\)\)/);
  });
  it("jede andere Beendigung endet als Ablehnen: Sitzungen lösen nur mit rejected auf, außer decide", () => {
    const code = noComments(read("src/core/diff-sessions.ts"));
    expect(code).not.toMatch(/"accepted"/);
    expect(code.match(/settle\([^)]*"rejected"/g)?.length).toBeGreaterThanOrEqual(6);
  });
});

describe("ideDiff aus: keine Diff-Tools", () => {
  it("der Server liest die Einstellung bei jeder Anfrage frisch über die Brücke", () => {
    expect(read("src/host/ide-bridge.ts")).toMatch(/diffEnabled: \(\) => deps\.settings\(\)\.ideDiff/);
    expect(read("src/host/ide-server.ts")).toMatch(/diffEnabled: this\.deps\.diffEnabled/);
  });
  it("die Grundliste enthält keines der drei Tools, DIFF_TOOLS kommt nur über diffOffered dazu", () => {
    const proto = read("src/core/ide-protocol.ts");
    expect(proto).toMatch(/tools: diffOffered\(ctx\) \? \[\.\.\.IDE_TOOLS, \.\.\.DIFF_TOOLS\] : IDE_TOOLS/);
    expect(proto).toMatch(/const diffOffered = \(ctx: DispatchContext\): boolean => ctx\.handlers\.diff !== undefined && ctx\.diffEnabled\?\.\(\) === true;/);
    expect(proto).toMatch(/if \(!diff \|\| !diffOffered\(ctx\)\) return rpcError/);
  });
  it("die Vorgabe ist aus, der Schalter steht im Abschnitt Terminal", () => {
    expect(read("src/core/constants.ts")).toMatch(/DEFAULT_IDE_DIFF = false;/);
    const tab = read("src/host/settings-tab.ts");
    const terminal = tab.indexOf('this.group("Terminal", [');
    const field = tab.search(/this\.toggleField\(\s*"ideDiff", "Diffs in Obsidian zeigen"/);
    expect(field).toBeGreaterThan(terminal);
    expect(field).toBeLessThan(tab.indexOf('this.group("Benachrichtigung", ['));
  });
  it("die Beschreibung sagt, dass der Diff nur ohne Bypass kommt (Abnahme 06.10.2026)", () => {
    const tab = read("src/host/settings-tab.ts");
    const field = tab.slice(tab.search(/this\.toggleField\(\s*"ideDiff"/), tab.indexOf('this.numberField("fontSize"'));
    expect(field).toMatch(/Wirkt nur ohne Bypass/);
    expect(field).toMatch(/Shift\+Tab/);
  });
  it("ohne Brücke ist der Schalter gesperrt, und Umschalten der Brücke zeichnet die Seite neu (06.10.2026)", () => {
    const tab = read("src/host/settings-tab.ts");
    const field = tab.slice(tab.search(/this\.toggleField\(\s*"ideDiff"/), tab.indexOf('this.numberField("fontSize"'));
    expect(field).toMatch(/\(\) => !this\.store\.settings\(\)\.ideBridge/);
    const bridge = tab.slice(tab.search(/this\.toggleField\(\s*"ideBridge"/), tab.search(/this\.toggleField\(\s*"ideDiff"/));
    expect(bridge).toMatch(/this\.update\(\)/);
  });
});

describe("Nichts hängt: Aufräumen", () => {
  const bridge = read("src/host/ide-bridge.ts");
  it("Entladen: stop lehnt offene Diffs ab, bevor der Server schließt", () => {
    const stop = bridge.slice(bridge.indexOf("  stop(): Promise<void> {"));
    expect(stop.indexOf("this.diff.dispose()")).toBeGreaterThan(-1);
    expect(stop.indexOf("this.diff.dispose()")).toBeLessThan(stop.indexOf("this.lifecycle.stop()"));
  });
  it("Einstellung aus: sync schließt alle offenen Diffs", () => {
    expect(bridge).toMatch(/if \(!this\.deps\.settings\(\)\.ideDiff\) this\.diff\.closeAll\(\);/);
  });
  it("Verbindung zu: der Server meldet sie, die Brücke räumt ihre Diffs weg", () => {
    expect(bridge).toMatch(/onClientClose: \(clientId\) => this\.diff\.closeClient\(clientId\)/);
    const server = read("src/host/ide-server.ts");
    expect(server.match(/this\.clientClosed\(/g)?.length).toBe(2);
  });
  it("Tab schließen: onClose der Ansicht meldet die id (ohne Entscheidung heißt das Ablehnen)", () => {
    expect(read("src/host/diff-view.ts")).toMatch(/async onClose\(\): Promise<void> \{[^}]*this\.deps\.closed\(this\.id\)/);
    expect(bridge).toMatch(/closed: \(id\) => \{\s*this\.tabs\.forget\(id\);\s*this\.diff\.viewClosed\(id\);/);
  });
  it("Tab, der nicht aufgeht: der Diff gilt als abgelehnt", () => {
    expect(read("src/host/diff-tabs.ts")).toMatch(/this\.failed\(id\)/);
    expect(bridge).toMatch(/new DiffTabs\(app, \(id\) => this\.diff\.viewClosed\(id\)\)/);
  });
  it("onunload ruft die Brücke zuerst (sie lehnt die Diffs ab)", () => {
    const main = read("src/main.ts");
    const on = main.slice(main.indexOf("onunload(): void {"));
    expect(on.indexOf("this.ide?.stop()")).toBeLessThan(on.indexOf("this.tracker?.dispose()"));
  });
});

describe("Ansicht und Aufmerksamkeit", () => {
  const bridge = read("src/host/ide-bridge.ts");
  it("View-Typ glasscockpit-diff, registriert über die Brücke", () => {
    expect(read("src/core/constants.ts")).toMatch(/VIEW_TYPE_DIFF = `\$\{PLUGIN_ID\}-diff`;/);
    expect(bridge).toMatch(/this\.plugin\.registerView\(\s*VIEW_TYPE_DIFF/);
  });
  it("neue Tabs im Hintergrund: active false, nie revealLeaf oder setActiveLeaf", () => {
    const tabs = read("src/host/diff-tabs.ts");
    expect(tabs).toMatch(/active: false/);
    expect(noComments(tabs)).not.toMatch(/revealLeaf|setActiveLeaf|active: true/);
    expect(tabs).toMatch(/this\.existing\(req\) \?\? this\.app\.workspace\.getLeaf\("tab"\)/);
  });
  it("ein neuer Diff markiert die Sitzung als Frage (Zuordnung über die pid, wie bei at_mentioned)", () => {
    expect(bridge).toMatch(/sessionForClient\(client, this\.deps\.sessions\(\), parentPid\)/);
    expect(read("src/host/ide-diff.ts")).toMatch(/deps\.attention\(req\.clientId\)/);
    expect(read("src/main.ts")).toMatch(/attention: \(id\) => this\.viewsOf\(id\)\[0\]\?\.signalAttention\("question"\)/);
    expect(read("src/host/terminal-view.ts")).toMatch(/signalAttention\(signal: AttentionSignal\): void \{\s*this\.onAttention\(signal\);/);
  });
  it("close_tab und closeAllDiffTabs wirken nur auf die eigene Verbindung", () => {
    const ctl = read("src/host/ide-diff.ts");
    expect(ctl).toMatch(/this\.sessions\.closeTab\(tabName, clientId\)/);
    expect(ctl).toMatch(/clientId === null \? this\.closeAll\(\) : this\.closeClient\(clientId\)/);
  });
  it("die Kerndateien der Diff-Ansicht importieren nichts außer eigenen Modulen", () => {
    for (const f of ["src/core/line-diff.ts", "src/core/diff-view-model.ts", "src/core/diff-sessions.ts", "src/core/ide-diff.ts"]) {
      const imports = [...read(f).matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]);
      expect(imports.filter((i) => !i.startsWith("./"))).toEqual([]);
    }
  });
  it("alle Klassen der Ansicht entstehen über das Präfix cockpit-, und die gestalteten haben eine Regel im Stylesheet", () => {
    const view = read("src/host/diff-view.ts");
    expect(view).toMatch(/const c = \(name: string\): string => `\$\{CSS_PREFIX\}\$\{name\}`;/);
    const css = read("src/styles.css");
    for (const name of ["diff", "diff-head", "diff-path", "diff-summary", "diff-buttons", "diff-notes", "diff-body", "diff-hunk", "diff-row", "diff-no", "diff-sign", "diff-noeol", "diff-empty", "diff-gone"]) {
      expect(view).toContain(`c("${name}")`);
      expect(css).toContain(`.cockpit-${name}`);
    }
    expect(view).toContain("c(`diff-${line.op}`)");
    expect(css).toContain(".cockpit-diff-add");
    expect(css).toContain(".cockpit-diff-del");
    // Keine Klasse ohne Präfix: jede cls-Angabe läuft über c(...), außer Obsidians mod-cta.
    const cls = [...view.matchAll(/cls: ([^,}]+)/g)].map((m) => m[1]);
    for (const wert of cls) expect(wert).toMatch(/c\(|mod-cta/);
  });
});
