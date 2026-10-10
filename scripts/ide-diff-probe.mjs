// Echte Probe von openDiff (Abend 17), ohne Obsidian: bündelt den Server aus src/ mit esbuild, startet ihn gegen das echte
// ~/.claude/ide und startet claude (`--model haiku`) in einer PTY in einem Temp-Ordner mit test.txt („alt“). Es wird EINE kurze
// Nachricht gesendet; der openDiff-Aufruf wird mitgeschnitten und je nach Modus beantwortet.
// Aufruf: node scripts/ide-diff-probe.mjs accept|accept-bare|reject   (nicht Teil des Plugin-Bundles)
//   accept        die Antwort des Plugins (openDiffResult): FILE_SAVED plus Inhalt; das Skript schreibt nichts
//   accept-bare   nur FILE_SAVED ohne Inhalt (zeigt: Claude fällt auf die Abfrage im Terminal zurück)
//   reject        DIFF_REJECTED
// Danach: claude beenden, Lockfile löschen, Zustand von ~/.claude/ide vorher und nachher zeigen.
import { build } from "esbuild";
import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const mode = process.argv[2] ?? "accept";
if (!["accept", "accept-bare", "reject"].includes(mode)) throw new Error("Modus: accept | accept-bare | reject");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), "ide-diff-probe-"));
const lockDir = join(homedir(), ".claude", "ide");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strip = (s) => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]/g, "");

await build({
  stdin: {
    contents: ['export * from "./src/host/ide-server";', 'export * from "./src/core/ide-protocol";', 'export * from "./src/core/ide-diff";', 'export * from "./src/core/claude-launch";'].join("\n"),
    resolveDir: root,
    loader: "ts",
  },
  outfile: join(tmp, "bundle.cjs"),
  bundle: true, format: "cjs", platform: "node", external: ["bufferutil", "utf-8-validate"], logLevel: "error",
});
const lib = require(join(tmp, "bundle.cjs"));
const ptyDir = join(tmp, "node-pty");
cpSync(join(root, "node_modules", "node-pty"), ptyDir, { recursive: true });
chmodSync(join(ptyDir, "prebuilds", "darwin-arm64", "spawn-helper"), 0o755);
const pty = require(ptyDir);

const lsBefore = existsSync(lockDir) ? readdirSync(lockDir) : [];
const work = join(tmp, "work");
mkdirSync(work);
const testFile = join(work, "test.txt");
writeFileSync(testFile, "alt\n");
const trace = [];
const calls = [];
const report = { mode, lsBefore };
let term = null;
let server = null;
let output = "";

try {
  const diff = {
    openDiff: async (args, clientId) => {
      calls.push({ at: Date.now(), tool: "openDiff", args, clientId });
      await sleep(1500);
      if (mode === "reject") return lib.openDiffResult("rejected", "");
      if (mode === "accept-bare") return { content: [{ type: "text", text: "FILE_SAVED" }] };
      return lib.openDiffResult("accepted", args.newFileContents);
    },
    closeTab: (tabName) => { calls.push({ at: Date.now(), tool: "close_tab", tabName }); return lib.closeTabResult(); },
    closeAllDiffTabs: () => { calls.push({ at: Date.now(), tool: "closeAllDiffTabs" }); return lib.closeAllResult(0); },
  };
  server = new lib.IdeServer({
    lockDir,
    workspaceFolders: () => [work],
    vaultBase: () => work,
    handlers: {
      getCurrentSelection: () => lib.jsonResult({ success: false, message: "No active editor found" }),
      getLatestSelection: () => lib.jsonResult({ success: false, message: "No selection available" }),
      getOpenEditors: () => lib.jsonResult({ tabs: [] }),
      getWorkspaceFolders: () => lib.jsonResult({ success: true, folders: [{ name: "work", uri: `file://${work}`, path: work }], rootPath: work }),
      openFile: () => lib.textResult("Opened"), checkDocumentDirty: () => lib.jsonResult({ success: true, isDirty: false }), saveDocument: () => lib.jsonResult({ success: true }),
      diff,
    },
    diffEnabled: () => true,
    pid: process.pid, isPidAlive: lib.pidAlive, newToken: () => randomBytes(16).toString("hex"),
    warn: (m) => trace.push(`WARN ${m}`),
    trace: (d, t) => { if (/"tools\/call"|"result"/.test(t) || /openDiff|close_tab|closeAllDiffTabs/.test(t)) trace.push(`${d === "in" ? "<<" : ">>"} ${t.slice(0, 1500)}`); },
  });
  const port = await server.start();
  report.port = port;

  const bin = execFileSync("/bin/zsh", ["-lc", "command -v claude"], { encoding: "utf8" }).trim();
  const env = lib.buildEnv(process.env, (process.env.PATH ?? "").split(":"), null, lib.ideEnv(port));
  const args = [...lib.buildArgs({ sessionId: randomUUID(), name: "ide-diff-probe", skipPermissions: false }), "--model", "haiku"];
  term = pty.spawn(bin, args, { name: "xterm-256color", cols: 140, rows: 50, cwd: work, env });
  term.onData((d) => (output += d));
  setTimeout(() => term.write("\x1b[B"), 4000); // Vertrauensabfrage: „No, exit“ ist vorausgewählt
  setTimeout(() => term.write("\r"), 4600);

  let deadline = Date.now() + 45000;
  while (Date.now() < deadline && !(server.clients().length > 0 && server.clients()[0].pid !== null)) await sleep(250);
  report.connected = server.clients().length > 0;
  await sleep(2000);
  // EINE kurze Nachricht.
  term.write(process.argv[3] ?? "Ersetze in test.txt das Wort alt durch neu.");
  await sleep(500);
  term.write("\r");
  report.sentAt = Date.now();

  deadline = Date.now() + 90000;
  while (Date.now() < deadline && calls.filter((c) => c.tool === "openDiff").length === 0) await sleep(250);
  report.openDiffArrived = calls.some((c) => c.tool === "openDiff");
  // Nach der Antwort: Claude Zeit geben (schreiben, antworten, evtl. close_tab).
  await sleep(15000);
  report.calls = calls.map((c) => ({ ...c, at: c.at - report.sentAt }));
  report.fileAfter = readFileSync(testFile, "utf8");
  report.trace = trace.filter((l) => !l.includes("authToken"));
  const lines = strip(output).split(/\r?\n|\r/).map((l) => l.trim()).filter(Boolean);
  report.paneTail = lines.slice(-30);
} catch (fehler) {
  report.error = String(fehler?.stack ?? fehler);
} finally {
  if (term) {
    try { process.kill(term.pid, "SIGHUP"); } catch {}
    await sleep(2000);
    try { process.kill(-term.pid, "SIGKILL"); } catch {}
    try { process.kill(term.pid, "SIGKILL"); } catch {}
  }
  if (server) await server.stop();
  await sleep(300);
  report.lsAfter = existsSync(lockDir) ? readdirSync(lockDir) : [];
  report.claudeStillRunning = term ? (() => { try { process.kill(term.pid, 0); return true; } catch { return false; } })() : false;
  rmSync(tmp, { recursive: true, force: true });
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.error ? 1 : 0);
}
