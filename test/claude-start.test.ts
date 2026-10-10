import { describe, expect, it } from "vitest";
import { type StartInput, planClaudeStart } from "../src/core/claude-start";

const OLD = "11111111-2222-4333-8444-555555555555";
const NEW = "99999999-8888-4777-8666-555555555555";

function run(extra: Partial<StartInput> = {}) {
  let calls = 0;
  const plan = planClaudeStart({
    claudeId: OLD, transcriptExists: true, resumeConversations: true, fresh: false, startKind: "restore",
    newId: () => { calls++; return NEW; }, ...extra,
  });
  return { plan, calls };
}

describe("planClaudeStart", () => {
  it("Transkript da, Fortsetzen an, nicht frisch: --resume mit der alten ID, kein Hinweis, keine neue ID", () => {
    for (const startKind of ["restore", "restart", "new"] as const) {
      const { plan, calls } = run({ startKind });
      expect(plan).toEqual({ claudeId: OLD, resume: true, adoptId: null, notice: null });
      expect(calls).toBe(0);
    }
  });

  it("Transkript da, Fortsetzen aus: neue ID, --session-id, ID wird übernommen, Hinweis nennt die alte Kurz-ID", () => {
    const { plan, calls } = run({ resumeConversations: false });
    expect(plan.resume).toBe(false);
    expect(plan.claudeId).toBe(NEW);
    expect(plan.adoptId).toBe(NEW);
    expect(plan.notice).toBe("Neue Unterhaltung, die alte bleibt unter 11111111 erhalten.");
    expect(calls).toBe(1);
  });

  it("Transkript da, erzwungen frisch: neue ID, auch wenn Fortsetzen an ist", () => {
    const { plan } = run({ fresh: true, resumeConversations: true, startKind: "restart" });
    expect(plan).toEqual({
      claudeId: NEW, resume: false, adoptId: NEW, notice: "Neue Unterhaltung, die alte bleibt unter 11111111 erhalten.",
    });
  });

  it("Transkript fehlt: --session-id mit der vorhandenen ID, keine neue ID", () => {
    const { plan, calls } = run({ transcriptExists: false, startKind: "new" });
    expect(plan).toEqual({ claudeId: OLD, resume: false, adoptId: null, notice: null });
    expect(calls).toBe(0);
  });

  it("Transkript fehlt bei restore und restart: Hinweis, ID bleibt", () => {
    for (const startKind of ["restore", "restart"] as const) {
      const { plan } = run({ transcriptExists: false, startKind });
      expect(plan).toEqual({
        claudeId: OLD, resume: false, adoptId: null, notice: "Keine gespeicherte Unterhaltung gefunden, Claude startet frisch.",
      });
    }
  });

  it("Transkript fehlt: Fortsetzen aus oder frisch ändert nichts an der ID", () => {
    expect(run({ transcriptExists: false, resumeConversations: false }).plan.claudeId).toBe(OLD);
    expect(run({ transcriptExists: false, fresh: true }).plan.claudeId).toBe(OLD);
    expect(run({ transcriptExists: false, fresh: true }).calls).toBe(0);
  });
});
