import { posix, win32 } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  type BufferLineLike, bufferRowOf, candidatesWithQuotes, cdTargets, type CellRow, exceedsLimit, extendCandidates, formatBytes, IMAGE_MIME, imageInfo, imageMime, isRelativePath, lineSeparatorOf, linkBases,
  linkModifierDown, logicalLine, looksBinary, MAX_PATH_PROBES, MAX_PATH_WORDS, mergeRecent, opensOnClick, pathCandidates, plainLeftClick, ProbeBudget,
  quotedCandidates, resolveCandidatePath, resolveViaBases, saveDecision, toolPaths, urlRanges, vaultRelative, WORD_SEAM_ROWS, wordLine,
} from "../src/core/file-links";
import { modKeyName } from "../src/core/keymap";

/** Nur Pfad, Zeile und Spalte; dazu prüft jeder Fall, dass text genau der Ausschnitt start..end ist. */
const found = (line: string) =>
  pathCandidates(line).map((c) => {
    expect(line.slice(c.start, c.end)).toBe(c.text);
    return [c.text, c.path, c.line, c.col];
  });

describe("pathCandidates: Pfade in echten Claude-Ausgabezeilen", () => {
  it("Werkzeugaufruf mit Klammern", () => {
    expect(found("● Read(src/core/session-model.ts)")).toEqual([["src/core/session-model.ts", "src/core/session-model.ts", null, null]]);
  });
  it("Backticks mit Zeile", () => {
    expect(found("Die Logik steht in `src/host/ide-editor.ts:124`, dort ändern.")).toEqual([
      ["src/host/ide-editor.ts:124", "src/host/ide-editor.ts", 124, null],
    ]);
  });
  it("Zeile und Spalte, Punkt am Satzende ab", () => {
    expect(found("Fehler in src/main.ts:10:5.")).toEqual([["src/main.ts:10:5", "src/main.ts", 10, 5]]);
  });
  it("Doppelpunkt am Satzende ab, mit und ohne Zeilennummer", () => {
    expect(found("Geändert: docs/spec.md:42:")).toEqual([["docs/spec.md:42", "docs/spec.md", 42, null]]);
    expect(found("Neu angelegt docs/spec.md:")).toEqual([["docs/spec.md", "docs/spec.md", null, null]]);
  });
  it("Home-Pfad in runden Klammern", () => {
    expect(found("(siehe ~/Documents/notes/plan.md)")).toEqual([["~/Documents/notes/plan.md", "~/Documents/notes/plan.md", null, null]]);
  });
  it("absoluter Pfad mit Komma dahinter", () => {
    expect(found("Pfad: /Users/n/x/package.json, fertig.")).toEqual([["/Users/n/x/package.json", "/Users/n/x/package.json", null, null]]);
  });
  it("Dateiname ohne Ordner zählt (relativ zum Startordner)", () => {
    expect(found("Prüfe package.json zuerst")).toEqual([["package.json", "package.json", null, null]]);
  });
  it("Markdown-Link und @-Erwähnung", () => {
    expect(found("[Bauanleitung](docs/bau.md) und @src/main.ts")).toEqual([
      ["docs/bau.md", "docs/bau.md", null, null],
      ["src/main.ts", "src/main.ts", null, null],
    ]);
  });
  it("Anführungszeichen beider Sorten", () => {
    expect(found(`Update("README.md") und 'a/b.ts'`)).toEqual([
      ["README.md", "README.md", null, null],
      ["a/b.ts", "a/b.ts", null, null],
    ]);
  });
  it("Mehrere Pfade in einer Zeile in Reihenfolge", () => {
    expect(found("  ⎿  ./a.ts und ../b/c.md:3")).toEqual([
      ["./a.ts", "./a.ts", null, null],
      ["../b/c.md:3", "../b/c.md", 3, null],
    ]);
  });
  it("keine Kandidaten: URL, Zahl, Wörter ohne Punkt und Schrägstrich, nur Satzzeichen", () => {
    expect(found("https://example.com/a.ts Version 0.2.3 Read 208 lines ... / ~")).toEqual([]);
  });
  it("Zeile 0 ist keine Zeilennummer", () => {
    expect(found("a.ts:0")).toEqual([["a.ts", "a.ts", null, null]]);
  });
});

describe("resolveCandidatePath", () => {
  const ctx = { home: "/Users/n", cwd: "/Users/n/repo" };
  it("absolut bleibt, normalisiert", () => {
    expect(resolveCandidatePath("/a/./b/../c.ts", ctx)).toBe("/a/c.ts");
  });
  it("Home", () => {
    expect(resolveCandidatePath("~/x/y.md", ctx)).toBe("/Users/n/x/y.md");
  });
  it("~ allein und ~benutzer sind kein Dateipfad", () => {
    expect(resolveCandidatePath("~", ctx)).toBeNull();
    expect(resolveCandidatePath("~fremd/x.md", ctx)).toBeNull();
  });
  it("relativ gegen den Startordner", () => {
    expect(resolveCandidatePath("src/main.ts", ctx)).toBe("/Users/n/repo/src/main.ts");
    expect(resolveCandidatePath("../b/c.md", ctx)).toBe("/Users/n/b/c.md");
  });
  it("relativ ohne Startordner geht nicht", () => {
    expect(resolveCandidatePath("src/main.ts", { home: "/Users/n", cwd: null })).toBeNull();
  });
  it("Startordner mit ~ wird ausgeschrieben", () => {
    expect(resolveCandidatePath("a.md", { home: "/Users/n", cwd: "~/repo" })).toBe("/Users/n/repo/a.md");
  });
});

describe("vaultRelative", () => {
  it("im Vault: relativer Pfad", () => {
    expect(vaultRelative("/V/Notes/a b.md", "/V")).toBe("Notes/a b.md");
    expect(vaultRelative("/V/Index.md", "/V/")).toBe("Index.md");
  });
  it("außerhalb, Nachbarordner mit gleichem Anfang, Vault selbst, kein Vault", () => {
    expect(vaultRelative("/W/a.md", "/V")).toBeNull();
    expect(vaultRelative("/V2/a.md", "/V")).toBeNull();
    expect(vaultRelative("/V", "/V")).toBeNull();
    expect(vaultRelative("/V/a.md", null)).toBeNull();
  });
});

describe("logicalLine: umgebrochene Zeilen", () => {
  const row = (text: string, isWrapped: boolean): CellRow => ({ cells: Array.from(text, (chars) => ({ chars, width: 1 })), isWrapped });
  const rows: Record<number, CellRow> = { 1: row("vorher", false), 2: row("lang/pf", false), 3: row("ad.ts:4", true), 4: row("2 x", true), 5: row("nachher", false) };
  const get = (y: number): CellRow | null => rows[y] ?? null;

  it("fügt die Zeile aus allen Teilen zusammen, egal welche Teilzeile gefragt ist", () => {
    for (const y of [2, 3, 4]) expect(logicalLine(y, get)?.text).toBe("lang/pfad.ts:42 x");
  });
  it("jede Textposition kennt ihre Zelle (x und y ab 1)", () => {
    const l = logicalLine(3, get);
    expect(l?.positions[0]).toEqual({ x: 1, y: 2 });
    expect(l?.positions[7]).toEqual({ x: 1, y: 3 });
    expect(l?.positions[14]).toEqual({ x: 1, y: 4 });
  });
  it("breite Zeichen: Folgezelle mit Breite 0 entfällt, leere Zelle wird Leerzeichen", () => {
    const wide: CellRow = { cells: [{ chars: "界", width: 2 }, { chars: "", width: 0 }, { chars: "", width: 1 }, { chars: "a", width: 1 }], isWrapped: false };
    const l = logicalLine(1, () => wide);
    expect(l?.text).toBe("界 a");
    expect(l?.positions).toEqual([{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }]);
  });
  it("fehlende Zeile", () => {
    expect(logicalLine(9, get)).toBeNull();
  });
});

describe("Prüfungen", () => {
  it("binär: NUL-Byte in den ersten 8 KB", () => {
    expect(looksBinary(new TextEncoder().encode("hallo\nwelt"))).toBe(false);
    expect(looksBinary(Uint8Array.from([0x50, 0x4b, 0x00, 0x03]))).toBe(true);
    const late = new Uint8Array(9000).fill(0x61);
    late[8500] = 0;
    expect(looksBinary(late)).toBe(false);
  });
  it("Größe gegen Höchstgröße in MB", () => {
    expect(exceedsLimit(2 * 1024 * 1024, 2)).toBe(false);
    expect(exceedsLimit(2 * 1024 * 1024 + 1, 2)).toBe(true);
  });
  it("Speichern: fremde Änderung oder gelöschte Datei fragt nach", () => {
    expect(saveDecision(1000, 1000)).toBe("write");
    expect(saveDecision(1000, 2000)).toBe("ask");
    expect(saveDecision(1000, null)).toBe("ask");
  });
  it("öffnen nur mit Cmd und linker Taste ohne Ctrl und Alt", () => {
    const e = (extra: Partial<{ button: number; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
      ({ button: 0, metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, ...extra });
    expect(opensOnClick(e())).toBe(true);
    expect(opensOnClick(e({ metaKey: false }))).toBe(false);
    // xterm ruft activate bei jedem mouseup auf demselben Link (Linkifier._handleMouseUp), welche Taste auch gedrückt war.
    expect(opensOnClick(e({ button: 1 }))).toBe(false);
    expect(opensOnClick(e({ button: 2 }))).toBe(false);
    // Ctrl+Klick ist auf dem Mac das Kontextmenü; mit Alt schickt xterm (altClickMovesCursor) Cursor-Sequenzen in die PTY.
    expect(opensOnClick(e({ ctrlKey: true }))).toBe(false);
    expect(opensOnClick(e({ altKey: true }))).toBe(false);
  });
  it("Zeilenende der Datei bleibt erhalten", () => {
    expect(lineSeparatorOf("a\r\nb")).toBe("\r\n");
    expect(lineSeparatorOf("a\nb")).toBe("\n");
    expect(lineSeparatorOf("eine Zeile")).toBe("\n");
  });
});

describe("Einstellungen fileLinks und fileViewerMaxMb", async () => {
  const { DEFAULT_SETTINGS, parseSettings } = await import("../src/core/settings");
  it("Vorgaben: an, 2 MB", () => {
    expect(DEFAULT_SETTINGS.fileLinks).toBe(true);
    expect(DEFAULT_SETTINGS.fileViewerMaxMb).toBe(2);
  });
  it("Höchstgröße wird auf 1 bis 50 geklemmt, Unsinn verworfen", () => {
    expect(parseSettings({ fileViewerMaxMb: 999 }).settings.fileViewerMaxMb).toBe(50);
    expect(parseSettings({ fileViewerMaxMb: 0 }).settings.fileViewerMaxMb).toBe(1);
    const r = parseSettings({ fileViewerMaxMb: "3", fileLinks: "ja" });
    expect([...r.invalid].sort()).toEqual(["fileLinks", "fileViewerMaxMb"]);
    expect(parseSettings({ fileLinks: false }).settings.fileLinks).toBe(false);
  });
  it("fileLinksClaudeDirs (Abend 27b): Vorgabe an, nur Wahrheitswerte", () => {
    expect(DEFAULT_SETTINGS.fileLinksClaudeDirs).toBe(true);
    expect(parseSettings({ fileLinksClaudeDirs: false }).settings.fileLinksClaudeDirs).toBe(false);
    const r = parseSettings({ fileLinksClaudeDirs: "ja" });
    expect([...r.invalid]).toEqual(["fileLinksClaudeDirs"]);
    expect(r.settings.fileLinksClaudeDirs).toBe(true);
  });
  it("fileLinksSpaces (Abend 38): Vorgabe an, nur Wahrheitswerte", () => {
    expect(DEFAULT_SETTINGS.fileLinksSpaces).toBe(true);
    expect(parseSettings({ fileLinksSpaces: false }).settings.fileLinksSpaces).toBe(false);
    const r = parseSettings({ fileLinksSpaces: "ja" });
    expect([...r.invalid]).toEqual(["fileLinksSpaces"]);
    expect(r.settings.fileLinksSpaces).toBe(true);
  });
});

describe("logicalLine mit hard: Claude bricht selbst um (echter Zeilenumbruch plus Einrückung)", () => {
  /** Zeile in voller Terminalbreite wie in xterm: leere Zellen bis zum Rand. */
  const rowW = (text: string, width: number, isWrapped = false): CellRow => ({
    cells: Array.from(text.padEnd(width, "\0"), (ch) => (ch === "\0" ? { chars: "", width: 1 } : { chars: ch, width: 1 })),
    isWrapped,
  });
  // Nach dem echten Puffer vom 11.10.2026 (Zeile 24/25): „…Projekte-Sec“ voll bis Spalte 75, dann „     ondBrain/…“.
  const rows = [rowW("  siehe /abs/lang/pf", 20), rowW("     ad.ts:4 und", 20), rowW("ende.", 20), rowW("  weiter", 20)];
  const get = (y: number): CellRow | null => rows[y - 1] ?? null;

  it("volle Zeile wird mit der nächsten verbunden, deren Einrückung entfällt, egal welche Teilzeile gefragt ist", () => {
    for (const y of [1, 2]) expect(logicalLine(y, get, true)?.text.trimEnd()).toBe("  siehe /abs/lang/pfad.ts:4 und");
  });
  it("Positionen nach der Naht zeigen in die zweite Zeile hinter die Einrückung", () => {
    const l = logicalLine(1, get, true);
    const at = l?.text.indexOf("ad.ts") ?? -1;
    expect(l?.positions[at]).toEqual({ x: 6, y: 2 });
    expect(l?.positions[at - 1]).toEqual({ x: 20, y: 1 });
  });
  it("nicht volle Zeile bleibt allein", () => {
    expect(logicalLine(3, get, true)?.text.trimEnd()).toBe("ende.");
    expect(logicalLine(4, get, true)?.text.trimEnd()).toBe("  weiter");
  });
  it("ohne hard bleibt es beim alten Verhalten", () => {
    expect(logicalLine(1, get)?.text.trimEnd()).toBe("  siehe /abs/lang/pf");
  });
});

describe("bufferRowOf: nur die sichtbaren Spalten", () => {
  /** xterm-Pufferzeile mit length Zellen; was über text hinausgeht, ist leer. */
  const line = (text: string, length: number, isWrapped = false): BufferLineLike => ({
    length,
    isWrapped,
    getCell: (x) => (x < length ? { getChars: () => text[x] ?? "", getWidth: () => 1 } : undefined),
  });

  it("eine Zeile, die länger als das Terminal breit ist, wird auf die Spaltenzahl gekürzt", () => {
    expect(bufferRowOf(line("abc", 75), 57).cells).toHaveLength(57);
  });
  it("Zeichen jenseits der Spaltenzahl (vor dem Verkleinern geschrieben, unsichtbar) gehören nicht dazu", () => {
    const row = bufferRowOf(line(`${" ".repeat(60)}alt/datei.ts`, 75), 57);
    expect(row.cells.map((c) => c.chars).join("").trim()).toBe("");
  });
  it("kürzere Zeile bleibt, wie sie ist; isWrapped wird übernommen", () => {
    const row = bufferRowOf(line("ab", 2, true), 57);
    expect(row.cells.map((c) => c.chars)).toEqual(["a", "b"]);
    expect(row.isWrapped).toBe(true);
  });
  // Echter Puffer vom 11.10.2026, Abnahme e: Terminal 57 Spalten, xterm meldet jede Zeile mit 75 Zellen (alternativer
  // Puffer nach dem Verkleinern). Claude bricht bei Spalte 57 um.
  it("Claudes Umbruch bei voller Terminalbreite wird verbunden, auch wenn xterm längere Zeilen meldet", () => {
    const rows = [line("  - /home/anna/dokumente/sammlung-projekte/beispiel-repo/", 75), line("    package.json", 75)].map((l) => bufferRowOf(l, 57));
    const get = (y: number): CellRow | null => rows[y - 1] ?? null;
    for (const y of [1, 2]) expect(logicalLine(y, get, true)?.text.trimEnd()).toBe("  - /home/anna/dokumente/sammlung-projekte/beispiel-repo/package.json");
  });
});

// Nachtrag 27b: relative Pfade über Claudes Ordner. Die Transkriptzeilen haben die echte Struktur, die Werte sind neutral.
const HOME = "/Users/u";
const jsonl = (...entries: unknown[]) => entries.map((e) => (typeof e === "string" ? e : JSON.stringify(e))).join("\n") + "\n";
const assistant = (cwd: string | undefined, ...content: unknown[]) => ({ type: "assistant", cwd, message: { role: "assistant", content } });
const use = (name: string, input: Record<string, unknown>) => ({ type: "tool_use", id: "toolu_1", name, input });
const bash = (command: string) => use("Bash", { command, description: "Befehl" });
/** Pfade aus Einträgen, ohne Dubletten (cd-Ziel und Befehlskandidat nennen oft denselben Ordner). */
const pathsOf = (...entries: unknown[]) => [...new Set(toolPaths(jsonl(...entries), HOME))];
const has = (...files: string[]) => (p: string) => files.includes(p);

describe("isRelativePath", () => {
  it("relativ ist, was weder mit / noch mit ~ beginnt", () => {
    expect(["src/main.ts", "./a.md", "../a.md", "package.json"].map((p) => isRelativePath(p))).toEqual([true, true, true, true]);
    expect(["/abs/a.md", "~/a.md", "~", "~user/a.md", ""].map((p) => isRelativePath(p))).toEqual([false, false, false, false, false]);
  });
});

describe("cdTargets: cd-Ziele eines Shell-Befehls", () => {
  it("am Anfang und hinter && || ; | ( und Zeilenumbruch", () => {
    expect(cdTargets("cd ~/proj/app && git status")).toEqual(["~/proj/app"]);
    expect(cdTargets("git status || cd /srv/app")).toEqual(["/srv/app"]);
    expect(cdTargets("ls; cd ../lib")).toEqual(["../lib"]);
    expect(cdTargets("echo x | cd /a/b")).toEqual(["/a/b"]);
    expect(cdTargets("(cd /a/b; make)")).toEqual(["/a/b"]);
    expect(cdTargets("set -e\ncd /a/b\nmake")).toEqual(["/a/b"]);
  });
  it("mehrere Ziele in Reihenfolge, auch bei dicht gesetzten Operatoren", () => {
    expect(cdTargets("cd /a/b&&make&&cd /c/d;ls")).toEqual(["/a/b", "/c/d"]);
  });
  it("Anführungszeichen fallen ab, Leerzeichen im Pfad bleiben", () => {
    expect(cdTargets('cd "/Users/u/My Proj/app" && ls')).toEqual(["/Users/u/My Proj/app"]);
    expect(cdTargets("cd '~/My Proj' && ls")).toEqual(["~/My Proj"]);
  });
  it("-- vor dem Ziel entfällt", () => {
    expect(cdTargets("cd -- ~/proj")).toEqual(["~/proj"]);
  });
  it("Gegentest: cd mitten im Wort, in einem String oder als Teil eines Befehlsnamens zählt nicht", () => {
    expect(cdTargets('echo "cd /x"')).toEqual([]);
    expect(cdTargets("abcd /x")).toEqual([]);
    expect(cdTargets("cdk deploy")).toEqual([]);
    expect(cdTargets("git commit -m 'fix cd /x'")).toEqual([]);
    expect(cdTargets("cd")).toEqual([]);
  });
  it("das Ziel bleibt roh: Variablen verwirft erst toolPaths", () => {
    expect(cdTargets("cd $HOME/x")).toEqual(["$HOME/x"]);
  });
});

describe("toolPaths: absolute Pfade aus Claudes Werkzeugaufrufen", () => {
  it("file_path und notebook_path: der Ordner der Datei (absolut oder ~/)", () => {
    expect(pathsOf(
      assistant("/Users/u/vault", use("Read", { file_path: "/Users/u/proj/app/src/core/x.ts" })),
      assistant("/Users/u/vault", use("Edit", { file_path: "/Users/u/proj/app/src/y.ts", old_string: "a", new_string: "b" })),
      assistant("/Users/u/vault", use("Write", { file_path: "~/proj/app/docs/z.md", content: "c" })),
      assistant("/Users/u/vault", use("NotebookEdit", { notebook_path: "/Users/u/nb/book.ipynb" })),
    )).toEqual(["/Users/u/proj/app/src/core", "/Users/u/proj/app/src", "/Users/u/proj/app/docs", "/Users/u/nb"]);
  });
  it("path (Grep, Glob): der Pfad selbst", () => {
    expect(pathsOf(
      assistant("/Users/u/vault", use("Grep", { pattern: "foo", path: "/Users/u/proj/app" })),
      assistant("/Users/u/vault", use("Glob", { pattern: "**/*.ts", path: "~/proj/lib" })),
    )).toEqual(["/Users/u/proj/app", "/Users/u/proj/lib"]);
  });
  it("relative file_path und path ergeben keinen Basisordner", () => {
    expect(pathsOf(
      assistant("/Users/u/proj/app", use("Read", { file_path: "src/x.ts" }), use("Grep", { pattern: "foo", path: "src" })),
    )).toEqual([]);
  });
  it("cd-Ziele: ~ gegen home, absolut bleibt, Schrägstrich am Ende ab", () => {
    expect(pathsOf(
      assistant("/Users/u/vault", bash("cd ~/proj/app && git status")),
      assistant("/Users/u/vault", bash("cd /srv/app/ && ls")),
      assistant("/Users/u/vault", bash("cd ~")),
    )).toEqual(["/Users/u/proj/app", "/srv/app", "/Users/u"]);
  });
  it("cd-Ziel in Anführungszeichen: das ganze Ziel samt Leerzeichen ist dabei", () => {
    // Dazu liefert der Befehlskandidat noch das Bruchstück vor dem Leerzeichen; das ist ein Ordner, den es nicht gibt.
    expect(pathsOf(assistant("/Users/u/vault", bash('cd "/Users/u/My Proj/app" && ls')))).toContain("/Users/u/My Proj/app");
  });
  it("cd-Ziele: relativ gegen das cwd des Eintrags, ohne absolutes cwd verworfen", () => {
    expect(pathsOf(
      assistant("/Users/u/proj/app", bash("cd src/core && ls")),
      assistant("/Users/u/proj/app", bash("cd ../lib")),
      assistant("proj/app", bash("cd src")),
      assistant(undefined, bash("cd src")),
    )).toEqual(["/Users/u/proj/app/src/core", "/Users/u/proj/lib"]);
  });
  it("cd-Ziele mit Variable, Befehlsersetzung oder Backticks und cd - entfallen", () => {
    expect(pathsOf(
      assistant("/Users/u/vault", bash("cd $HOME/proj && ls")),
      assistant("/Users/u/vault", bash('cd "$HOME/My Proj" && ls')),
      assistant("/Users/u/vault", bash("cd $(git rev-parse --show-toplevel) && ls")),
      assistant("/Users/u/vault", bash("cd `git rev-parse --show-toplevel` && ls")),
      assistant("/Users/u/vault", bash("cd - && ls")),
    )).toEqual([]);
  });
  it("absolute und ~/-Pfade im Befehl sind Kandidaten, relative nicht", () => {
    expect(pathsOf(
      assistant("/Users/u/vault", bash("cat /Users/u/proj/app/src/x.ts | head")),
      assistant("/Users/u/vault", bash("git -C ~/proj/z log src/rel.ts")),
    )).toEqual(["/Users/u/proj/app/src/x.ts", "/Users/u/proj/z"]);
  });
  it("Zeilennummer am Befehlskandidaten gehört nicht zum Pfad", () => {
    expect(pathsOf(assistant("/Users/u/vault", bash("sed -n 1,5p /Users/u/proj/app/a.ts:7")))).toEqual(["/Users/u/proj/app/a.ts"]);
  });
  it("Dateireihenfolge; abgeschnittene erste Zeile, Leerzeilen und kein JSON werden still übersprungen", () => {
    const cut = JSON.stringify(assistant("/Users/u/vault", use("Read", { file_path: "/Users/u/abgeschnitten/x.ts" }))).slice(25);
    const text = jsonl(cut, "", "kein json", assistant("/Users/u/vault", bash("cd /a/erst")), assistant("/Users/u/vault", bash("cd /b/zweit")));
    expect(toolPaths(text, HOME)).toEqual(["/a/erst", "/a/erst", "/b/zweit", "/b/zweit"]);
  });
  it("Gegentest: Fließtext, Ergebnisse und andere Eingabefelder liefern keinen Pfad", () => {
    expect(pathsOf(
      assistant("/Users/u/vault", { type: "text", text: "Ich las /Users/u/proj/fliess/src/a.ts und wechselte mit cd ~/proj/fliess." }),
      { type: "user", cwd: "/Users/u/vault", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "/Users/u/proj/ergebnis/src/b.ts:3: Treffer" }] } },
      assistant(
        "/Users/u/vault",
        use("Edit", { file_path: "/Users/u/proj/app/c.ts", old_string: "siehe /Users/u/proj/altstring/d.ts", new_string: "cd /Users/u/proj/neustring" }),
        use("Bash", { command: "echo hi", description: "Wechselt nach /Users/u/proj/beschreibung" }),
      ),
    )).toEqual(["/Users/u/proj/app"]);
  });
  it("Gegentest: nur Einträge der Antwort zählen, auch wenn ein anderer Eintrag wie ein Werkzeugaufruf aussieht", () => {
    expect(pathsOf({ type: "user", cwd: "/Users/u/vault", message: { role: "user", content: [use("Read", { file_path: "/Users/u/proj/fremd/x.ts" })] } })).toEqual([]);
  });
  it("Gegentest: Elemente, die kein tool_use sind, zählen nicht, auch mit input (im selben Eintrag wie ein echter Aufruf)", () => {
    expect(pathsOf(assistant(
      "/Users/u/vault",
      { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { path: "/Users/u/proj/server" } },
      use("Read", { file_path: "/Users/u/proj/app/c.ts" }),
    ))).toEqual(["/Users/u/proj/app"]);
  });
});

describe("linkBases: Basisordner aus Pfaden", () => {
  it("jeder Pfad und seine Elternordner, neueste zuerst, der Pfad vor seinen Eltern", () => {
    expect(linkBases(["/Users/u/old/proj/src", "/Users/u/proj/app/src"], HOME, 64)).toEqual([
      "/Users/u/proj/app/src", "/Users/u/proj/app", "/Users/u/proj", "/Users/u/old/proj/src", "/Users/u/old/proj", "/Users/u/old",
    ]);
  });
  it("ohne Dubletten: ein gemeinsamer Elternordner steht einmal, beim neuesten Pfad", () => {
    expect(linkBases(["/Users/u/proj/a", "/Users/u/proj/b", "/Users/u/proj/a"], HOME, 64)).toEqual(["/Users/u/proj/a", "/Users/u/proj", "/Users/u/proj/b"]);
  });
  it("Gegentest: nie home, nie ein Vorfahre von home, nie ein Ordner mit weniger als zwei Stufen", () => {
    expect(linkBases(["/Users/u/proj", HOME, "/Users", "/", "/tmp", "/tmp/x", "/opt/tools/bin"], HOME, 64)).toEqual([
      "/opt/tools/bin", "/opt/tools", "/tmp/x", "/Users/u/proj",
    ]);
  });
  it("Gegentest: auch ein Vorfahre von home mit zwei Stufen ist kein Basisordner", () => {
    expect(linkBases(["/data/people/u/proj"], "/data/people/u", 64)).toEqual(["/data/people/u/proj"]);
  });
  it("home mit Schrägstrich am Ende gilt genauso", () => {
    expect(linkBases(["/Users/u/proj"], "/Users/u/", 64)).toEqual(["/Users/u/proj"]);
  });
  it("höchstens max, die neuesten bleiben", () => {
    expect(linkBases(["/Users/u/proj/app/src/core"], HOME, 2)).toEqual(["/Users/u/proj/app/src/core", "/Users/u/proj/app/src"]);
    expect(linkBases(["/Users/u/proj/app/src/core"], HOME, 0)).toEqual([]);
  });
  it("relative Pfade sind keine Basisordner", () => {
    expect(linkBases(["proj/app", "./src"], HOME, 64)).toEqual([]);
  });
});

describe("resolveViaBases: der neueste Ordner gewinnt", () => {
  it("die Datei liegt in genau einem Basisordner: dieser Pfad", () => {
    expect(resolveViaBases("src/main.ts", ["/Users/u/proj/a", "/Users/u/proj/b"], has("/Users/u/proj/b/src/main.ts"))).toBe("/Users/u/proj/b/src/main.ts");
    expect(resolveViaBases("./src/main.ts", ["/Users/u/proj/a"], has("/Users/u/proj/a/src/main.ts"))).toBe("/Users/u/proj/a/src/main.ts");
  });
  it("Gegentest: zwei Basisordner haben die Datei: der vordere (neueste) gewinnt, nicht der ältere und nicht keiner", () => {
    const isFile = has("/Users/u/proj/a/src/main.ts", "/Users/u/proj/b/src/main.ts");
    expect(resolveViaBases("src/main.ts", ["/Users/u/proj/a", "/Users/u/proj/b"], isFile)).toBe("/Users/u/proj/a/src/main.ts");
    expect(resolveViaBases("src/main.ts", ["/Users/u/proj/b", "/Users/u/proj/a"], isFile)).toBe("/Users/u/proj/b/src/main.ts");
  });
  it("dieselbe Datei über zwei Basisordner ist ein Treffer", () => {
    expect(resolveViaBases("../x.md", ["/r/a/b", "/r/a/c"], has("/r/a/x.md"))).toBe("/r/a/x.md");
  });
  it("keine Datei oder keine Basisordner: null", () => {
    expect(resolveViaBases("src/main.ts", ["/Users/u/proj/a"], () => false)).toBeNull();
    expect(resolveViaBases("src/main.ts", [], () => true)).toBeNull();
  });
  it("nur relative Pfade: absolut, ~ und leer ergeben null, auch wenn es die Datei gäbe", () => {
    for (const rel of ["/abs/a.md", "~/a.md", "~", ""]) expect(resolveViaBases(rel, ["/Users/u/proj/a"], () => true)).toBeNull();
  });
});

describe("mergeRecent: Funde über Polls sammeln", () => {
  it("hängt Neues hinten an, chronologisch", () => {
    expect(mergeRecent(["a", "b"], ["c"], 5)).toEqual(["a", "b", "c"]);
  });
  it("ein erneut gesehener Pfad wandert ans Ende", () => {
    expect(mergeRecent(["a", "b", "c"], ["a"], 5)).toEqual(["b", "c", "a"]);
  });
  it("Dubletten in next: das letzte Vorkommen zählt", () => {
    expect(mergeRecent([], ["a", "b", "a"], 5)).toEqual(["b", "a"]);
  });
  it("höchstens cap, die ältesten fallen vorn raus", () => {
    expect(mergeRecent(["a", "b", "c"], ["d", "e"], 3)).toEqual(["c", "d", "e"]);
    expect(mergeRecent(["a"], ["b"], 0)).toEqual([]);
  });
  it("gibt ein neues Array zurück, prev bleibt wie es war", () => {
    const prev = ["a", "b"];
    const merged = mergeRecent(prev, [], 5);
    expect(merged).toEqual(["a", "b"]);
    expect(merged).not.toBe(prev);
    mergeRecent(prev, ["c"], 5);
    expect(prev).toEqual(["a", "b"]);
  });
});

describe("vom Transkript zum Basisordner (Gegentests)", () => {
  it("Gegentest: home wird nie Basisordner, auch wenn alle Funde darunter liegen", () => {
    const text = jsonl(assistant("/Users/u/vault", bash("cd ~/proj/app && ls"), use("Read", { file_path: "/Users/u/proj/app/src/x.ts" })));
    const bases = linkBases(toolPaths(text, HOME), HOME, 64);
    expect(bases).not.toContain(HOME);
    expect(resolveViaBases("README.md", bases, has("/Users/u/README.md"))).toBeNull();
    // Gegenprobe: In einem echten Basisordner wird sie gefunden.
    expect(resolveViaBases("README.md", bases, has("/Users/u/proj/app/README.md"))).toBe("/Users/u/proj/app/README.md");
  });
  it("Gegentest: erst Haupt-Checkout, dann Worktree: die Datei aus dem Worktree, danach wieder zurück", () => {
    const main = assistant("/Users/u/vault", bash("cd ~/proj/app && git status"));
    const tree = assistant("/Users/u/vault", bash("cd /Users/u/wt/app-27b && npm test"));
    const both = has("/Users/u/proj/app/src/main.ts", "/Users/u/wt/app-27b/src/main.ts");
    expect(resolveViaBases("src/main.ts", linkBases(toolPaths(jsonl(main, tree), HOME), HOME, 64), both)).toBe("/Users/u/wt/app-27b/src/main.ts");
    expect(resolveViaBases("src/main.ts", linkBases(toolPaths(jsonl(tree, main), HOME), HOME, 64), both)).toBe("/Users/u/proj/app/src/main.ts");
  });
  it("Gegentest: ein Pfad nur im Fließtext wird kein Basisordner", () => {
    const text = jsonl(assistant("/Users/u/vault", { type: "text", text: "Schau in /Users/u/proj/fliess/src/a.ts" }));
    const bases = linkBases(toolPaths(text, HOME), HOME, 64);
    expect(bases).toEqual([]);
    expect(resolveViaBases("src/a.ts", bases, () => true)).toBeNull();
  });
});

// Abend 38: Pfade mit Leerzeichen (Anführungszeichen, Verlängerung über Leerzeichen, Wortzeile).

describe("quotedCandidates: Pfade in Anführungszeichen (Abend 38)", () => {
  /** Nur Text, Pfad, Zeile und Spalte; dazu prüft jeder Fall, dass text genau der Ausschnitt start..end ist. */
  const quoted = (line: string) =>
    quotedCandidates(line).map((c) => {
      expect(line.slice(c.start, c.end)).toBe(c.text);
      return [c.text, c.path, c.line, c.col];
    });

  it("doppelte, einfache und Backtick-Anführung: der ganze Inhalt mit Leerzeichen", () => {
    expect(quoted(`open "02 Projekte/x y.md" jetzt`)).toEqual([["02 Projekte/x y.md", "02 Projekte/x y.md", null, null]]);
    expect(quoted(`siehe '03 Bereiche/a b.md'.`)).toEqual([["03 Bereiche/a b.md", "03 Bereiche/a b.md", null, null]]);
    expect(quoted("in `Plan 38.md` steht es")).toEqual([["Plan 38.md", "Plan 38.md", null, null]]);
  });
  it("ein @ vor dem öffnenden Zeichen stört nicht", () => {
    expect(quoted(`@"02 Projekte/x y.md"`)).toEqual([["02 Projekte/x y.md", "02 Projekte/x y.md", null, null]]);
  });
  it(":zeile und :zeile:spalte am Ende des Inhalts gelten", () => {
    expect(quoted(`"02 Projekte/x y.md:12"`)).toEqual([["02 Projekte/x y.md:12", "02 Projekte/x y.md", 12, null]]);
    expect(quoted(`"02 Projekte/x y.md:12:3"`)).toEqual([["02 Projekte/x y.md:12:3", "02 Projekte/x y.md", 12, 3]]);
  });
  it("Satzzeichen im Inhalt werden nicht abgeschnitten (die Anführung sagt, wo der Pfad endet)", () => {
    expect(quoted(`"02 Projekte/x y.md."`)).toEqual([["02 Projekte/x y.md.", "02 Projekte/x y.md.", null, null]]);
  });
  it("Gegentest: ohne Leerraum liefert pathCandidates den Pfad schon, hier kommt kein zweiter", () => {
    expect(quoted(`open "src/main.ts" jetzt`)).toEqual([]);
    expect(pathCandidates(`open "src/main.ts" jetzt`).map((c) => c.text)).toEqual(["src/main.ts"]);
  });
  it("Gegentest: URL, kein Buchstabe, weder Schrägstrich noch Punkt", () => {
    expect(quoted(`"https://example.com/a b.html"`)).toEqual([]);
    expect(quoted(`"12 34/56"`)).toEqual([]);
    expect(quoted(`"hallo schöne Welt"`)).toEqual([]);
  });
  it("Apostroph in Prosa klammert nichts ein; ein echtes Paar danach gilt", () => {
    expect(quoted(`it's 02 Projekte/x y.md`)).toEqual([]);
    expect(quoted(`it's mir egal, 'foo bar.md' liegt dort`)).toEqual([["foo bar.md", "foo bar.md", null, null]]);
  });
  it("zwei Anführungen in einer Zeile in Reihenfolge", () => {
    expect(quoted(`cp "a b/c d.md" "e f/g h.md"`).map((r) => r[0])).toEqual(["a b/c d.md", "e f/g h.md"]);
  });
});

describe("candidatesWithQuotes: nach start, bei gleichem start der längere zuerst", () => {
  it("der Anführungs-Kandidat steht vor den Wörtern in seinem Inneren", () => {
    const line = `open "Notes/a b.md" jetzt`;
    const c = candidatesWithQuotes(line);
    expect(c.map((x) => x.text)).toEqual(["Notes/a b.md", "Notes/a", "b.md"]);
    expect(c[0].start).toBe(c[1].start);
  });
  it("ohne Anführung ist es genau pathCandidates", () => {
    const line = "siehe src/main.ts:10 und docs/a.md";
    expect(candidatesWithQuotes(line)).toEqual(pathCandidates(line));
  });
});

const VAULT = "/Users/u/V";
const REPORTED = "/Users/u/V/02 Projekte/Beispiel-App/assets/2026-10-16 Kostenvoranschlag Etappe 1a.pdf";
/** Alle Ordner über den Dateien, so sieht die Ordnerprüfung eines echten Dateisystems aus (die Wurzel eingeschlossen). */
const dirsOf = (...files: string[]): Set<string> => {
  const dirs = new Set<string>(["/"]);
  for (const file of files) for (let d = posix.dirname(file); d !== "/" && !dirs.has(d); d = posix.dirname(d)) dirs.add(d);
  return dirs;
};

function extend(
  line: string,
  files: string[],
  opts: { cwd?: string | null; budget?: ProbeBudget; covered?: (s: number, e: number) => boolean; until?: number; extraDirs?: string[] } = {},
) {
  const fileSet = new Set(files);
  const dirSet = dirsOf(...files);
  for (const d of opts.extraDirs ?? []) dirSet.add(d);
  const isFile = vi.fn((p: string) => fileSet.has(p));
  const isDir = vi.fn((p: string) => dirSet.has(p));
  const budget = opts.budget ?? new ProbeBudget();
  const found = extendCandidates(line, {
    home: HOME, cwd: opts.cwd === undefined ? VAULT : opts.cwd, isFile, isDir, budget, covered: opts.covered, until: opts.until,
  });
  return { found, isFile, isDir, calls: isFile.mock.calls.length + isDir.mock.calls.length, texts: found.map((c) => c.text) };
}

describe("extendCandidates: Pfade mit Leerzeichen ohne Anführungszeichen (Abend 38)", () => {
  it("der gemeldete Pfad (absolut), Text davor und danach gehören nicht dazu", () => {
    const line = `Datei: ${REPORTED} und dann`;
    const r = extend(line, [REPORTED]);
    expect(r.texts).toEqual([REPORTED]);
    expect(r.found[0].abs).toBe(REPORTED);
    expect(line.slice(r.found[0].start, r.found[0].end)).toBe(REPORTED);
    expect(line.slice(r.found[0].start)).toBe(`${REPORTED} und dann`);
  });
  it("Review (a) Prosa davor: `Die Datei 03 Bereiche/Claude Code/x.md` beginnt bei 03, nicht bei Die", () => {
    const line = "Die Datei 03 Bereiche/Claude Code/x.md liegt dort";
    const r = extend(line, [`${VAULT}/03 Bereiche/Claude Code/x.md`]);
    expect(r.texts).toEqual(["03 Bereiche/Claude Code/x.md"]);
    expect(r.found[0].start).toBe(line.indexOf("03"));
    expect(r.found[0].abs).toBe(`${VAULT}/03 Bereiche/Claude Code/x.md`);
  });
  it("Review (b) Satzzeichen und Text danach: Punkt, Komma, Doppelpunkt und weitere Wörter enden bei .pdf", () => {
    for (const tail of [".", ",", ":", " und dann.", " und dann", ", und", "!"]) {
      const line = `Siehe ${REPORTED}${tail}`;
      const r = extend(line, [REPORTED]);
      expect(r.texts, tail).toEqual([REPORTED]);
      expect(line.slice(r.found[0].end), tail).toBe(tail);
    }
  });
  it(":zeile[:spalte] hinter dem Pfad mit Leerzeichen", () => {
    const r = extend("02 Projekte/x y.md:12 dort", [`${VAULT}/02 Projekte/x y.md`]);
    expect(r.found.map((c) => [c.text, c.path, c.line, c.col])).toEqual([["02 Projekte/x y.md:12", "02 Projekte/x y.md", 12, null]]);
    const both = extend("02 Projekte/x y.md:12:3.", [`${VAULT}/02 Projekte/x y.md`]);
    expect(both.found.map((c) => [c.text, c.line, c.col])).toEqual([["02 Projekte/x y.md:12:3", 12, 3]]);
  });
  it("@ vor dem ersten Wort gehört nicht zum Pfad", () => {
    const line = "@02 Projekte/x y.md";
    const r = extend(line, [`${VAULT}/02 Projekte/x y.md`]);
    expect(r.found[0].start).toBe(1);
    expect(r.texts).toEqual(["02 Projekte/x y.md"]);
  });
  it("~/-Pfad, auch wenn der Ordnerteil genau ~ ist", () => {
    expect(extend("~/Meine Datei.md", [`${HOME}/Meine Datei.md`]).texts).toEqual(["~/Meine Datei.md"]);
    expect(extend("~/Mein Ordner/a b.md", [`${HOME}/Mein Ordner/a b.md`]).texts).toEqual(["~/Mein Ordner/a b.md"]);
  });
  it("Dateiname ohne Ordner: Punkt und Endung im letzten Wort genügen (relativ zum Startordner)", () => {
    expect(extend("öffne Plan 38.md bitte", [`${VAULT}/Plan 38.md`]).texts).toEqual(["Plan 38.md"]);
  });
  it("der längste Pfad gewinnt, wenn auch ein kürzerer existiert", () => {
    const r = extend("/d/Mein Bericht Mai.md", ["/d/Mein Bericht", "/d/Mein Bericht Mai.md"]);
    expect(r.texts).toEqual(["/d/Mein Bericht Mai.md"]);
  });
  it("relativ ohne Startordner: nichts zu prüfen, kein einziger Aufruf", () => {
    const r = extend("02 Projekte/x y.md", [`${VAULT}/02 Projekte/x y.md`], { cwd: null });
    expect(r.texts).toEqual([]);
    expect(r.calls).toBe(0);
  });
  it("absolut geht auch ohne Startordner", () => {
    expect(extend("/a b/c d.md", ["/a b/c d.md"], { cwd: null }).texts).toEqual(["/a b/c d.md"]);
  });
  it("genau ein Leerzeichen zwischen den Wörtern: zwei Leerzeichen (Spalten einer Tabelle) oder ein Tab beenden die Verlängerung, auch wenn es die Datei so gäbe", () => {
    expect(extend("02 Projekte/x  y.md", [`${VAULT}/02 Projekte/x  y.md`]).texts).toEqual([]);
    expect(extend("02 Projekte/x\ty.md", [`${VAULT}/02 Projekte/x\ty.md`]).texts).toEqual([]);
    expect(extend("02 Projekte/x y.md", [`${VAULT}/02 Projekte/x y.md`]).texts).toEqual(["02 Projekte/x y.md"]);
  });
  it("höchstens MAX_PATH_WORDS Wörter: 16 gehen, 17 nicht", () => {
    const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i + 1}`);
    const path16 = `/d/${words(16).join(" ")}`;
    expect(MAX_PATH_WORDS).toBe(16);
    expect(extend(path16, [path16]).texts).toEqual([path16]);
    const path17 = `/d/${words(17).join(" ")}`;
    expect(extend(path17, [path17]).texts).toEqual([]);
  });
  it("Review (c) zwei Pfade mit Leerzeichen in einer Zeile: zwei Links, nichts verschmilzt", () => {
    const a = `${VAULT}/02 Projekte/A B/x y.md`;
    const b = `${VAULT}/03 Bereiche/C D/z w.md`;
    const r = extend("02 Projekte/A B/x y.md und 03 Bereiche/C D/z w.md", [a, b]);
    expect(r.texts).toEqual(["02 Projekte/A B/x y.md", "03 Bereiche/C D/z w.md"]);
    expect(r.found.map((c) => c.abs)).toEqual([a, b]);
  });
  it("Review (c) eine Liste von Pfaden (Zeilen mit Leerzeichen verbunden, Aufzählungszeichen dazwischen)", () => {
    const a = `${VAULT}/02 Projekte/A/x y.md`;
    const b = `${VAULT}/03 Bereiche/B/z w.md`;
    const c = `${VAULT}/04 Ressourcen/C/u v.md`;
    const r = extend("- 02 Projekte/A/x y.md - 03 Bereiche/B/z w.md - 04 Ressourcen/C/u v.md", [a, b, c]);
    expect(r.found.map((x) => x.abs)).toEqual([a, b, c]);
  });
  it("Review (d) ein erwähnter Ordner mit Leerzeichen ist keine Datei: kein Link, Budget hält", () => {
    const r = extend("Siehe 02 Projekte/Beispiel-App/assets und weiter so", [], { extraDirs: [`${VAULT}/02 Projekte/Beispiel-App/assets`] });
    expect(r.texts).toEqual([]);
    expect(r.calls).toBeLessThanOrEqual(MAX_PATH_PROBES);
  });
  it("fehlt der Ordnerteil, endet der Start ohne eine einzige Dateiprüfung (ein längerer Text hat denselben Ordner als Vorfahren)", () => {
    const r = extend("Die Datei 03 Bereiche/Claude Code/x.md liegt dort", []);
    expect(r.texts).toEqual([]);
    expect(r.isFile).not.toHaveBeenCalled();
    expect(r.isDir.mock.calls.map((c) => c[0]).slice(0, 3)).toEqual(["/Users/u/V/Die Datei 03 Bereiche", "/Users/u/V/Datei 03 Bereiche", "/Users/u/V/03 Bereiche"]);
  });
  it("Gegentest: ohne diese Datei im Dateisystem kein Kandidat, auch wenn der Ordner da ist", () => {
    expect(extend(`Datei: ${REPORTED}`, [], { extraDirs: [posix.dirname(REPORTED)] }).texts).toEqual([]);
  });
  it("Starts ohne Buchstabe und Ziffer, URLs und schon verlinkte Starts kosten keine Prüfung", () => {
    expect(extend("- * -- 02 Projekte/x y.md", [`${VAULT}/02 Projekte/x y.md`]).texts).toEqual(["02 Projekte/x y.md"]);
    const covered = extend("02 Projekte/x y.md", [`${VAULT}/02 Projekte/x y.md`], { covered: () => true });
    expect(covered.texts).toEqual([]);
    expect(covered.calls).toBe(0);
    expect(extend("https://example.com/a b.html", ["/x"]).calls).toBe(0);
  });
  it("until: Starts ab dem Index entfallen", () => {
    const line = "02 Projekte/x y.md";
    expect(extend(line, [`${VAULT}/02 Projekte/x y.md`], { until: 0 }).texts).toEqual([]);
    expect(extend(line, [`${VAULT}/02 Projekte/x y.md`], { until: 1 }).texts).toEqual(["02 Projekte/x y.md"]);
  });
});

describe("ProbeBudget: Review (e) lange Prosazeilen halten das Budget", () => {
  it("gleiche Prüfung kostet nur einmal, danach undefined wie bei leerem Budget", () => {
    const budget = new ProbeBudget(2);
    const fn = vi.fn(() => true);
    expect(budget.probe("a", fn)).toBe(true);
    expect(budget.probe("a", fn)).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(budget.probe("b", () => false)).toBe(false);
    expect(budget.probe("c", fn)).toBeUndefined();
    expect(budget.probe("a", fn)).toBe(true); // Gedächtnis gilt auch bei leerem Budget
  });
  it("Ordnerteile, die es nicht gibt, kosten je Start genau einen Aufruf, bei 400 Starts nie mehr als MAX_PATH_PROBES", () => {
    const line = Array.from({ length: 400 }, (_, i) => `${i}/${i + 1}`).join(" ");
    const r = extend(line, []);
    expect(r.calls).toBe(MAX_PATH_PROBES);
    expect(r.texts).toEqual([]);
  });
  it("ein Budget über mehrere Aufrufe (zwei Durchläufe einer Abfrage) wird gemeinsam verbraucht", () => {
    const budget = new ProbeBudget(5);
    const line = "1/2 2/3 3/4 4/5 5/6 6/7 7/8 8/9";
    const first = extend(line, [], { budget });
    const second = extend(`${line} 9/10 10/11`, [], { budget });
    expect(first.calls + second.calls).toBeLessThanOrEqual(5);
  });
  it("Budget leer mitten in einem Start: Gefundenes bleibt, es kommt nichts Neues dazu", () => {
    const a = `${VAULT}/02 Projekte/x y.md`;
    const line = "02 Projekte/x y.md und 03 Bereiche/Q R/z w.md";
    const full = extend(line, [a, `${VAULT}/03 Bereiche/Q R/z w.md`]);
    expect(full.texts).toEqual(["02 Projekte/x y.md", "03 Bereiche/Q R/z w.md"]);
    // 2 Prüfungen reichen für Ordner und Datei des ersten Schritts "02 Projekte/x", dann ist Schluss.
    const tight = extend(line, [a, `${VAULT}/03 Bereiche/Q R/z w.md`], { budget: new ProbeBudget(4) });
    expect(tight.calls).toBeLessThanOrEqual(4);
    expect(tight.texts.length).toBeLessThan(2);
  });
});

describe("wordLine: logische Zeile mit Wortnähten (Abend 38)", () => {
  /** Zeile in voller Terminalbreite wie in xterm: leere Zellen bis zum Rand. */
  const rowW = (text: string, width: number, isWrapped = false): CellRow => ({
    cells: Array.from(text.padEnd(width, "\0"), (ch) => (ch === "\0" ? { chars: "", width: 1 } : { chars: ch, width: 1 })),
    isWrapped,
  });
  const rowsOf = (...rows: CellRow[]) => (y: number): CellRow | null => rows[y - 1] ?? null;

  it("Wortnaht: obere Zeile ohne Leerzeichen am Ende, untere ohne Einrückung, ein Leerzeichen dazwischen, von jeder Zeile aus", () => {
    const get = rowsOf(rowW("● Datei 02 Projekte/Beispiel-Projekt", 40), rowW("  App/x y.md ok", 40));
    for (const y of [1, 2]) expect(wordLine(y, get)?.text.trimEnd()).toBe("● Datei 02 Projekte/Beispiel-Projekt App/x y.md ok");
  });
  it("das Leerzeichen sitzt in der Zelle hinter dem letzten Zeichen der oberen Zeile, die untere beginnt hinter ihrer Einrückung", () => {
    const l = wordLine(1, rowsOf(rowW("ab cd", 10), rowW("  ef", 10)));
    expect(l?.text.trimEnd()).toBe("ab cd ef");
    expect(l?.positions.slice(0, 8)).toEqual([
      { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }, { x: 5, y: 1 },
      { x: 6, y: 1 }, // das synthetische Leerzeichen
      { x: 3, y: 2 }, { x: 4, y: 2 },
    ]);
  });
  it("das Leerzeichen liegt auf der oberen Zeile, auch wenn die Zeile fast voll ist, und nie hinter der letzten Spalte", () => {
    const l = wordLine(1, rowsOf(rowW("abcdefghi", 10), rowW("jk", 10)));
    expect(l?.text.trimEnd()).toBe("abcdefghi jk");
    expect(l?.positions[9]).toEqual({ x: 10, y: 1 });
  });
  it("xterm-Umbruch (isWrapped) und volle Zeile verbinden ohne Zeichen, wie logicalLine mit hard", () => {
    const soft = rowsOf(rowW("lang/pf", 7), rowW("ad.ts", 7, true));
    expect(wordLine(2, soft)?.text.trimEnd()).toBe("lang/pfad.ts");
    const full = rowsOf(rowW("  siehe /abs/lang/pf", 20), rowW("     ad.ts:4 und", 20));
    expect(wordLine(1, full)?.text.trimEnd()).toBe("  siehe /abs/lang/pfad.ts:4 und");
    expect(wordLine(1, full)?.text).toBe(logicalLine(1, full, true)?.text);
  });
  it("Gegentest: leere Zeilen verbinden nie", () => {
    const get = rowsOf(rowW("oben", 20), rowW("", 20), rowW("unten", 20));
    expect(wordLine(1, get)?.text.trimEnd()).toBe("oben");
    expect(wordLine(3, get)?.text.trimEnd()).toBe("unten");
    expect(wordLine(2, get)?.text.trim()).toBe("");
  });
  it("Wortnähte reichen nur WORD_SEAM_ROWS Zeilen über und unter y, ein Absatz Prosa wird nicht ganz verbunden", () => {
    const rows = Array.from({ length: 9 }, (_, i) => rowW(`z${i + 1}`, 20));
    const text = wordLine(5, rowsOf(...rows))?.text.trimEnd();
    const expected = rows.slice(5 - 1 - WORD_SEAM_ROWS, 5 + WORD_SEAM_ROWS).map((_, i) => `z${5 - WORD_SEAM_ROWS + i}`).join(" ");
    expect(text).toBe(expected);
    expect(text).not.toContain("z1 ");
    expect(text).not.toContain("z9");
  });
  it("Pfad über drei Zeilen: von jeder der drei Zeilen aus liegt er ganz in der Wortzeile", () => {
    const get = rowsOf(rowW("Datei 02 Projekte/Beispiel-Projekt", 40), rowW("  App/assets/2026-10-16", 40), rowW("  Kostenvoranschlag 1a.pdf", 40));
    for (const y of [1, 2, 3]) expect(wordLine(y, get)?.text).toContain("02 Projekte/Beispiel-Projekt App/assets/2026-10-16 Kostenvoranschlag 1a.pdf");
  });
  it("weich umgebrochene Teile hinter einer Wortnaht gehören ganz dazu, auch jenseits des Abstands", () => {
    const get = rowsOf(rowW("w1", 2), rowW("w2", 2, true), rowW("w3", 4, true), rowW("mid", 4));
    expect(wordLine(4, get)?.text.trimEnd()).toBe("w1w2w3 mid");
  });
  it("volle Zeile ist mehrdeutig: ohne Zeichen (Claude hat ein langes Wort selbst gebrochen) oder an einem Leerzeichen; fullAsSpace wählt das Leerzeichen", () => {
    const get = rowsOf(rowW("Datei 02 Projekte/Beispiel-Projekt", 34), rowW("  App/x y.md", 40));
    expect(wordLine(1, get)?.text.trimEnd()).toBe("Datei 02 Projekte/Beispiel-ProjektApp/x y.md");
    expect(wordLine(1, get, true)?.text.trimEnd()).toBe("Datei 02 Projekte/Beispiel-Projekt App/x y.md");
    // Das Leerzeichen sitzt in der letzten Zelle der oberen Zeile, nie dahinter, und ändert die Positionen der Zeichen nicht.
    const spaced = wordLine(1, get, true);
    expect(spaced?.positions[34]).toEqual({ x: 34, y: 1 });
    expect(spaced?.positions[35]).toEqual({ x: 3, y: 2 });
  });
  it("fullAsSpace ändert nichts, wo es keine volle Zeile gibt", () => {
    const get = rowsOf(rowW("ab cd", 10), rowW("  ef", 10));
    expect(wordLine(1, get, true)).toEqual(wordLine(1, get));
  });
  it("fehlende Zeile; breite Zeichen: Folgezelle entfällt, Zeichen am Zeilenende zählen als letztes Zeichen", () => {
    expect(wordLine(9, rowsOf(rowW("a", 4)))).toBeNull();
    const wide: CellRow = { cells: [{ chars: "界", width: 2 }, { chars: "", width: 0 }, { chars: "", width: 1 }, { chars: "", width: 1 }], isWrapped: false };
    const l = wordLine(1, rowsOf(wide, rowW("x", 4)));
    expect(l?.text.trimEnd()).toBe("界 x");
    expect(l?.positions.slice(0, 3)).toEqual([{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 1, y: 2 }]);
  });
});

// Abend 42, Task 2: Windows-Pfade. Die Plattform kommt als Parameter, die Tests laufen auf jedem Rechner; Erwartungen sind Literale.
describe("Abend 42: resolveCandidatePath und isRelativePath unter win32", () => {
  const ctx = { home: "C:\\Users\\x", cwd: "C:\\p", platform: "win32" as const };
  it("Laufwerkspfad bleibt, Schrägstriche werden Backslashes, die Schreibweise des Laufwerks bleibt", () => {
    expect(resolveCandidatePath("C:\\Users\\x\\a.txt", ctx)).toBe("C:\\Users\\x\\a.txt");
    expect(resolveCandidatePath("c:/Users/x/a.txt", ctx)).toBe("c:\\Users\\x\\a.txt");
    expect(resolveCandidatePath("C:\\a\\.\\b\\..\\c.ts", ctx)).toBe("C:\\a\\c.ts");
  });
  it("UNC-Pfad bleibt", () => {
    expect(resolveCandidatePath("\\\\srv\\share\\a.txt", ctx)).toBe("\\\\srv\\share\\a.txt");
  });
  it("~ mit Backslash oder Schrägstrich gegen home, ~ allein und ~benutzer sind kein Dateipfad", () => {
    expect(resolveCandidatePath("~\\a.txt", ctx)).toBe("C:\\Users\\x\\a.txt");
    expect(resolveCandidatePath("~/b/a.txt", ctx)).toBe("C:\\Users\\x\\b\\a.txt");
    expect(resolveCandidatePath("~", ctx)).toBeNull();
    expect(resolveCandidatePath("~fremd\\x.md", ctx)).toBeNull();
  });
  it("relativ gegen den Startordner (beide Trenner, ..), ohne absoluten Startordner nichts", () => {
    expect(resolveCandidatePath("src\\a.ts", ctx)).toBe("C:\\p\\src\\a.ts");
    expect(resolveCandidatePath("src/a.ts", ctx)).toBe("C:\\p\\src\\a.ts");
    expect(resolveCandidatePath("..\\b.md", { ...ctx, cwd: "C:\\p\\q" })).toBe("C:\\p\\b.md");
    expect(resolveCandidatePath("src\\a.ts", { ...ctx, cwd: null })).toBeNull();
    expect(resolveCandidatePath("src\\a.ts", { ...ctx, cwd: "relativ" })).toBeNull();
  });
  it("Startordner mit ~ wird ausgeschrieben", () => {
    expect(resolveCandidatePath("a.md", { ...ctx, cwd: "~\\repo" })).toBe("C:\\Users\\x\\repo\\a.md");
    expect(resolveCandidatePath("a.md", { ...ctx, cwd: "~" })).toBe("C:\\Users\\x\\a.md");
  });
  it("Gegentest: ohne platform bleibt es der Mac, ein Windows-Pfad ist dort kein absoluter Pfad", () => {
    expect(resolveCandidatePath("C:\\Users\\x\\a.txt", { home: "/Users/n", cwd: "/Users/n/repo" })).toBe("/Users/n/repo/C:\\Users\\x\\a.txt");
  });
  it("isRelativePath", () => {
    expect(isRelativePath("C:\\x", "win32")).toBe(false);
    expect(isRelativePath("c:/x", "win32")).toBe(false);
    expect(isRelativePath("\\\\srv\\share\\a", "win32")).toBe(false);
    expect(isRelativePath("\\Vault\\a.md", "win32")).toBe(false);
    expect(isRelativePath("/Vault/a.md", "win32")).toBe(false);
    expect(isRelativePath("~\\a", "win32")).toBe(false);
    expect(isRelativePath("src\\a.ts", "win32")).toBe(true);
    expect(isRelativePath(".\\a.md", "win32")).toBe(true);
    expect(isRelativePath("", "win32")).toBe(false);
    expect(isRelativePath("C:\\x")).toBe(true);
  });
});

describe("Abend 43: wurzelrelative Pfade im Terminal (win32)", () => {
  const ctx = { home: "C:\\Users\\x", cwd: "C:\\Vault\\Sub", platform: "win32" as const };
  it("\\Vault\\a.md und /Vault/a.md gelten am Laufwerk des Startordners, nicht unter ihm", () => {
    expect(resolveCandidatePath("\\Vault\\a.md", ctx)).toBe("C:\\Vault\\a.md");
    expect(resolveCandidatePath("/Vault/a.md", ctx)).toBe("C:\\Vault\\a.md");
    expect(resolveCandidatePath("\\Vault\\a.md", { ...ctx, cwd: "D:\\p" })).toBe("D:\\Vault\\a.md");
  });
  it("UNC-Startordner: die Freigabe ist die Wurzel; ohne Startordner oder mit relativem gibt es nichts", () => {
    expect(resolveCandidatePath("\\x\\a.md", { ...ctx, cwd: "\\\\srv\\share\\V" })).toBe("\\\\srv\\share\\x\\a.md");
    expect(resolveCandidatePath("\\x\\a.md", { ...ctx, cwd: null })).toBeNull();
    expect(resolveCandidatePath("\\x\\a.md", { ...ctx, cwd: "relativ" })).toBeNull();
  });
  it("C:a.md bleibt abgelehnt, auch mit Startordner auf C:", () => {
    expect(resolveCandidatePath("C:a.md", ctx)).toBeNull();
  });
  it("resolveViaBases hängt Wurzelrelatives nicht mehr an Basisordner", () => {
    expect(resolveViaBases("\\Vault\\a.md", ["C:\\Vault\\Sub"], () => true, "win32")).toBeNull();
  });
  it("doppelter Trenner am Anfang ohne UNC ist weder wurzelrelativ noch relativ noch aufgelöst", () => {
    for (const p of ["\\\\server", "//server", "\\\\"]) {
      expect(resolveCandidatePath(p, ctx), p).toBeNull();
      expect(isRelativePath(p, "win32"), p).toBe(false);
    }
  });
});

describe("Abend 42: Kandidatensuche unter win32", () => {
  const foundW = (line: string) => pathCandidates(line, "win32").map((c) => {
    expect(line.slice(c.start, c.end)).toBe(c.text);
    return [c.text, c.path, c.line, c.col];
  });
  it("Fehlerzeile mit Laufwerk, Zeile und Spalte", () => {
    expect(foundW("Fehler in C:\\Users\\x\\Projekt\\main.ts:12:3")).toEqual([
      ["C:\\Users\\x\\Projekt\\main.ts:12:3", "C:\\Users\\x\\Projekt\\main.ts", 12, 3],
    ]);
  });
  it("Ordner ohne Punkt ist Kandidat, Satzpunkt hinten ab", () => {
    expect(foundW("Ordner C:\\Users\\x\\Projekt")).toEqual([["C:\\Users\\x\\Projekt", "C:\\Users\\x\\Projekt", null, null]]);
    expect(foundW("siehe C:\\Users\\x\\Projekt.")).toEqual([["C:\\Users\\x\\Projekt", "C:\\Users\\x\\Projekt", null, null]]);
  });
  it("relativer Pfad mit Backslash, Laufwerk mit Schrägstrichen, @ vorn", () => {
    expect(foundW("@src\\core\\a.ts")).toEqual([["src\\core\\a.ts", "src\\core\\a.ts", null, null]]);
    expect(foundW("c:/Users/x/a.md:7")).toEqual([["c:/Users/x/a.md:7", "c:/Users/x/a.md", 7, null]]);
  });
  it("Gegentest: URL und Wörter ohne Trenner und Punkt bleiben keine Kandidaten", () => {
    expect(foundW("https://example.com/a.ts Version")).toEqual([]);
    expect(foundW("Fehler in Datei")).toEqual([]);
  });
  it("Gegentest: Auf dem Mac (Vorgabe) ist ein Ordner mit Backslash und ohne Punkt kein Kandidat, mit Punkt wie bisher", () => {
    expect(pathCandidates("Ordner C:\\Users\\x\\Projekt")).toEqual([]);
    expect(pathCandidates("C:\\Users\\x\\main.ts:12:3").map((c) => [c.path, c.line, c.col])).toEqual([["C:\\Users\\x\\main.ts", 12, 3]]);
  });
  it("quotedCandidates und candidatesWithQuotes kennen die Plattform", () => {
    const line = 'Datei "C:\\Mein Ordner\\a b.md:4" offen';
    expect(quotedCandidates(line, "win32").map((c) => [c.text, c.path, c.line])).toEqual([["C:\\Mein Ordner\\a b.md:4", "C:\\Mein Ordner\\a b.md", 4]]);
    expect(candidatesWithQuotes(line, "win32").map((c) => c.text)).toContain("C:\\Mein Ordner\\a b.md:4");
    expect(quotedCandidates('Ordner "C:\\Mein Ordner\\Unter Ordner"', "win32").map((c) => c.path)).toEqual(["C:\\Mein Ordner\\Unter Ordner"]);
    expect(quotedCandidates('Ordner "C:\\Mein Ordner\\Unter Ordner"')).toEqual([]);
  });
});

describe("Abend 42: extendCandidates unter win32", () => {
  const FULL = "C:\\Users\\Jürgen Müller\\Mein Ordner (alt)\\a #1.md";
  const dirsW = (...files: string[]): Set<string> => {
    const dirs = new Set<string>();
    for (const file of files) for (let d = win32.dirname(file); !dirs.has(d); d = win32.dirname(d)) { dirs.add(d); if (win32.dirname(d) === d) break; }
    return dirs;
  };
  const extendW = (line: string, files: string[], cwd: string | null = "C:\\p", dirs?: string[]) => {
    const fileSet = new Set(files);
    const dirSet = dirs ? new Set(dirs) : dirsW(...files);
    const isFile = vi.fn((p: string) => fileSet.has(p));
    const isDir = vi.fn((p: string) => dirSet.has(p));
    const found = extendCandidates(line, { home: "C:\\Users\\x", cwd, isFile, isDir, budget: new ProbeBudget(), platform: "win32" });
    return { found, isFile, isDir };
  };
  it("Leerzeichen, Umlaute, Klammern und # im Pfad: genau dieser Kandidat, wenn nur der ganze Pfad eine Datei ist", () => {
    const line = `Datei: ${FULL} fertig`;
    const { found, isFile } = extendW(line, [FULL]);
    expect(found.map((c) => [c.text, c.abs])).toEqual([[FULL, FULL]]);
    expect(line.slice(found[0].start, found[0].end)).toBe(FULL);
    expect(isFile).toHaveBeenCalledWith(FULL);
  });
  it("Laufwerkswurzel: Datei direkt unter C:\\ wird über den Ordner C:\\ geprüft", () => {
    const { found, isDir } = extendW("C:\\Mein Zeug.md", ["C:\\Mein Zeug.md"]);
    expect(found.map((c) => c.abs)).toEqual(["C:\\Mein Zeug.md"]);
    expect(isDir).toHaveBeenCalledWith("C:\\");
  });
  it("relativ mit Backslash gegen den Startordner, :zeile am Ende", () => {
    const { found } = extendW("02 Projekte\\x y.md:12 dort", ["C:\\p\\02 Projekte\\x y.md"]);
    expect(found.map((c) => [c.text, c.abs, c.line])).toEqual([["02 Projekte\\x y.md:12", "C:\\p\\02 Projekte\\x y.md", 12]]);
  });
  it("Gegentest: Die Datei gibt es, aber ihr Ordner ist kein Ordner: nur die Ordnerprüfung verhindert den Kandidaten", () => {
    const { found, isFile } = extendW(`Datei: ${FULL}`, [FULL], "C:\\p", []);
    expect(found).toEqual([]);
    expect(isFile).not.toHaveBeenCalledWith(FULL);
  });
  it("Auf dem Mac (Vorgabe) steht die Klammer in der Wortlücke: genau dieser Kandidat, abs gleich dem Pfad", () => {
    const abs = "/Users/u/Mein Ordner (alt)/a #1.md";
    const fileSet = new Set([abs]);
    const found = extendCandidates(abs, { home: "/Users/u", cwd: "/", isFile: (p) => fileSet.has(p), isDir: () => true, budget: new ProbeBudget() });
    expect(found.map((c) => [c.text, c.abs])).toEqual([[abs, abs]]);
  });
});

describe("Entscheidung vom 22.10.2026: Klammern in Pfaden mit Leerzeichen auch auf dem Mac", () => {
  const FULL = "/Users/Jürgen Müller/Mein Ordner (alt)/a #1.md";
  const dirsM = (...files: string[]): Set<string> => {
    const dirs = new Set<string>();
    for (const file of files) for (let d = posix.dirname(file); !dirs.has(d); d = posix.dirname(d)) { dirs.add(d); if (posix.dirname(d) === d) break; }
    return dirs;
  };
  const extendM = (line: string, files: string[], cwd: string | null = "/p", dirs?: string[]) => {
    const fileSet = new Set(files);
    const dirSet = dirs ? new Set(dirs) : dirsM(...files);
    const isFile = vi.fn((p: string) => fileSet.has(p));
    const isDir = vi.fn((p: string) => dirSet.has(p));
    const found = extendCandidates(line, { home: "/Users/x", cwd, isFile, isDir, budget: new ProbeBudget() });
    return { found, isFile, isDir };
  };
  it("Leerzeichen, Umlaute, Klammern und # im Pfad: Zeile liefert genau einen Kandidaten", () => {
    const line = `Datei: ${FULL} fertig`;
    const { found, isFile } = extendM(line, [FULL]);
    expect(found.map((c) => [c.text, c.abs])).toEqual([[FULL, FULL]]);
    expect(line.slice(found[0].start, found[0].end)).toBe(FULL);
    expect(isFile).toHaveBeenCalledWith(FULL);
  });
  it("Gegentest: Die Datei gibt es, aber ihr Ordner ist kein Ordner: nur die Ordnerprüfung verhindert den Kandidaten", () => {
    const { found, isFile } = extendM(`Datei: ${FULL}`, [FULL], "/p", []);
    expect(found).toEqual([]);
    expect(isFile).not.toHaveBeenCalledWith(FULL);
  });
  it("Prosa-Klammern machen keinen Fehllink: Klammer um den Pfad liefert keinen Verlängerungs-Kandidaten, eine Klammer dahinter gehört nicht dazu", () => {
    // Großzügige Dateiprüfung (jeder Pfad auf /a.md ist eine Datei): Nur die Ordnerprüfung vor der Verlängerung hält Fehllinks draußen.
    const dirs = new Set(["/Users/u", "/Users", "/"]);
    for (const line of ["(siehe /Users/u/a.md)", "(/Users/u/a.md) und (b.md)"]) {
      const found = extendCandidates(line, { home: "/Users/x", cwd: "/p", isFile: (p) => p.endsWith("/a.md"), isDir: (p) => dirs.has(p), budget: new ProbeBudget() });
      expect(found, line).toEqual([]);
    }
    const paren = "/Users/u/Mein Ordner (alt)/a.md";
    const line = `Siehe ${paren}) danach`;
    const { found } = extendM(line, [paren]);
    expect(found.map((c) => [c.text, c.abs])).toEqual([[paren, paren]]);
    expect(line.slice(found[0].start, found[0].end)).toBe(paren);
  });
  it("Gegentest: Die Lücke ist höchstens ein Leerzeichen mit Klammern; zwei Leerzeichen, Tab und andere Trenner (| [ \") trennen weiterhin", () => {
    const ok = "/Users/u/Mein Ordner (alt)/a.md";
    expect(extendM(`x ${ok}`, [ok]).found.map((c) => c.abs)).toEqual([ok]);
    // Belegt: Klammern ohne Leerzeichen (`Mein(alt)`) sind ebenfalls eine Lücke, die zwei Wörter verbindet (wie unter win32).
    const tight = "/Users/u/Mein(alt)/a.md";
    expect(extendM(`x ${tight}`, [tight]).found.map((c) => c.abs)).toEqual([tight]);
    // Jede Fassung unten wäre bei erlaubter Lücke ein Treffer, weil die Datei unter dem Namen mit EINEM Leerzeichen und Klammern existiert.
    const gaps = ["  ", "\t", " | ", " [", " \"", "( )(  )", "(  ", "  )"];
    for (const gap of gaps) {
      const real = `/Users/u/Mein${gap}Ordner (alt)/a.md`;
      expect(extendM(`x ${real}`, [real]).found, JSON.stringify(gap)).toEqual([]);
    }
  });
  it("Probenzahl: Prosa mit Klammern bleibt unter MAX_PATH_PROBES, auch wenn jeder Ordner existierte", () => {
    const line = "Der Ordner /Users/u/Mein Ordner (alt)/a #1.md (neu) wurde (gestern) mit docs/b.md (heute) angelegt und (dann) kopiert";
    const count = (dirExists: boolean): number => {
      let probes = 0;
      extendCandidates(line, { home: "/Users/u", cwd: "/Users/u/p", isFile: () => { probes++; return false; }, isDir: () => { probes++; return dirExists; }, budget: new ProbeBudget(100000) });
      return probes;
    };
    expect(count(false)).toBeLessThan(30);
    expect(count(true)).toBeLessThan(MAX_PATH_PROBES);
  });
});

describe("Abend 42: Basisordner unter win32", () => {
  const HOMEW = "C:\\Users\\u";
  const hasW = (...files: string[]) => (p: string) => files.includes(p);
  it("linkBases: jeder Pfad und seine Elternordner, neueste zuerst", () => {
    expect(linkBases(["C:\\Users\\u\\old\\proj\\src", "C:\\Users\\u\\proj\\app\\src"], HOMEW, 64, "win32")).toEqual([
      "C:\\Users\\u\\proj\\app\\src", "C:\\Users\\u\\proj\\app", "C:\\Users\\u\\proj", "C:\\Users\\u\\old\\proj\\src", "C:\\Users\\u\\old\\proj", "C:\\Users\\u\\old",
    ]);
  });
  it("ohne Dubletten, auch bei anderer Schreibweise", () => {
    expect(linkBases(["C:\\Users\\u\\proj\\a", "C:\\Users\\u\\proj\\b", "C:\\Users\\u\\proj\\a"], HOMEW, 64, "win32")).toEqual([
      "C:\\Users\\u\\proj\\a", "C:\\Users\\u\\proj", "C:\\Users\\u\\proj\\b",
    ]);
    expect(linkBases(["C:\\Users\\u\\Proj\\a", "c:\\users\\u\\proj\\b"], HOMEW, 64, "win32")).toEqual(["c:\\users\\u\\proj\\b", "c:\\users\\u\\proj", "C:\\Users\\u\\Proj\\a"]);
  });
  it("gegentest: nie home, nie ein Vorfahre von home, nie ein Ordner mit weniger als zwei Stufen unter dem Laufwerk", () => {
    expect(linkBases(["C:\\Users\\u\\proj", HOMEW, "C:\\Users", "C:\\", "C:\\tmp", "C:\\tmp\\x", "D:\\opt\\tools\\bin"], HOMEW, 64, "win32")).toEqual([
      "D:\\opt\\tools\\bin", "D:\\opt\\tools", "C:\\tmp\\x", "C:\\Users\\u\\proj",
    ]);
  });
  it("home in anderer Schreibweise und mit Backslash am Ende gilt genauso", () => {
    expect(linkBases(["c:\\users\\u\\proj", "c:\\users\\u"], "C:\\Users\\u\\", 64, "win32")).toEqual(["c:\\users\\u\\proj"]);
  });
  it("UNC: die Freigabe zählt nicht als Stufe", () => {
    expect(linkBases(["\\\\srv\\share\\proj\\app"], HOMEW, 64, "win32")).toEqual(["\\\\srv\\share\\proj\\app"]);
  });
  it("höchstens max; relative Pfade sind keine Basisordner", () => {
    expect(linkBases(["C:\\Users\\u\\proj\\app\\src\\core"], HOMEW, 2, "win32")).toEqual(["C:\\Users\\u\\proj\\app\\src\\core", "C:\\Users\\u\\proj\\app\\src"]);
    expect(linkBases(["proj\\app", ".\\src"], HOMEW, 64, "win32")).toEqual([]);
  });
  it("resolveViaBases: der neueste Ordner gewinnt, beide Trenner", () => {
    const isFile = hasW("C:\\Users\\u\\proj\\a\\src\\main.ts", "C:\\Users\\u\\proj\\b\\src\\main.ts");
    expect(resolveViaBases("src\\main.ts", ["C:\\Users\\u\\proj\\a", "C:\\Users\\u\\proj\\b"], isFile, "win32")).toBe("C:\\Users\\u\\proj\\a\\src\\main.ts");
    expect(resolveViaBases("./src/main.ts", ["C:\\Users\\u\\proj\\b", "C:\\Users\\u\\proj\\a"], isFile, "win32")).toBe("C:\\Users\\u\\proj\\b\\src\\main.ts");
    expect(resolveViaBases("..\\x.md", ["C:\\r\\a\\b", "C:\\r\\a\\c"], hasW("C:\\r\\a\\x.md"), "win32")).toBe("C:\\r\\a\\x.md");
  });
  it("resolveViaBases: absolut, ~ und leer ergeben null, auch wenn es die Datei gäbe", () => {
    for (const rel of ["C:\\abs\\a.md", "c:/abs/a.md", "~\\a.md", "~", "", "\\\\srv\\share\\a"]) {
      expect(resolveViaBases(rel, ["C:\\Users\\u\\proj\\a"], () => true, "win32"), rel).toBeNull();
    }
  });
  it("toolPaths: Ordner aus file_path, path und cd-Ziel mit Laufwerk", () => {
    const paths = [...new Set(toolPaths(jsonl(
      assistant("C:\\Users\\u\\vault", use("Read", { file_path: "C:\\Users\\u\\proj\\app\\src\\x.ts" })),
      assistant("C:\\Users\\u\\vault", use("Grep", { pattern: "foo", path: "~\\proj\\lib" })),
      assistant("C:\\Users\\u\\vault", bash("cd D:\\work\\app\\ && git status")),
    ), HOMEW, "win32"))];
    expect(paths).toEqual(["C:\\Users\\u\\proj\\app\\src", "C:\\Users\\u\\proj\\lib", "D:\\work\\app"]);
  });
});

describe("Abend 42: vaultRelative unter win32", () => {
  it("im Vault: relativer Pfad mit Schrägstrichen, Schreibweise und Trenner egal", () => {
    expect(vaultRelative("C:\\Vault\\Ordner\\a.md", "C:\\VAULT", "win32")).toBe("Ordner/a.md");
    expect(vaultRelative("c:/vault/Ordner/a.md", "C:\\Vault", "win32")).toBe("Ordner/a.md");
    expect(vaultRelative("C:\\Vault\\Index.md", "C:\\Vault\\", "win32")).toBe("Index.md");
  });
  it("Gegentest: Nachbarordner mit gleichem Anfang, anderes Laufwerk, Vault selbst, kein Vault", () => {
    expect(vaultRelative("C:\\Vault2\\a.md", "C:\\Vault", "win32")).toBeNull();
    expect(vaultRelative("D:\\Vault\\a.md", "C:\\Vault", "win32")).toBeNull();
    expect(vaultRelative("C:\\Vault", "C:\\Vault", "win32")).toBeNull();
    expect(vaultRelative("C:\\Vault\\", "C:\\Vault", "win32")).toBeNull();
    expect(vaultRelative("C:\\Vault\\a.md", null, "win32")).toBeNull();
  });
  it("Gegentest: Auf dem Mac (Vorgabe) liegt ein Windows-Pfad nie im Vault", () => {
    expect(vaultRelative("C:\\Vault\\Ordner\\a.md", "C:\\VAULT")).toBeNull();
    expect(vaultRelative("/V/Notes/a b.md", "/V")).toBe("Notes/a b.md");
  });
});

describe("Abend 42: Ctrl+Klick unter Windows", () => {
  const keys = (extra: Partial<{ button: number; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }>) => ({ button: 0, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...extra });
  it("win32: Ctrl+Linksklick öffnet", () => {
    expect(opensOnClick(keys({ ctrlKey: true }), "win32")).toBe(true);
  });
  it("win32: Gegentest: Meta (Windows-Taste) allein, einfacher Klick, Ctrl+Alt (AltGr), andere Tasten öffnen nicht", () => {
    expect(opensOnClick(keys({ metaKey: true }), "win32")).toBe(false);
    expect(opensOnClick(keys({}), "win32")).toBe(false);
    expect(opensOnClick(keys({ ctrlKey: true, altKey: true }), "win32")).toBe(false);
    expect(opensOnClick(keys({ ctrlKey: true, button: 1 }), "win32")).toBe(false);
    expect(opensOnClick(keys({ ctrlKey: true, button: 2 }), "win32")).toBe(false);
  });
  it("win32 (Abend 43): Ctrl+Shift und Ctrl+Meta öffnen nicht, Ctrl allein schon", () => {
    expect(opensOnClick(keys({ ctrlKey: true, shiftKey: true }), "win32")).toBe(false);
    expect(opensOnClick(keys({ ctrlKey: true, metaKey: true }), "win32")).toBe(false);
    expect(opensOnClick(keys({ ctrlKey: true }), "win32")).toBe(true);
  });
  it("darwin (Abend 43): Cmd+Shift öffnet wie bisher (festgeschrieben, der Mac bleibt unverändert)", () => {
    expect(opensOnClick(keys({ metaKey: true, shiftKey: true }), "darwin")).toBe(true);
    expect(opensOnClick(keys({ metaKey: true }), "darwin")).toBe(true);
  });
  it("darwin unverändert: Cmd öffnet, Ctrl nicht, auch ohne Angabe der Plattform", () => {
    expect(opensOnClick(keys({ metaKey: true }))).toBe(true);
    expect(opensOnClick(keys({ metaKey: true }), "darwin")).toBe(true);
    expect(opensOnClick(keys({ ctrlKey: true }), "darwin")).toBe(false);
    expect(opensOnClick(keys({ ctrlKey: true }))).toBe(false);
    expect(opensOnClick(keys({ metaKey: true, ctrlKey: true }), "darwin")).toBe(false);
    expect(opensOnClick(keys({ metaKey: true, altKey: true }), "darwin")).toBe(false);
  });
  it("plainLeftClick bleibt: links ohne Ctrl und Alt", () => {
    expect(plainLeftClick(keys({}))).toBe(true);
    expect(plainLeftClick(keys({ ctrlKey: true }))).toBe(false);
    expect(plainLeftClick(keys({ altKey: true }))).toBe(false);
    expect(plainLeftClick(keys({ button: 2 }))).toBe(false);
  });
  it("linkModifierDown: win32 Ctrl, darwin Cmd", () => {
    const k = (extra: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }>) => ({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...extra });
    expect(linkModifierDown(k({ ctrlKey: true }), "win32")).toBe(true);
    expect(linkModifierDown(k({ metaKey: true }), "win32")).toBe(false);
    expect(linkModifierDown(k({ metaKey: true }), "darwin")).toBe(true);
    expect(linkModifierDown(k({ ctrlKey: true }), "darwin")).toBe(false);
  });
  it("linkModifierDown (Abend 43): win32 unterstreicht nur bei Ctrl allein, darwin Cmd+Shift wie bisher", () => {
    const k = (extra: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }>) => ({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...extra });
    for (const extra of [{ shiftKey: true }, { altKey: true }, { metaKey: true }]) expect(linkModifierDown(k({ ctrlKey: true, ...extra }), "win32"), JSON.stringify(extra)).toBe(false);
    expect(linkModifierDown(k({ metaKey: true, shiftKey: true }), "darwin")).toBe(true);
  });
  it("vaultRelative (Abend 43): win32 gleicht die Schreibweise an die Dateiliste an, darwin nicht", () => {
    expect(vaultRelative("c:\\vault\\ORDNER\\a.md", "C:\\Vault", "win32", ["Ordner/a.md"])).toBe("Ordner/a.md");
    expect(vaultRelative("c:\\vault\\ORDNER\\neu.md", "C:\\Vault", "win32", ["Ordner/a.md"])).toBe("Ordner/neu.md");
    expect(vaultRelative("c:\\vault\\ORDNER\\a.md", "C:\\Vault", "win32")).toBe("ORDNER/a.md");
    expect(vaultRelative("/V/ORDNER/a.md", "/V", "darwin", ["Ordner/a.md"])).toBe("ORDNER/a.md");
  });
  it("modKeyName", () => {
    expect(modKeyName("win32")).toBe("Ctrl");
    expect(modKeyName("darwin")).toBe("Cmd");
  });
});

describe("Bildtypen (Nachtrag 43c)", () => {
  it("imageMime nach Endung", () => {
    expect(imageMime("/a/hero-375.png")).toBe("image/png");
    expect(imageMime("C:\\x\\Bild.JPEG")).toBe("image/jpeg");
    expect(imageMime("/a/b.svg")).toBe("image/svg+xml");
    for (const p of ["/a/.png", "/a/png", "/a.png/datei", "/a/b.pdf"]) expect(imageMime(p)).toBeNull();
  });
  it("genau acht Endungen", () => {
    expect(Object.keys(IMAGE_MIME).sort()).toEqual(["bmp", "gif", "ico", "jpeg", "jpg", "png", "svg", "webp"]);
    for (const e of Object.keys(IMAGE_MIME)) expect(imageMime(`/a/b.${e.toUpperCase()}`)).toBe(IMAGE_MIME[e]);
  });
  it("formatBytes", () => {
    expect([0, 1023, 1024, 245760, 1048576, 2516582].map(formatBytes)).toEqual(["0 B", "1023 B", "1 KB", "240 KB", "1 MB", "2,4 MB"]);
  });
  it("imageInfo", () => {
    expect(imageInfo(375, 812, 245760, false)).toBe("375 \u00d7 812 px \u00b7 240 KB");
    expect(imageInfo(300, 150, 900, true)).toBe("SVG \u00b7 900 B");
  });
});

describe("urlRanges (Nachtrag 43h: Weblinks)", () => {
  const urls = (line: string) => urlRanges(line).map((r) => { expect(line.slice(r.start, r.end)).toBe(r.url); return r.url; });
  it("findet http und https mitten im Text", () => {
    expect(urls("Siehe https://example.com/a?b=1#c und http://x.de")).toEqual(["https://example.com/a?b=1#c", "http://x.de"]);
  });
  it("Satzzeichen am Ende gehören nicht dazu", () => {
    expect(urls("Link: https://example.com/pfad.")).toEqual(["https://example.com/pfad"]);
    expect(urls("(https://example.com/x), danach")).toEqual(["https://example.com/x"]);
    expect(urls("„https://example.com/x“")).toEqual(["https://example.com/x"]);
  });
  it("Klammern im Pfad bleiben, wenn sie ausgeglichen sind", () => {
    expect(urls("https://de.wikipedia.org/wiki/Test_(Begriff) ok")).toEqual(["https://de.wikipedia.org/wiki/Test_(Begriff)"]);
  });
  it("Anführungszeichen und spitze Klammern beenden die URL", () => {
    expect(urls('href="https://a.de/x" <https://b.de/y>')).toEqual(["https://a.de/x", "https://b.de/y"]);
  });
  it("Gegentest: andere Schemata, nacktes Schema und Wortteile zählen nicht", () => {
    expect(urls("ftp://a.de file:///etc/x javascript:alert(1) https:// xhttps://a.de")).toEqual([]);
  });
});
