import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildEnv } from "../src/core/claude-launch";
import { ideEnv } from "../src/core/ide-protocol";
import type { SessionRecord } from "../src/core/session-model";
import { Launcher } from "../src/host/launcher";

const START = { startKind: "new" as const, fresh: false, resumeConversations: true, fullscreen: false, effort: "aus" as const, skipPermissions: false };
const shellRecord: SessionRecord = { id: "11111111-1111-4111-8111-111111111111", name: "Shell", kind: "shell", cwd: "/tmp", createdAt: "2026-10-05T00:00:00.000Z" };

// Läuft die Suite aus einer Cockpit-Sitzung, erbt process.env die IDE-Variablen dieser Sitzung; der Launcher reicht process.env weiter.
const IDE_VARS = ["ENABLE_IDE_INTEGRATION", "CLAUDE_CODE_SSE_PORT"] as const;
const inherited = Object.fromEntries(IDE_VARS.map((k) => [k, process.env[k]]));
beforeAll(() => {
  for (const k of IDE_VARS) delete process.env[k];
});
afterAll(() => {
  for (const k of IDE_VARS) if (inherited[k] !== undefined) process.env[k] = inherited[k];
});

describe("buildEnv mit IDE-Brücke", () => {
  it("ohne Zusatz keine IDE-Variablen", () => {
    const env = buildEnv({ HOME: "/h" }, ["/a"], null);
    expect("ENABLE_IDE_INTEGRATION" in env).toBe(false);
    expect("CLAUDE_CODE_SSE_PORT" in env).toBe(false);
  });
  it("mit Zusatz: ENABLE_IDE_INTEGRATION und CLAUDE_CODE_SSE_PORT, der Rest bleibt", () => {
    const env = buildEnv({ HOME: "/h" }, ["/a"], null, ideEnv(51234));
    expect(env.ENABLE_IDE_INTEGRATION).toBe("true");
    expect(env.CLAUDE_CODE_SSE_PORT).toBe("51234");
    expect(env.HOME).toBe("/h");
    expect(env.TERM).toBe("xterm-256color");
  });
  it("der Zusatz überschreibt eine geerbte Port-Variable", () => {
    expect(buildEnv({ CLAUDE_CODE_SSE_PORT: "1" }, [], null, ideEnv(2)).CLAUDE_CODE_SSE_PORT).toBe("2");
  });
});

describe("Launcher: Shell bekommt nie IDE-Variablen", () => {
  it("auch dann nicht, wenn die Brücke läuft", async () => {
    const launcher = new Launcher(() => undefined, () => ideEnv(51234));
    const plan = await launcher.plan(shellRecord, START);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.spawn.env.ENABLE_IDE_INTEGRATION).not.toBe("true");
    expect(plan.spawn.env.CLAUDE_CODE_SSE_PORT).not.toBe("51234");
    expect("CLAUDE_CODE_SSE_PORT" in plan.spawn.env).toBe(false);
  });
  it("auch eine Shell-Sitzung mit async ideEnv wird nicht danach gefragt", async () => {
    let asked = 0;
    const launcher = new Launcher(() => undefined, async () => { asked++; return ideEnv(1); });
    await launcher.plan(shellRecord, START);
    expect(asked).toBe(0);
  });
});

describe("Launcher: Claude-Start wartet auf die Brücke, aber nicht ewig", () => {
  let dir: string;
  const saved = { PATH: process.env.PATH, SHELL: process.env.SHELL };
  const record: SessionRecord = { id: "22222222-2222-4222-8222-222222222222", name: "c", kind: "claude", cwd: "", createdAt: "2026-10-05T00:00:00.000Z" };
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "ide-launch-"));
    writeFileSync(join(dir, "claude"), "#!/bin/sh\n");
    chmodSync(join(dir, "claude"), 0o755);
    process.env.PATH = `${dir}:${saved.PATH ?? ""}`;
    process.env.SHELL = "/bin/sh";
    record.cwd = dir;
  });
  afterAll(() => {
    process.env.PATH = saved.PATH;
    process.env.SHELL = saved.SHELL;
    rmSync(dir, { recursive: true, force: true });
  });

  it("ideEnv löst erst später auf: die Startumgebung enthält danach CLAUDE_CODE_SSE_PORT", async () => {
    const launcher = new Launcher(() => undefined, () => new Promise((r) => setTimeout(() => r(ideEnv(5555)), 150)), 5000);
    const plan = await launcher.plan(record, START);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.spawn.env.CLAUDE_CODE_SSE_PORT).toBe("5555");
    expect(plan.spawn.env.ENABLE_IDE_INTEGRATION).toBe("true");
  });
  it("skipPermissions im Start (Abend 20): an gibt das Rechte-Flag, aus nicht", async () => {
    const launcher = new Launcher(() => undefined, () => null);
    const an = await launcher.plan(record, { ...START, skipPermissions: true });
    const aus = await launcher.plan(record, { ...START, skipPermissions: false });
    if (!an.ok || !aus.ok) throw new Error("Plan nicht ok");
    expect(an.spawn.args).toContain("--dangerously-skip-permissions");
    expect(aus.spawn.args).not.toContain("--dangerously-skip-permissions");
  });
  it("ideEnv hängt: nach dem Zeitlimit startet die Sitzung ohne Variablen, statt zu hängen", async () => {
    const launcher = new Launcher(() => undefined, () => new Promise(() => undefined), 100);
    const t0 = Date.now();
    const plan = await launcher.plan(record, START);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect("CLAUDE_CODE_SSE_PORT" in plan.spawn.env).toBe(false);
  });
  it("ideEnv wirft: Sitzung startet trotzdem ohne Variablen", async () => {
    const launcher = new Launcher(() => undefined, () => Promise.reject(new Error("kaputt")), 100);
    const plan = await launcher.plan(record, START);
    expect(plan.ok).toBe(true);
    if (plan.ok) expect("CLAUDE_CODE_SSE_PORT" in plan.spawn.env).toBe(false);
  });
});
