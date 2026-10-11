import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { asError } from "../src/core/as-error";
import { DEFAULT_SETTINGS } from "../src/core/settings";
import { SessionStore } from "../src/core/session-store";
import { FakeTimers } from "./helpers/fakes";
import { runGitDayLog, runGitIdentity, runGitStatus } from "../src/host/repo-status";

// Abend 26c: Promise-Ablehnungen sind immer Error (Lint prefer-promise-reject-errors).
describe("asError", () => {
  it("lässt einen Error unverändert", () => {
    const e = new Error("x");
    expect(asError(e)).toBe(e);
  });
  it("verpackt Nicht-Errors mit ihrem Text", () => {
    const r = asError("kaputt");
    expect(r).toBeInstanceOf(Error);
    expect(r.message).toBe("kaputt");
    expect(asError(42).message).toBe("42");
  });
});

describe("Ablehnungen sind Errors", () => {
  const env = { PATH: process.env.PATH ?? "" };
  const kein = join(mkdtempSync(join(tmpdir(), "asError-")), "nix");
  it("runGitStatus, runGitDayLog, runGitIdentity lehnen mit Error ab", async () => {
    for (const p of [runGitStatus(kein, env), runGitDayLog(kein, new Date(), env), runGitIdentity(kein, env)]) {
      const fehler = await p.then(() => null, (f: unknown) => f);
      expect(fehler).toBeInstanceOf(Error);
    }
  });
  it("SessionStore: wirft save synchron einen Text, bekommt onSaveError einen Error mit diesem Text", async () => {
    const seen: unknown[] = [];
    const save = (): Promise<void> => { throw "voll" as unknown as Error; };
    const store = new SessionStore({ schemaVersion: 1, sessions: [], settings: DEFAULT_SETTINGS, recentSkills: [], openAtUnload: [], dashboardAtUnload: null }, save, new FakeTimers(), 300, (f) => seen.push(f));
    store.add({ id: "a", name: "a", kind: "shell", cwd: "/", createdAt: 1 } as never);
    await store.flush();
    expect(seen[0]).toBeInstanceOf(Error);
    expect((seen[0] as Error).message).toBe("voll");
  });
});
