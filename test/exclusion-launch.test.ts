import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SessionRecord } from "../src/core/session-model";
import { Launcher } from "../src/host/launcher";

const START = { startKind: "new" as const, fresh: false, resumeConversations: true, fullscreen: false, effort: "aus" as const, skipPermissions: false };
const EXCLUSION = { settings: { permissions: { deny: ["Read(//V/Vertraulich/**)"] } }, notice: "Ausschluss aktiv: 1 Eintrag gesperrt, Shell-Befehle wie grep -r nicht (Sandbox aus)." };
const settingsOf = (args: string[]) => JSON.parse(args[args.indexOf("--settings") + 1]);

describe("Launcher mit Ausschluss (Abend 33)", () => {
  let dir: string;
  const saved = { PATH: process.env.PATH, SHELL: process.env.SHELL };
  const record: SessionRecord = { id: "33333333-3333-4333-8333-333333333333", name: "c", kind: "claude", cwd: "", createdAt: "2026-10-13T00:00:00.000Z" };
  const shell: SessionRecord = { id: "44444444-4444-4444-8444-444444444444", name: "Shell", kind: "shell", cwd: "/tmp", createdAt: "2026-10-13T00:00:00.000Z" };
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "exclusion-launch-"));
    writeFileSync(join(dir, "claude"), "#!/bin/sh\n");
    chmodSync(join(dir, "claude"), 0o755);
    process.env.PATH = `${dir}:${saved.PATH ?? ""}`;
    process.env.SHELL = "/bin/sh";
    record.cwd = dir; // Arbeitsordner außerhalb des Vault-Pfads /V (Review Focus)
  });
  afterAll(() => {
    process.env.PATH = saved.PATH;
    process.env.SHELL = saved.SHELL;
    rmSync(dir, { recursive: true, force: true });
  });

  it("ohne Ausschluss: --settings nur mit Hooks, keine Zeile", async () => {
    const plan = await new Launcher(() => undefined, () => null).plan(record, START);
    if (!plan.ok) throw new Error("Plan nicht ok");
    expect(Object.keys(settingsOf(plan.spawn.args))).toEqual(["hooks"]);
    expect(plan.notice).toBeNull();
  });
  it("mit Ausschluss: Regeln neben den Hooks, Zeile in der Pane, egal welcher Arbeitsordner", async () => {
    const plan = await new Launcher(() => undefined, () => null).plan(record, { ...START, exclusion: EXCLUSION });
    if (!plan.ok) throw new Error("Plan nicht ok");
    const s = settingsOf(plan.spawn.args);
    expect(s.permissions).toEqual({ deny: ["Read(//V/Vertraulich/**)"] });
    expect(s.hooks).toBeDefined();
    expect(plan.notice).toBe(EXCLUSION.notice);
  });
  it("Wiederherstellen: Zeile steht unter dem bisherigen Hinweis (Review Focus)", async () => {
    const plan = await new Launcher(() => undefined, () => null).plan(record, { ...START, startKind: "restore", exclusion: EXCLUSION });
    if (!plan.ok) throw new Error("Plan nicht ok");
    expect(plan.notice).toBe(`Keine gespeicherte Unterhaltung gefunden, Claude startet frisch.\n${EXCLUSION.notice}`);
    expect(settingsOf(plan.spawn.args).permissions).toBeDefined();
  });
  it("Shell-Tab: keine Regeln, keine Zeile", async () => {
    const plan = await new Launcher(() => undefined, () => null).plan(shell, { ...START, exclusion: EXCLUSION });
    if (!plan.ok) throw new Error("Plan nicht ok");
    expect(plan.spawn.args).not.toContain("--settings");
    expect(plan.notice).toBeNull();
  });
});
