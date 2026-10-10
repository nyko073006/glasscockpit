// Echte Probe der IDE-Brücke ohne Obsidian (Abend 16): bündelt den Server aus src/ mit esbuild, startet ihn gegen das echte
// ~/.claude/ide und startet claude in einer PTY mit den Variablen der Brücke. Es wird KEINE Nachricht an Claude gesendet
// (keine Tokens). Danach: claude beenden, Lockfile löschen, Zustand von ~/.claude/ide vorher und nachher zeigen.
// Aufruf: node scripts/ide-probe.mjs   (nicht Teil des Plugin-Bundles)
import { build } from "esbuild";
import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), "ide-probe-"));
const lockDir = join(homedir(), ".claude", "ide");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strip = (s) => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]/g, "");

await build({
  stdin: {
    contents: ['export * from "./src/host/ide-server";', 'export * from "./src/core/ide-protocol";', 'export * from "./src/core/ide-clients";', 'export * from "./src/core/claude-launch";'].join("\n"),
    resolveDir: root,
    loader: "ts",
  },
  outfile: join(tmp, "bundle.cjs"),
  bundle: true, format: "cjs", platform: "node", external: ["bufferutil", "utf-8-validate"], logLevel: "error",
});
const lib = require(join(tmp, "bundle.cjs"));
// node-pty: spawn-helper in node_modules ist nicht ausführbar, deshalb eine Kopie.
const ptyDir = join(tmp, "node-pty");
cpSync(join(root, "node_modules", "node-pty"), ptyDir, { recursive: true });
chmodSync(join(ptyDir, "prebuilds", "darwin-arm64", "spawn-helper"), 0o755);
const pty = require(ptyDir);
const WebSocket = require(join(root, "node_modules", "ws"));

const lsBefore = existsSync(lockDir) ? readdirSync(lockDir) : [];
const work = join(tmp, "work");
mkdirSync(work);
writeFileSync(join(work, "probe.md"), "eins\nzwei\ndrei\nvier\n");
const trace = [];
const report = { lsBefore };
let term = null;
let server = null;
let output = "";

try {
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
    },
    pid: process.pid, isPidAlive: lib.pidAlive, newToken: () => randomBytes(16).toString("hex"),
    warn: (m) => trace.push(`WARN ${m}`),
    trace: (d, t) => trace.push(`${d === "in" ? "<<" : ">>"} ${t.length > 300 ? `${t.slice(0, 300)}…` : t}`),
  });
  const port = await server.start();
  report.port = port;
  const lockFile = join(lockDir, `${port}.lock`);
  const lock = JSON.parse(readFileSync(lockFile, "utf8"));
  report.lock = { ...lock, authToken: `${"*".repeat(8)} (${lock.authToken.length} Zeichen)` };
  report.lockMode = (statSync(lockFile).mode & 0o777).toString(8);

  const bin = execFileSync("/bin/zsh", ["-lc", "command -v claude"], { encoding: "utf8" }).trim();
  const env = lib.buildEnv(process.env, (process.env.PATH ?? "").split(":"), null, lib.ideEnv(port));
  term = pty.spawn(bin, lib.buildArgs({ sessionId: randomUUID(), name: "ide-probe", skipPermissions: false }), { name: "xterm-256color", cols: 120, rows: 40, cwd: work, env });
  term.onData((d) => (output += d));
  report.ptyPid = term.pid;
  setTimeout(() => term.write("\x1b[B"), 4000); // Vertrauensabfrage: „No, exit“ ist vorausgewählt
  setTimeout(() => term.write("\r"), 4600);

  const deadline = Date.now() + 45000;
  while (Date.now() < deadline && !(server.clients().length > 0 && server.clients()[0].pid !== null)) await sleep(250);
  report.connected = server.clients().length > 0;
  report.clients = server.clients();
  await sleep(1500);
  report.toolsListAnswered = trace.some((l) => l.startsWith("<<") && l.includes('"tools/list"')) && trace.some((l) => l.startsWith(">>") && l.includes('"tools":[{"name":"getCurrentSelection"'));
  report.initialize = trace.filter((l) => l.includes('"initialize"') || l.includes('"protocolVersion"')).map((l) => l.slice(0, 160));
  const parentOf = (pid) => { try { return Number(execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], { encoding: "utf8" }).trim()) || null; } catch { return null; } };
  const claudePid = report.clients[0]?.pid ?? null;
  report.pidEqualsPtyPid = claudePid === term.pid;
  report.claudeParentIsPty = claudePid !== null && parentOf(claudePid) === term.pid;
  report.mappedClient = lib.clientForSession(server.clients(), term.pid, parentOf);

  // getWorkspaceFolders über einen eigenen Client (Claude ruft ohne Nachricht kein Tool): zeigt den Weg durch den echten Server.
  const own = new WebSocket(`ws://127.0.0.1:${port}/`, ["mcp"], { headers: { "x-claude-code-ide-authorization": lock.authToken } });
  report.workspaceFolders = await new Promise((resolveCall, rejectCall) => {
    own.on("open", () => own.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "getWorkspaceFolders", arguments: {} } })));
    own.on("message", (d) => resolveCall(JSON.parse(d.toString()).result.content[0].text));
    own.on("error", rejectCall);
    setTimeout(() => rejectCall(new Error("keine Antwort")), 5000);
  });
  own.close();

  // at_mentioned an die Verbindung der Sitzung: Zeilenbasis an der Eingabezeile ablesen.
  const mapped = report.mappedClient;
  const before = output.length;
  report.atMentionSent = mapped ? server.send(mapped.id, "at_mentioned", lib.atMentionParams(join(work, "probe.md"), 1, 2)) : false;
  server.send(mapped?.id ?? -1, "selection_changed", lib.selectionParams({ filePath: join(work, "probe.md"), text: "zwei\ndrei", start: { line: 1, character: 0 }, end: { line: 2, character: 4 } }));
  await sleep(2000);
  const text = strip(output.slice(before));
  report.paneAfterMention = text.split(/\r?\n|\r/).map((l) => l.trim()).filter((l) => /@|selected|probe\.md|lines? /.test(l)).slice(0, 8);
  report.traceTail = trace.slice(-6).filter((l) => !l.includes("authToken"));
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
