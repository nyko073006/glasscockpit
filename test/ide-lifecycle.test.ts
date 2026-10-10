// Start und Stopp der Brücke nach der Einstellung ideBridge: echter Server, Lockfile in einem Temp-Ordner.
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IdeLifecycle } from "../src/host/ide-lifecycle";
import { IdeServer, pidAlive } from "../src/host/ide-server";

let dir: string;
let enabled: boolean;
let created: IdeServer[];
let life: IdeLifecycle;

const listening = (port: number) =>
  new Promise<boolean>((resolve) => {
    const s = connect({ host: "127.0.0.1", port });
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => resolve(false));
  });

function make(): IdeLifecycle {
  return new IdeLifecycle({
    enabled: () => enabled,
    create: () => {
      const server = new IdeServer({
        lockDir: dir, workspaceFolders: () => ["/v"], vaultBase: () => "/v",
        handlers: {} as never, pid: process.pid, isPidAlive: pidAlive, newToken: () => "ab".repeat(16), warn: () => undefined,
      });
      created.push(server);
      return server;
    },
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ide-life-"));
  created = [];
  enabled = false;
  life = make();
});
afterEach(async () => {
  await life.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe("IdeLifecycle", () => {
  it("aus: kein Server, kein Lockfile, keine Variablen", async () => {
    await life.sync();
    expect(created).toHaveLength(0);
    expect(life.server).toBeNull();
    expect(readdirSync(dir)).toEqual([]);
    expect(life.env()).toBeNull();
  });
  it("an: Lockfile da, env mit Port, Port lauscht", async () => {
    enabled = true;
    await life.sync();
    const port = life.server?.port;
    expect(port).toBeGreaterThan(0);
    expect(existsSync(join(dir, `${port}.lock`))).toBe(true);
    expect(life.env()).toEqual({ ENABLE_IDE_INTEGRATION: "true", CLAUDE_CODE_SSE_PORT: String(port) });
    expect(await listening(port as number)).toBe(true);
  });
  it("wieder aus: Lockfile weg, Server zu, env leer", async () => {
    enabled = true;
    await life.sync();
    const port = life.server?.port as number;
    enabled = false;
    await life.sync();
    expect(life.server).toBeNull();
    expect(readdirSync(dir)).toEqual([]);
    expect(life.env()).toBeNull();
    expect(await listening(port)).toBe(false);
  });
  it("env ist leer, sobald die Einstellung aus ist, auch bevor sync lief", async () => {
    enabled = true;
    await life.sync();
    enabled = false;
    expect(life.env()).toBeNull();
  });
  it("mehrfaches Umschalten und gleichzeitige sync-Aufrufe: nie mehr als ein Server lauscht, am Ende nichts offen", async () => {
    const ports: number[] = [];
    for (let i = 0; i < 4; i++) {
      enabled = true;
      void life.sync();
      void life.sync();
      await life.sync();
      ports.push(life.server?.port as number);
      expect(readdirSync(dir)).toHaveLength(1);
      enabled = false;
      await life.sync();
      expect(readdirSync(dir)).toHaveLength(0);
    }
    expect(created).toHaveLength(4);
    for (const p of ports) expect(await listening(p)).toBe(false);
  });
  it("stop während des Starts lässt keinen Server stehen", async () => {
    enabled = true;
    const sync = life.sync();
    const stop = life.stop();
    await Promise.all([sync, stop]);
    expect(readdirSync(dir)).toEqual([]);
    expect(life.server).toBeNull();
  });
  it("ready wartet auf den laufenden Start", async () => {
    enabled = true;
    void life.sync();
    await life.ready();
    expect(life.env()).not.toBeNull();
  });
  it("Start schlägt fehl: kein Server, env leer, kein Fehler nach außen", async () => {
    enabled = true;
    const bad = new IdeLifecycle({ enabled: () => true, create: () => ({ port: null, start: async () => null, stop: async () => undefined }) });
    await bad.sync();
    expect(bad.server).toBeNull();
    expect(bad.env()).toBeNull();
  });
});
