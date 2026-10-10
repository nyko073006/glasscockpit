import { describe, expect, it } from "vitest";
import { PullState, errorText, formatPullStatus, pullDue, pullResultFromExec, type PullSnapshot } from "../src/core/pull-state";

const time = (ms: number) => `T${ms}`;
const fmt = (s: PullSnapshot) => formatPullStatus(s, time);

describe("PullState", () => {
  it("startet idle", () => {
    expect(new PullState().snapshot()).toEqual({ status: "idle", at: null, error: null });
  });
  it("kein zweiter Start, solange einer läuft", () => {
    const p = new PullState();
    expect(p.tryStart(1)).toBe(true);
    expect(p.snapshot().status).toBe("running");
    expect(p.tryStart(2)).toBe(false);
    expect(p.snapshot().at).toBe(1);
    p.finish({ ok: true }, 3);
    expect(p.tryStart(4)).toBe(true);
  });
  it("ok setzt Zustand und Zeit", () => {
    const p = new PullState();
    p.tryStart(1);
    p.finish({ ok: true }, 5);
    expect(p.snapshot()).toEqual({ status: "ok", at: 5, error: null });
  });
  it("ein Fehler lässt ein früheres ok nicht stehen", () => {
    const p = new PullState();
    p.tryStart(1); p.finish({ ok: true }, 2);
    p.tryStart(3); p.finish({ ok: false, stderr: "fatal: weg\nmehr" }, 4);
    expect(p.snapshot()).toEqual({ status: "error", at: 4, error: "fatal: weg" });
    expect(fmt(p.snapshot()).text).not.toContain("ok");
  });
  it("ein neues ok ersetzt den Fehler", () => {
    const p = new PullState();
    p.tryStart(1); p.finish({ ok: false, stderr: "x" }, 2);
    p.tryStart(3); p.finish({ ok: true }, 4);
    expect(p.snapshot()).toEqual({ status: "ok", at: 4, error: null });
  });
  it("no-repo", () => {
    const p = new PullState();
    p.setNoRepo(7);
    expect(p.snapshot()).toEqual({ status: "no-repo", at: 7, error: null });
    expect(p.tryStart(8)).toBe(true);
  });
  it("Abonnenten bei jeder Änderung, Abmelden wirkt", () => {
    const p = new PullState();
    const seen: string[] = [];
    const off = p.subscribe((s) => seen.push(s.status));
    p.tryStart(1); p.finish({ ok: true }, 2); p.setNoRepo(3);
    expect(seen).toEqual(["running", "ok", "no-repo"]);
    off();
    p.tryStart(4);
    expect(seen).toHaveLength(3);
  });
});

describe("errorText", () => {
  it("erste nicht-leere Zeile von stderr, getrimmt", () => {
    expect(errorText({ ok: false, stderr: "\n  \n  fatal: nicht möglich  \nzweite" })).toBe("fatal: nicht möglich");
  });
  it("überspringt hint:-Zeilen (auseinandergelaufene Stände bei --ff-only)", () => {
    const stderr = "hint: Diverging branches can't be fast-forwarded, you need to either:\nhint:\nhint:   git merge --no-ff\nfatal: Not possible to fast-forward, aborting.\n";
    expect(errorText({ ok: false, stderr })).toBe("fatal: Not possible to fast-forward, aborting.");
  });
  it("nur hint:-Zeilen: dann doch die erste", () => {
    expect(errorText({ ok: false, stderr: "hint: allein\n" })).toBe("hint: allein");
  });
  it("Timeout", () => {
    expect(errorText({ ok: false, stderr: "egal", timedOut: true })).toBe("Zeitüberschreitung nach 30 s");
  });
  it("git fehlt", () => {
    expect(errorText({ ok: false, stderr: "spawn git ENOENT", notFound: true })).toBe("git nicht gefunden");
  });
  it("leeres stderr nennt den Code", () => {
    expect(errorText({ ok: false, stderr: "  \n", code: 128 })).toBe("git endete mit Code 128");
    expect(errorText({ ok: false, stderr: "", code: 1 })).toBe("git endete mit Code 1");
  });
});

describe("formatPullStatus", () => {
  it("alle Zustände", () => {
    expect(fmt({ status: "idle", at: null, error: null })).toEqual({ text: "noch nicht gepullt", error: false });
    expect(fmt({ status: "running", at: 1, error: null })).toEqual({ text: "pullt …", error: false });
    expect(fmt({ status: "ok", at: 9, error: null })).toEqual({ text: "zuletzt gepullt T9, ok", error: false });
    expect(fmt({ status: "error", at: 9, error: "fatal: x" })).toEqual({ text: "Pull T9 fehlgeschlagen: fatal: x", error: true });
    expect(fmt({ status: "no-repo", at: 9, error: null })).toEqual({ text: "kein Git-Repo", error: false });
  });
});

describe("pullResultFromExec", () => {
  it("kein Fehler ist ok", () => {
    expect(pullResultFromExec(null, "")).toEqual({ ok: true });
  });
  it("ENOENT heißt git fehlt", () => {
    expect(pullResultFromExec({ code: "ENOENT" }, "")).toEqual({ ok: false, stderr: "", notFound: true });
  });
  it("killed oder Signal heißt Zeitüberschreitung", () => {
    expect(pullResultFromExec({ killed: true, signal: "SIGTERM", code: null }, "x")).toEqual({ ok: false, stderr: "x", timedOut: true });
    expect(pullResultFromExec({ signal: "SIGTERM" }, "")).toMatchObject({ ok: false, timedOut: true });
  });
  it("Exit-Code kommt mit, stderr bleibt", () => {
    expect(pullResultFromExec({ code: 128 }, "fatal: x")).toEqual({ ok: false, stderr: "fatal: x", code: 128 });
  });
});

describe("pullDue", () => {
  it("0 Minuten ist aus", () => {
    expect(pullDue(null, 1e9, 0)).toBe(false);
    expect(pullDue(0, 1e9, 0)).toBe(false);
  });
  it("noch nie versucht ist fällig", () => {
    expect(pullDue(null, 1, 5)).toBe(true);
  });
  it("erst nach dem Abstand", () => {
    expect(pullDue(1000, 1000 + 5 * 60000 - 1, 5)).toBe(false);
    expect(pullDue(1000, 1000 + 5 * 60000, 5)).toBe(true);
  });
});
