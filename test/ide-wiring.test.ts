import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXTERNAL } from "../scripts/lib/externals.ts";
import { listFilesRecursive, relativeToRoot, ROOT } from "./helpers/files";

// Wächter der IDE-Brücke (Abend 16): Netz nur an einer Stelle, nur lokal, kein Token im Log, Shell ohne Variablen.
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const srcFiles = () => listFilesRecursive(join(ROOT, "src")).filter((f) => /\.ts$/.test(f));
const NETZ_IMPORT = /(?:from|import|require)\s*\(?\s*["'](?:ws|node:https?|https?|node:net|net|node:dgram|dgram|node:tls|tls)["']/;

describe("Netz nur im IDE-Server", () => {
  it("das Muster trifft ws, node:http und node:net", () => {
    for (const zeile of ['import WebSocket from "ws";', 'import { createServer } from "node:http";', 'const w = require("ws");', 'import type { AddressInfo } from "node:net";']) {
      expect(zeile).toMatch(NETZ_IMPORT);
    }
    expect('import { x } from "./ws-helper";').not.toMatch(NETZ_IMPORT);
  });
  it("ws, node:http und node:net werden in src/ nur von src/host/ide-server.ts importiert", () => {
    const treffer = srcFiles().filter((f) => NETZ_IMPORT.test(readFileSync(f, "utf8"))).map(relativeToRoot);
    expect(treffer).toEqual(["src/host/ide-server.ts"]);
  });
  it("die Kerndateien der Brücke importieren nichts außer eigenen Modulen", () => {
    for (const f of ["src/core/ide-protocol.ts", "src/core/ide-clients.ts"]) {
      const imports = [...read(f).matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]);
      expect(imports.filter((i) => !i.startsWith("./"))).toEqual([]);
    }
  });
});

describe("Server bindet nur 127.0.0.1", () => {
  const src = read("src/host/ide-server.ts");
  it("jedes listen( nennt host: \"127.0.0.1\", Port 0", () => {
    const listens = [...src.matchAll(/\.listen\(([^)]*)\)/g)].map((m) => m[1]);
    expect(listens.length).toBe(1);
    for (const l of listens) {
      expect(l).toMatch(/host:\s*"127\.0\.0\.1"/);
      expect(l).toMatch(/port:\s*0\b/);
    }
  });
  it("keine Wildcard-Adresse, kein localhost, kein WebSocketServer mit eigenem Port", () => {
    expect(src).not.toMatch(/0\.0\.0\.0|"::"|localhost/);
    expect(src).not.toMatch(/new WebSocketServer\(\{[^}]*\b(port|host)\b/);
    expect(src).toMatch(/noServer:\s*true/);
  });
});

describe("Token nie im Log", () => {
  const ide = srcFiles().filter((f) => /\/ide-[^/]*\.ts$/.test(f));
  it("es gibt IDE-Dateien in core und host", () => {
    expect(ide.map(relativeToRoot)).toEqual([
      "src/core/ide-clients.ts", "src/core/ide-diff.ts", "src/core/ide-protocol.ts", "src/host/ide-bridge.ts", "src/host/ide-diff-fs.ts", "src/host/ide-diff.ts",
      "src/host/ide-editor.ts", "src/host/ide-lifecycle.ts", "src/host/ide-server.ts",
    ]);
  });
  it("kein console-Aufruf und kein warn( nennt token", () => {
    for (const f of ide) {
      const zeilen = readFileSync(f, "utf8").split("\n");
      const verdaechtig = zeilen.filter((z) => /console\.|\bwarn\(|\btrace\?*\.?\(/.test(z) && /token/i.test(z));
      expect({ datei: relativeToRoot(f), verdaechtig }).toEqual({ datei: relativeToRoot(f), verdaechtig: [] });
    }
  });
  it("kein Template-String bindet eine Token-Variable ein", () => {
    for (const f of ide) expect(readFileSync(f, "utf8")).not.toMatch(/\$\{[^}]*token/i);
  });
  it("im Server steht der Token nur an den drei erlaubten Stellen", () => {
    const zeilen = read("src/host/ide-server.ts").split("\n").filter((z) => /\btoken\b/i.test(z) && !/^\s*(\/\/|\*|\/\*)/.test(z));
    const erlaubt = [/private token = ""/, /this\.token = /, /authorized\(req\.headers\[IDE_AUTH_HEADER\], this\.token\)/, /authToken: this\.token/, /newToken/];
    const fremd = zeilen.filter((z) => !erlaubt.some((e) => e.test(z)) && !/\/\*\*/.test(z));
    expect(fremd).toEqual([]);
  });
});

describe("Lockfile atomar", () => {
  const src = read("src/host/ide-server.ts");
  it("temporäre Datei mit Modus 0600, dann rename; nie writeFileSync auf das Ziel", () => {
    expect(src).toMatch(/openSync\(temp, "wx", 0o600\)/);
    expect(src).toMatch(/renameSync\(temp, target\)/);
    expect(src).not.toMatch(/writeFileSync/);
  });
  it("stop löscht das Lockfile vor dem ersten await", () => {
    const stop = src.slice(src.indexOf("async stop()"));
    expect(stop.indexOf("unlinkSync(this.lockPath)")).toBeGreaterThan(-1);
    expect(stop.indexOf("unlinkSync(this.lockPath)")).toBeLessThan(stop.indexOf("await "));
  });
});

describe("Shell bekommt keine Variablen, Claude nur bei laufender Brücke", () => {
  const launcher = read("src/host/launcher.ts");
  const shellZweig = launcher.slice(launcher.indexOf('record.kind === "shell"'), launcher.indexOf("isDirectory(record.cwd)"));
  it("der Shell-Zweig im Launcher kennt weder ideEnv noch die Variablen", () => {
    expect(shellZweig.length).toBeGreaterThan(50);
    expect(shellZweig).not.toMatch(/ideEnv|ENABLE_IDE_INTEGRATION|CLAUDE_CODE_SSE_PORT/);
  });
  it("der Claude-Zweig reicht ideEnv() an buildEnv, und die Variablennamen stehen nur in ide-protocol.ts", () => {
    expect(launcher).toMatch(/const ide = await this\.ideEnvWithin\(\);/);
    expect(launcher).toMatch(/buildEnv\(process\.env, env\.dirs, env\.lang, ide \?\? undefined, start\.fullscreen\)/);
    const hits = srcFiles().filter((f) => /ENABLE_IDE_INTEGRATION|CLAUDE_CODE_SSE_PORT/.test(readFileSync(f, "utf8"))).map(relativeToRoot);
    expect(hits).toEqual(["src/core/ide-protocol.ts"]);
  });
  it("Eingabezeile fest: main reicht fixedPrompt als fullscreen an den Launcher (Abend 19f)", () => {
    expect(read("src/main.ts")).toMatch(/fullscreen: store\.settings\(\)\.fixedPrompt/);
  });
  it("Rechte überspringen: main liest skipPermissions beim Start aus den Einstellungen, der Launcher reicht es an buildArgs (Abend 20)", () => {
    expect(read("src/main.ts")).toMatch(/skipPermissions: store\.settings\(\)\.skipPermissions/);
    expect(read("src/host/launcher.ts")).toMatch(/skipPermissions: start\.skipPermissions/);
    expect(read("src/core/claude-launch.ts")).not.toMatch(/SKIP_PERMISSIONS/);
  });
  it("ideEnv der Brücke liefert nur bei eingeschalteter Einstellung und laufendem Server etwas", () => {
    const life = read("src/host/ide-lifecycle.ts");
    expect(life).toMatch(/this\.deps\.enabled\(\) \? this\.current\?\.port : null/);
    expect(life).toMatch(/return port \? ideEnv\(port\) : null;/);
    expect(read("src/host/ide-bridge.ts")).toMatch(/enabled: \(\) => deps\.settings\(\)\.ideBridge/);
  });
});

describe("Verkabelung in main.ts", () => {
  const main = read("src/main.ts");
  it("der Befehl hat die ID mention-selection und den Namen „Auswahl an Claude erwähnen“", () => {
    expect(main).toMatch(/id:\s*"mention-selection",\s*name:\s*"Auswahl an Claude erwähnen"/);
  });
  it("das Ziel ist die jüngste Terminal-Sitzung über sendTarget, nie getActiveViewOfType", () => {
    const start = main.indexOf("private mentionSelection()");
    const body = main.slice(start, main.indexOf("\n  }\n", start));
    expect(body).toMatch(/this\.sendTarget\(\)/);
    expect(body).not.toMatch(/getActiveViewOfType/);
  });
  it("onunload stoppt die Brücke vor allem anderen", () => {
    const on = main.slice(main.indexOf("onunload(): void {"));
    expect(on.indexOf("this.ide?.stop()")).toBeGreaterThan(-1);
    expect(on.indexOf("this.ide?.stop()")).toBeLessThan(on.indexOf("this.tracker?.dispose()"));
  });
  it("die Einstellung wird bei jeder Änderung neu angewandt", () => {
    expect(main).toMatch(/store\.onSettingsChange\(\(\) => void ide\.sync\(\)\)/);
  });
});

describe("Paket und Bündel", () => {
  const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
  it("ws und @types/ws mit exakter Version", () => {
    expect(pkg.dependencies.ws).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.devDependencies["@types/ws"]).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it("esbuild lässt bufferutil und utf-8-validate draußen", () => {
    // Die Liste steht seit Abend 32 in scripts/lib/externals.ts; dass esbuild.config.mjs sie nimmt, prüft test/build-externals.test.ts.
    expect(EXTERNAL).toContain("bufferutil");
    expect(EXTERNAL).toContain("utf-8-validate");
  });
});
