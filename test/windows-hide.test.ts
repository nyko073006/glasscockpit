import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT, listFilesRecursive, relativeToRoot } from "./helpers/files";

// Wächter (Abend 42, Task 6, ersetzt den Git-Block aus Abend 41): Obsidian ist ein GUI-Prozess. Ohne windowsHide: true öffnet Windows für
// jeden Kindprozess ein Konsolenfenster. Jeder execFile-, execFileSync-, spawn-, spawnSync-, exec-, execSync-, fork- und promisify-Aufruf in src/host trägt es in seiner
// Argumentliste (promisify(execFile) trägt es nie und fällt damit auf: es ließe sich nicht prüfen). pty.spawn (node-pty) ist kein Kindprozess dieser Art und zählt nicht, ebenso wenig jeder Aufruf mit Punkt davor.

/** Kommentare und Zeichenketten durch Leerzeichen ersetzen (gleiche Länge), damit Treffer nur im Code stehen. */
function blank(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") (out += " "), i++;
    } else if (c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else if (c === '"' || c === "'" || c === "`") {
      out += c;
      i++;
      while (i < text.length && text[i] !== c) {
        if (text[i] === "\\") (out += " "), i++;
        out += text[i] === "\n" ? "\n" : " ";
        i++;
      }
      out += c;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

interface Call { name: string; args: string }

/** Alle Prozessaufrufe im Code: Name und Argumentliste. Methodendefinitionen (Klammer, dann { oder :) und Aufrufe mit Punkt davor zählen nicht. */
function processCalls(source: string): Call[] {
  const code = blank(source);
  const calls: Call[] = [];
  for (const m of code.matchAll(/(?<![.\w$])((?:util\.)?promisify|execFileSync|execFile|spawnSync|spawn|execSync|exec|fork)\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let end = open;
    for (; end < code.length; end++) {
      if (code[end] === "(") depth++;
      else if (code[end] === ")" && --depth === 0) break;
    }
    // Definition: `) {` oder `): Rückgabetyp {`. Folgt ein Doppelpunkt, dann aber ein weiterer Aufruf (Ternary), ist es ein Aufruf.
    if (/^\s*(\{|:\s*[^;(){}=]*\{)/.test(code.slice(end + 1))) continue;
    calls.push({ name: m[1], args: source.slice(open + 1, end) });
  }
  return calls;
}

/** Hat die Argumentliste windowsHide: true (im Code, nicht in einem Kommentar)? */
const hidesWindow = (call: Call): boolean => /\bwindowsHide\s*:\s*true\b/.test(blank(call.args));

const hostFiles = () => listFilesRecursive(join(ROOT, "src", "host")).filter((f) => f.endsWith(".ts"));
const callsByFile = (): Map<string, Call[]> =>
  new Map(hostFiles().map((f) => [relativeToRoot(f), processCalls(readFileSync(f, "utf8"))] as const).filter(([, calls]) => calls.length > 0));

describe("windowsHide an jedem Prozessaufruf in src/host (Abend 42)", () => {
  it("Positivprobe: die Suche findet genau die heute gezählten Aufrufe (Abend 44: 12 in 10 Dateien, Abend 43 waren es 11 in 9 am Stand 70b2df8)", () => {
    const erwartet: Record<string, number> = {
      "src/host/git-pull.ts": 1,
      "src/host/native-download.ts": 1,
      "src/host/win-kill.ts": 1,
      "src/host/repo-status.ts": 3,
      "src/host/ide-bridge.ts": 1,
      "src/host/idle-time.ts": 1,
      "src/host/attention-alert.ts": 1,
      "src/host/login-shell.ts": 1,
      "src/host/native-loader.ts": 1,
      "src/host/reminders.ts": 1,
    };
    const gefunden = new Map([...callsByFile()].map(([datei, calls]) => [datei, calls.length] as const));
    expect(Object.fromEntries([...gefunden].sort())).toEqual(Object.fromEntries(Object.entries(erwartet).sort()));
    expect([...gefunden.values()].reduce((n, anzahl) => n + anzahl, 0)).toBe(12);
  });
  it("jede Datei in src/host mit Import aus child_process hat Fundstellen, und jede Datei mit Fundstellen importiert es", () => {
    const IMPORT = /(?:from\s*|require\s*\(\s*)["'](?:node:)?child_process["']/;
    const ohneKommentarzeilen = (f: string) => readFileSync(f, "utf8").split("\n").filter((z) => !/^\s*(\/\/|\*|\/\*)/.test(z)).join("\n");
    const importieren = hostFiles().filter((f) => IMPORT.test(ohneKommentarzeilen(f))).map(relativeToRoot).sort();
    expect(importieren.length).toBeGreaterThan(0); // Positivprobe: die Import-Suche findet etwas
    expect(importieren).toEqual([...callsByFile().keys()].sort());
  });

  it("Gegenfall der Import-Suche: erkennt import und require, ignoriert Kommentarzeilen", () => {
    const IMPORT = /(?:from\s*|require\s*\(\s*)["'](?:node:)?child_process["']/;
    expect(IMPORT.test('import { exec } from "child_process";')).toBe(true);
    expect(IMPORT.test('const cp = require("node:child_process");')).toBe(true);
    expect(IMPORT.test('import { join } from "node:path";')).toBe(false);
  });
  it("pty.spawn und node-pty zählen nicht", () => {
    const dateien = [...callsByFile().keys()];
    expect(dateien).not.toContain("src/host/pty-factory.ts");
    expect(dateien).not.toContain("src/host/terminal-view.ts");
  });
  it("jeder Aufruf trägt windowsHide: true", () => {
    const ohne: string[] = [];
    for (const [datei, calls] of callsByFile()) for (const call of calls) if (!hidesWindow(call)) ohne.push(`${datei}: ${call.name}(${call.args.trim().slice(0, 60)}…`);
    expect(ohne).toEqual([]);
  });

  // Gegenfälle: Der Wächter muss im Test selbst fallen können.
  describe("Gegenfälle der Suche", () => {
    const hides = (src: string) => processCalls(src).map(hidesWindow);
    it("ein Aufruf ohne windowsHide wird erkannt", () => {
      expect(hides('execFile("git", ["status"], { cwd: dir }, cb);')).toEqual([false]);
      expect(hides('const c = spawn(shell, ["-c", "x"], { stdio: "ignore" });')).toEqual([false]);
      expect(hides('execFileSync("ps", ["-o", "ppid="], { encoding: "utf8" });')).toEqual([false]);
      expect(hides('spawnSync("x", []);')).toEqual([false]);
    });
    it("windowsHide: false oder nur im Kommentar oder in einer Zeichenkette zählt nicht", () => {
      expect(hides('execFile("a", [], { windowsHide: false }, cb);')).toEqual([false]);
      expect(hides('execFile("a", [], { /* windowsHide: true */ }, cb);')).toEqual([false]);
      expect(hides('execFile("a", ["windowsHide: true"], {}, cb);')).toEqual([false]);
    });
    it("mit windowsHide: true, auch über mehrere Zeilen und mit Klammern in Zeichenketten, ist der Aufruf in Ordnung", () => {
      expect(hides('execFile("a", [], { windowsHide: true }, cb);')).toEqual([true]);
      expect(hides('execFile(\n  "git",\n  ["log", "--format=(x)"],\n  { cwd: dir, windowsHide: true },\n  (err) => done(),\n);')).toEqual([true]);
    });
    it("pty.spawn, manager.spawn, Methodendefinitionen und Kommentare zählen nicht", () => {
      expect(processCalls("this.pty.spawn(spec.file, spec.args, {});")).toEqual([]);
      expect(processCalls("const s = manager.spawn({ id });")).toEqual([]);
      expect(processCalls("class A { spawn(spec: Spec): Result { return 1; } }")).toEqual([]);
      expect(processCalls("// execFile(x)\n/* spawn(y) */ const t = 'execFile(z)';")).toEqual([]);
    });
    it("exec, execSync, fork und promisify werden mitgezählt; promisify(execFile) fällt auf", () => {
      expect(processCalls('exec("ls", cb);')).toHaveLength(1);
      expect(hides('execSync("ls", { windowsHide: true });')).toEqual([true]);
      expect(hides('const p = fork("child.js");')).toEqual([false]);
      expect(hides("const run = promisify(execFile);")).toEqual([false]);
      expect(hides("const run = util.promisify(execFile);")).toEqual([false]);
      expect(processCalls("re.exec(text); const x = doexec(1); /a/.exec(s)")).toEqual([]);
    });
    it("Ternary: beide Aufrufe zählen, Methodendefinitionen mit Rückgabetyp nicht", () => {
      expect(hides('const c = win ? spawn("cmd", ["/c"], { windowsHide: true }) : spawn("sh", ["-c"], {});')).toEqual([true, false]);
      expect(processCalls('const c = win ? spawn("a", [], {}) : null;')).toHaveLength(1);
      expect(processCalls("class A { spawn(spec: Spec): Promise<{ ok: boolean }> { return x; } }")).toEqual([]);
      expect(processCalls("class A { spawn(spec: Spec): Result { return 1; } }")).toEqual([]);
    });
    it("zwei Aufrufe in einer Datei werden einzeln geprüft", () => {
      expect(hides('execFile("a", [], { windowsHide: true }, cb); execFile("b", [], {}, cb);')).toEqual([true, false]);
    });
  });
});
