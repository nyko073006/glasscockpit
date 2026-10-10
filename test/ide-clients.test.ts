import { describe, expect, it } from "vitest";
import { clientForSession, sessionForClient, descendsFrom, parseIdeConnected } from "../src/core/ide-clients";

describe("parseIdeConnected", () => {
  it("liest pid aus den Parametern", () => {
    expect(parseIdeConnected({ pid: 47910 })).toBe(47910);
  });
  it.each([[undefined], [null], [{}], [{ pid: "1" }], [{ pid: 1.5 }], [{ pid: 0 }], [{ pid: -3 }], [[1]]])("%j ergibt null", (p) => {
    expect(parseIdeConnected(p)).toBeNull();
  });
});

describe("descendsFrom", () => {
  // 100 (PTY) -> 101 (Login-Shell) -> 102 (claude)
  const parents: Record<number, number> = { 102: 101, 101: 100, 100: 1 };
  const parentOf = (pid: number) => parents[pid] ?? null;
  it("dieselbe pid zählt", () => expect(descendsFrom(100, 100, parentOf)).toBe(true));
  it("Kind und Enkel zählen", () => {
    expect(descendsFrom(101, 100, parentOf)).toBe(true);
    expect(descendsFrom(102, 100, parentOf)).toBe(true);
  });
  it("fremde pid und die Vorfahren zählen nicht", () => {
    expect(descendsFrom(200, 100, parentOf)).toBe(false);
    expect(descendsFrom(100, 102, parentOf)).toBe(false);
  });
  it("Zyklus oder lange Kette bricht ab statt zu hängen", () => {
    expect(descendsFrom(5, 100, (p) => (p === 5 ? 6 : 5))).toBe(false);
  });
});

describe("clientForSession", () => {
  const none = () => null;
  it("gleiche pid: PTY-pid ist die claude-pid (Start ohne Shell)", () => {
    const clients = [{ id: 1, pid: 500 }, { id: 2, pid: 600 }];
    expect(clientForSession(clients, 600, none)).toEqual({ id: 2, pid: 600 });
  });
  it("Zwischenprozess: claude ist Kind der PTY-pid", () => {
    const clients = [{ id: 1, pid: 500 }, { id: 2, pid: 602 }];
    const parentOf = (p: number) => ({ 602: 601, 601: 600 })[p as 602 | 601] ?? null;
    expect(clientForSession(clients, 600, parentOf)).toEqual({ id: 2, pid: 602 });
  });
  it("gleiche pid hat Vorrang vor einem Nachfahren", () => {
    const clients = [{ id: 1, pid: 601 }, { id: 2, pid: 600 }];
    expect(clientForSession(clients, 600, (p) => (p === 601 ? 600 : null))).toEqual({ id: 2, pid: 600 });
  });
  it("gleiche pid hat Vorrang, auch wenn ein Nachfahre später verbunden hat", () => {
    const clients = [{ id: 1, pid: 600 }, { id: 2, pid: 601 }];
    expect(clientForSession(clients, 600, (p) => (p === 601 ? 600 : null))).toEqual({ id: 1, pid: 600 });
  });
  it("mehrere Nachfahren: der jüngste Eintrag (zuletzt verbunden)", () => {
    const clients = [{ id: 1, pid: 601 }, { id: 2, pid: 602 }];
    expect(clientForSession(clients, 600, () => 600)).toEqual({ id: 2, pid: 602 });
  });
  it("kein Treffer, Client ohne pid, PTY ohne pid: null", () => {
    expect(clientForSession([{ id: 1, pid: 500 }], 600, none)).toBeNull();
    expect(clientForSession([{ id: 1, pid: null }], 600, none)).toBeNull();
    expect(clientForSession([{ id: 1, pid: 600 }], undefined, none)).toBeNull();
    expect(clientForSession([], 600, none)).toBeNull();
  });
});

describe("sessionForClient (Abend 17): zu welcher Sitzung gehört die Verbindung?", () => {
  const sessions = [{ id: "s1", pid: 100 }, { id: "s2", pid: 200 }, { id: "s3", pid: undefined }];
  const none = () => null;
  it("gleiche pid", () => {
    expect(sessionForClient({ id: 1, pid: 200 }, sessions, none)).toBe("s2");
  });
  it("Nachfahre der PTY-pid (Zwischenprozess)", () => {
    const parents: Record<number, number> = { 305: 300, 300: 100 };
    expect(sessionForClient({ id: 1, pid: 305 }, sessions, (p) => parents[p] ?? null)).toBe("s1");
  });
  it("gleiche pid geht vor Nachfahre", () => {
    const parents: Record<number, number> = { 200: 100 };
    expect(sessionForClient({ id: 1, pid: 200 }, sessions, (p) => parents[p] ?? null)).toBe("s2");
  });
  it("keine pid gemeldet, unbekannte pid, Sitzung ohne pid: null", () => {
    expect(sessionForClient({ id: 1, pid: null }, sessions, none)).toBeNull();
    expect(sessionForClient({ id: 1, pid: 999 }, sessions, none)).toBeNull();
    expect(sessionForClient({ id: 1, pid: 5 }, [{ id: "x", pid: undefined }], none)).toBeNull();
  });
});
