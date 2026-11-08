import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listFilesRecursive, relativeToRoot, ROOT } from "./helpers/files";

// Wächter (Abend 42, Task 1): Die Plattform und der Vault-Pfad werden an genau einer Stelle gelesen, in src/host/host-platform.ts.
const HOST_PLATFORM = "src/host/host-platform.ts";
const src = () => listFilesRecursive(join(ROOT, "src")).filter((f) => /\.ts$/.test(f));
/**
 * Quelltext ohne Kommentare, Zeilen bleiben erhalten (Kommentare werden durch nichts ersetzt, Zeilenumbrüche bleiben).
 * Zeichenketten und Template-Strings werden übersprungen, damit "http://x" kein Kommentar beginnt. Block- und Zeilenkommentare
 * zählen auch mitten in einer Zeile und über mehrere Zeilen.
 */
function stripComments(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; ) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, "");
      i = stop;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}
const codeLinesOf = (text: string): string[] => stripComments(text).split("\n");
const codeLines = (f: string) => codeLinesOf(readFileSync(f, "utf8"));
const filesWith = (needle: string) => src().filter((f) => codeLines(f).some((z) => z.includes(needle))).map(relativeToRoot);

describe("Plattform und Vault-Pfad nur in host-platform.ts", () => {
  it("Positivprobe: die Suche findet process.platform und getBasePath( in host-platform.ts", () => {
    expect(filesWith("process.platform")).toContain(HOST_PLATFORM);
    expect(filesWith("getBasePath(")).toContain(HOST_PLATFORM);
  });
  it("Kommentarzeilen zählen nicht (die Suche kann sie ausblenden)", () => {
    expect(codeLines(join(ROOT, "src/core/platform-path.ts")).join("\n")).not.toContain("process.platform");
    expect(readFileSync(join(ROOT, "src/core/platform-path.ts"), "utf8")).toContain("process.platform");
  });
  it("process.platform steht nur in host-platform.ts", () => {
    expect(filesWith("process.platform")).toEqual([HOST_PLATFORM]);
  });
  it("getBasePath( steht nur in host-platform.ts", () => {
    expect(filesWith("getBasePath(")).toEqual([HOST_PLATFORM]);
  });
});

// Wächter (Abend 42, Task 3): Home-Auflösung und Home-Kürzung gibt es je einmal, im Kern.
describe("keine Kopien von expandHome und shortPath", () => {
  const COUNT = (re: RegExp): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const f of src()) {
      const n = codeLines(f).filter((z) => re.test(z)).length;
      if (n > 0) out[relativeToRoot(f)] = n;
    }
    return out;
  };
  const EXPAND = /export (function|const) expandHome\b/;
  const SHORT = /\b(function|const|let|var)\s+shortPath\b/;

  it("Positivprobe: die Muster erkennen Deklarationen, aber nicht expandHomePath", () => {
    expect(EXPAND.test("export function expandHome(path: string) {")).toBe(true);
    expect(EXPAND.test("export const expandHome = (path: string) => path;")).toBe(true);
    expect(EXPAND.test("export function expandHomePath(platform: Platform) {")).toBe(false);
    expect(SHORT.test("export function shortPath(path: string) {")).toBe(true);
    expect(SHORT.test("const shortPath = (path: string) => path;")).toBe(true);
    expect(SHORT.test("import { shortPath } from './x'; shortPath(a)")).toBe(false);
    expect(COUNT(EXPAND)).toEqual({ "src/core/settings.ts": 1 });
    expect(COUNT(SHORT)).toEqual({ "src/core/claude-launch.ts": 1 });
  });
  it("export function expandHome steht genau einmal in src/, in settings.ts", () => {
    expect(COUNT(EXPAND)).toEqual({ "src/core/settings.ts": 1 });
  });
  it("shortPath ist nur in src/core/claude-launch.ts deklariert, src/host hat keine eigene", () => {
    expect(COUNT(SHORT)).toEqual({ "src/core/claude-launch.ts": 1 });
    expect(Object.keys(COUNT(SHORT)).filter((f) => f.startsWith("src/host/"))).toEqual([]);
  });
  it("file-viewer-modal.ts nutzt die Kernfunktion", () => {
    const text = readFileSync(join(ROOT, "src/host/file-viewer-modal.ts"), "utf8");
    expect(text).toMatch(/import \{[^}]*\bshortPath\b[^}]*\} from "\.\.\/core\/claude-launch"/);
  });
});

// Wächter (Abend 42, Task 3, Fix-Runde 1, Ruling 7): Jede Stelle im Host, die eine Plattform braucht, übergibt sie.
// Gelesen wird der Quelltext; ein Aufruf zählt mit allen Argumenten (Klammern und Anführungszeichen werden beachtet).
/** Index hinter der Zeichenkette, die bei i (an der öffnenden Anführung) beginnt; Template-Strings mit ${…} und verschachtelten Zeichenketten inklusive. */
function skipString(text: string, i: number): number {
  const q = text[i];
  let j = i + 1;
  while (j < text.length && text[j] !== q) {
    if (text[j] === "\\") j += 2;
    else if (q === "`" && text[j] === "$" && text[j + 1] === "{") {
      let depth = 1;
      j += 2;
      while (j < text.length && depth > 0) {
        if (text[j] === '"' || text[j] === "'" || text[j] === "`") j = skipString(text, j);
        else {
          if (text[j] === "{") depth++;
          else if (text[j] === "}") depth--;
          j++;
        }
      }
    } else j++;
  }
  return j + 1;
}
/** Argumente jedes Aufrufs `name(` im Text; Deklarationen (`function name(`) und längere Namen (`nameXyz(`) zählen nicht. */
function callArgs(text: string, name: string): string[][] {
  const calls: string[][] = [];
  const re = new RegExp(`(?<!\\w)(?<![^.]\\.)${name}\\(`, "g");
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (/function\s+$/.test(text.slice(0, m.index))) continue;
    const args: string[] = [];
    let depth = 1;
    let cur = "";
    let i = m.index + m[0].length;
    for (; i < text.length && depth > 0; ) {
      const c = text[i];
      if (c === '"' || c === "'" || c === "`") {
        const end = skipString(text, i);
        cur += text.slice(i, end);
        i = end;
        continue;
      }
      if ("([{".includes(c)) {
        depth++;
        cur += c;
      } else if (")]}".includes(c)) {
        depth--;
        if (depth > 0) cur += c;
      } else if (c === "," && depth === 1) {
        args.push(cur.trim());
        cur = "";
      } else cur += c;
      i++;
    }
    if (cur.trim() !== "") args.push(cur.trim());
    calls.push(args);
    re.lastIndex = Math.max(re.lastIndex, i);
  }
  return calls;
}
const hostFiles = () => src().filter((f) => /src\/(host\/.*|main)\.ts$/.test(f));
const callsIn = (files: string[], name: string) =>
  files.flatMap((f) => callArgs(codeLines(f).join("\n"), name).map((args) => ({ file: relativeToRoot(f), args })));
const readSrc = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("Plattform an den Aufrufen im Host", () => {
  it("Positivprobe der Aufruf-Suche: Verschachtelung, Zeichenketten, Deklaration und längere Namen", () => {
    expect(callArgs("x(a, f(b, c), `t,${d}`)", "x")).toEqual([["a", "f(b, c)", "`t,${d}`"]]);
    expect(callArgs("export function expandHome(p: string, h: string) {}\nexpandHome(a, b);", "expandHome")).toEqual([["a", "b"]]);
    expect(callArgs("expandHomePath(a, b, c); foo.expandHome(a)", "expandHome")).toEqual([]);
    expect(callArgs("[...g(a, b)]", "g")).toEqual([["a", "b"]]);
    expect(callArgs("g((x) => y, 'a,b', z)", "g")).toEqual([["(x) => y", "'a,b'", "z"]]);
  });

  it("jeder expandHome-Aufruf in src/host und main.ts übergibt eine Plattform (drittes Argument)", () => {
    const calls = callsIn(hostFiles(), "expandHome");
    // Positivprobe: main.ts, handoff-vault, feed-source, research-card, usage-card, telegram-send: mindestens 10 Aufrufe.
    expect(calls.length).toBeGreaterThanOrEqual(10);
    expect(new Set(calls.map((c) => c.file))).toEqual(
      new Set(["src/main.ts", "src/host/handoff-vault.ts", "src/host/feed-source.ts", "src/host/research-card.ts", "src/host/usage-card.ts", "src/host/telegram-send.ts"]),
    );
    expect(calls.filter((c) => c.args.length < 3).map((c) => `${c.file}: expandHome(${c.args.join(", ")})`)).toEqual([]);
  });
  it("Gegenfall: ein expandHome ohne Plattform fällt auf", () => {
    const calls = callArgs("a = expandHome(THRESHOLDS_FILE, home);\nb = expandHome(p, h, platform);", "expandHome");
    expect(calls.filter((args) => args.length < 3)).toEqual([["THRESHOLDS_FILE", "home"]]);
  });

  it("jeder readOpenHandoffs-Aufruf in main.ts übergibt hostPlatform() als fünftes Argument", () => {
    const calls = callsIn([join(ROOT, "src/main.ts")], "readOpenHandoffs");
    expect(calls.length).toBeGreaterThanOrEqual(2); // Positivprobe: Feed-Quelle und Menü „Neue Sitzung“
    expect(calls.filter((c) => c.args[4] !== "hostPlatform()").map((c) => c.args.join(", "))).toEqual([]);
  });
  it("Gegenfall readOpenHandoffs: der alte Aufruf ohne Plattform fällt auf", () => {
    expect(callArgs("readOpenHandoffs(this.app.vault, s, parseYaml, homedir())", "readOpenHandoffs")[0][4]).toBeUndefined();
  });

  it("handoffChoices in main.ts: hostPlatform() als sechstes Argument", () => {
    const calls = callsIn([join(ROOT, "src/main.ts")], "handoffChoices");
    expect(calls).toHaveLength(1);
    expect(calls[0].args[5]).toBe("hostPlatform()");
  });
  it("loadProjectDirs und sessionChoices im Menü-Dialog: hostPlatform() als letztes Argument", () => {
    const text = readSrc("src/host/new-session-modal.ts");
    const load = callArgs(text, "loadProjectDirs");
    const choices = callArgs(text, "sessionChoices");
    expect(load).toHaveLength(1);
    expect(choices).toHaveLength(1);
    expect(load[0][3]).toBe("hostPlatform()");
    expect(choices[0][6]).toBe("hostPlatform()");
  });
  it("headerTitle in terminal-view.ts: hostPlatform() als fünftes Argument", () => {
    const calls = callArgs(readSrc("src/host/terminal-view.ts"), "headerTitle");
    expect(calls).toHaveLength(1);
    expect(calls[0][4]).toBe("hostPlatform()");
  });
  it("shortPath im Datei-Viewer: hostPlatform() als drittes Argument", () => {
    const calls = callArgs(readSrc("src/host/file-viewer-modal.ts"), "shortPath");
    expect(calls).toHaveLength(1);
    expect(calls[0][2]).toBe("hostPlatform()");
  });
  it("Ausschluss: main.ts reicht hostPlatform() als viertes Argument an readExclusion (Abend 42)", () => {
    const calls = callsIn([join(ROOT, "src/main.ts")], "readExclusion");
    expect(calls).toHaveLength(1);
    expect(calls[0].args[3]).toBe("hostPlatform()");
  });
  it("Gegenfall: ein readExclusion ohne Plattform fällt auf", () => {
    expect(callArgs("readExclusion(a, b, c);", "readExclusion")[0][3]).toBeUndefined();
  });
  it("Telegram: telegramText und sendTelegram bekommen die Plattform, main.ts reicht sie in die Deps", () => {
    expect(callArgs(readSrc("src/host/telegram-notify.ts"), "telegramText")[0][4]).toBe("this.deps.platform");
    expect(callArgs(readSrc("src/host/telegram-notify.ts"), "sendTelegram")[0][3]).toBe("this.deps.platform");
    expect(callArgs(readSrc("src/host/settings-tab.ts"), "sendTelegram")[0][3]).toBe("this.platform");
    const notifier = callsIn([join(ROOT, "src/main.ts")], "new TelegramNotifier");
    expect(notifier).toHaveLength(1);
    expect(notifier[0].args[0]).toMatch(/\bplatform\b/);
  });
  it("Feed-Quelle: main.ts reicht platform in die Deps", () => {
    const feed = callsIn([join(ROOT, "src/main.ts")], "new CockpitFeedSource");
    expect(feed).toHaveLength(1);
    expect(feed[0].args[0]).toMatch(/^\{[\s\S]*\bplatform,/);
  });
  it("Repo-Ampel und Tageszählung teilen eine Auflösung des Projekte-Ordners", () => {
    const main = readSrc("src/main.ts");
    expect(main.match(/listGitRepos\(projectsRoot\(\)\)/g)).toHaveLength(2);
    expect(main).toMatch(/const projectsRoot = \(\): string => expandHome\(store\.settings\(\)\.projectsRoot, home, platform\)/);
  });
  it("Ton (Abend 43): terminal-view reicht Plattform und SystemRoot an effectiveSoundFile und die Plattform an playSound", () => {
    const text = codeLines(join(ROOT, "src/host/terminal-view.ts")).join("\n");
    const eff = callArgs(text, "effectiveSoundFile");
    expect(eff).toHaveLength(1);
    expect(eff[0][0]).toBe("hostPlatform()");
    expect(eff[0][1]).toBe("s.soundFile");
    expect(eff[0][2]).toMatch(/process\.env\.SystemRoot/);
    const play = callArgs(text, "playSound");
    expect(play).toHaveLength(1);
    expect(play[0][1]).toBe("hostPlatform()");
  });
  it("Fix-Welle: der Platzhalter der Klangdatei läuft über effectiveSoundFile, nicht über windowsSoundFile", () => {
    const text = codeLines(join(ROOT, "src/host/settings-tab.ts")).join("\n");
    expect(text).not.toMatch(/windowsSoundFile/);
    const eff = callArgs(text, "effectiveSoundFile");
    expect(eff).toHaveLength(1);
    expect(eff[0][0]).toBe("this.platform");
    expect(eff[0][1]).toBe('""');
  });
  it("Fix-Welle: die Vault-Pfad-Liste (getFiles) wird in main.ts an genau einer Stelle gebaut", () => {
    const text = codeLines(join(ROOT, "src/main.ts")).join("\n");
    expect(text.match(/getFiles\(\)/g)).toHaveLength(1);
    expect(text.match(/vaultPaths,\s*\n/g)).toHaveLength(2);
  });
  it("Gegenfall: playSound ohne Plattform fällt auf", () => {
    expect(callArgs("playSound(effectiveSoundFile(p, s.soundFile, r));", "playSound")[0][1]).toBeUndefined();
  });
});

// Wächter (Abend 43, Task 3): Im Host ist die Plattform Pflicht. Keine Vorgabe "darwin", kein optionales Feld, kein Rückfall;
// os.platform(), platform() aus node:os und process.arch stehen nur in host-platform.ts.
describe("Plattform im Host ist Pflicht (Abend 43)", () => {
  const hostOnly = () => src().filter((f) => /^src\/host\//.test(relativeToRoot(f)) && relativeToRoot(f) !== HOST_PLATFORM);
  const VORGABEN: Record<string, RegExp> = {
    'Platform = "darwin"': /Platform\s*=\s*"darwin"/,
    '?? "darwin"': /\?\?\s*"darwin"/,
    "platform?:": /\bplatform\?\s*:/,
    'platform: "darwin" als Vorgabe': /\{\s*platform:\s*"darwin"\s*,/,
    "platform: Platform = (Parameter-Vorgabe)": /\bplatform\s*:\s*Platform\s*=/,
    "?? hostPlatform()": /\?\?\s*hostPlatform\(\)/,
  };
  const OS: Record<string, RegExp> = {
    "os.platform(": /\bos\.platform\(/,
    "platform() ohne Punkt": /(?<![\w.$])platform\s*\(/,
    "process.arch": /\bprocess\.arch\b/,
    "platform aus node:os": /import\s*\{[^}]*\bplatform\b[^}]*\}\s*from\s*["'](node:)?os["']/,
  };
  const treffer = (muster: Record<string, RegExp>): string[] =>
    hostOnly().flatMap((f) =>
      codeLines(f).flatMap((z, i) => Object.entries(muster).filter(([, re]) => re.test(z)).map(([name]) => `${relativeToRoot(f)}:${i + 1} ${name}`)),
    );

  it("Positivprobe: jedes Vorgaben-Muster erkennt sein Beispiel, das saubere Gegenstück nicht", () => {
    expect(VORGABEN['Platform = "darwin"'].test('home: string, platform: Platform = "darwin") {')).toBe(true);
    expect(VORGABEN['?? "darwin"'].test('asPlatform(x) ?? "darwin"')).toBe(true);
    expect(VORGABEN["platform?:"].test("  platform?: Platform;")).toBe(true);
    expect(VORGABEN['platform: "darwin" als Vorgabe'].test('options = { platform: "darwin", env: () => process.env },')).toBe(true);
    expect(VORGABEN["platform: Platform = (Parameter-Vorgabe)"].test("constructor(a: A, platform: Platform = hostPlatform()) {")).toBe(true);
    expect(VORGABEN["?? hostPlatform()"].test("this.deps.platform ?? hostPlatform()")).toBe(true);
    for (const re of Object.values(VORGABEN)) expect(re.test("  platform: Platform;\n  platform,")).toBe(false);
  });
  it("Positivprobe: jedes OS-Muster erkennt sein Beispiel, hostPlatform() nicht", () => {
    expect(OS["os.platform("].test("const p = os.platform();")).toBe(true);
    expect(OS["platform() ohne Punkt"].test("const p = platform();")).toBe(true);
    expect(OS["process.arch"].test("arch: process.arch")).toBe(true);
    expect(OS["platform aus node:os"].test('import { homedir, platform } from "node:os";')).toBe(true);
    for (const re of Object.values(OS)) expect(re.test('import { homedir } from "node:os"; hostPlatform(); x.platform()')).toBe(false);
  });
  it("host-platform.ts darf sie haben: die Suche findet dort process.arch (Gegenprobe zur Ausnahme)", () => {
    expect(codeLines(join(ROOT, HOST_PLATFORM)).some((z) => OS["process.arch"].test(z))).toBe(true);
  });
  it("in src/host (außer host-platform.ts) keine Vorgabe, kein optionales platform, kein Rückfall", () => {
    expect(treffer(VORGABEN)).toEqual([]);
  });
  it("os.platform(), platform() aus node:os und process.arch stehen nur in host-platform.ts", () => {
    expect(treffer(OS)).toEqual([]);
  });

  it("callArgs: verschachtelte Klammern, Zeichenketten mit , und ), Template-Strings", () => {
    expect(callArgs("f(a, g(b, (c, d)), [1, 2], { k: h(1, 2) })", "f")).toEqual([["a", "g(b, (c, d))", "[1, 2]", "{ k: h(1, 2) }"]]);
    expect(callArgs('f("a,b)", \'c)(\', d)', "f")).toEqual([['"a,b)"', "'c)('", "d"]]);
    expect(callArgs("f(`x,${g(1, `y)`)},z`, w)", "f")).toEqual([["`x,${g(1, `y)`)},z`", "w"]]);
  });
  it("callArgs: ein gleichnamiger Aufruf in einer Zeichenkette oder verschachtelt zählt nicht doppelt", () => {
    expect(callArgs('log("call log(x) here", 1)', "log")).toEqual([['"call log(x) here"', "1"]]);
  });
  it("callArgs: ein Aufruf als Argument desselben Namens wird nicht mitgezählt (der äußere gilt)", () => {
    expect(callArgs("f(a, f(b))", "f")).toEqual([["a", "f(b)"]]);
  });
  it("codeLines: Block- und Zeilenkommentare fallen weg, \"http://x\" ist keiner", () => {
    const z = codeLinesOf('a();\n/* process.platform\n   os.platform() */ b();\nc(); // process.arch\nconst u = "http://x"; d();');
    expect(z.join("\n")).not.toMatch(/process\.platform|os\.platform|process\.arch/);
    expect(z.join("\n")).toContain('const u = "http://x"; d();');
    expect(z.join("\n")).toContain("b();");
    expect(z).toHaveLength(5);
  });
});
