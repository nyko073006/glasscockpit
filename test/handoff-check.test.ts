import { describe, expect, it } from "vitest";
import {
  type HandoffCheckInput, clearNeedsConfirm, evaluateHandoffCheck, handoffPathCandidates, NO_SESSION_CHECK,
} from "../src/core/handoff-check";

const P = "Handoff:";
const ok: HandoffCheckInput = {
  hasBlock: true, handoffPath: "/h/a.md", startedAtMs: 1000, handoffMtimeMs: 2000,
  dailyUnset: false, dailyMtimeMs: 2000, git: "clean",
};

describe("handoffPathCandidates", () => {
  const c = (block: string, vault: string | null = "/v/MeinVault", cwd = "/w", prefix = P): string[] =>
    handoffPathCandidates(block, prefix, "/Users/n", vault, cwd);
  it("a) ~ und absolute Pfade, Leerzeichen und Backticks", () => {
    expect(c("Handoff: ~/Developer/x/handoffs/a.md\nAuftrag: y")).toEqual(["/Users/n/Developer/x/handoffs/a.md"]);
    expect(c("Handoff: ~")).toEqual(["/Users/n"]);
    expect(c("Handoff: `/Users/n/Mein Ordner/h.md`")).toEqual(["/Users/n/Mein Ordner/h.md"]);
    expect(c("Handoff: C:\\h\\a.md")).toEqual(["C:\\h\\a.md"]);
  });
  it("b) leerer Rest, leeres Präfix oder falsche erste Zeile: keine Kandidaten", () => {
    expect(c("Handoff:   ")).toEqual([]);
    expect(c("/a.md", null, "/w", "")).toEqual([]);
    expect(c("/a.md", null, "/w", "  ")).toEqual([]);
    expect(c("Auftrag: /a.md")).toEqual([]);
  });
  it("c) relativ: Vault zuerst, dann Startordner", () => {
    expect(c("Handoff: 02 Projekte/X/Handoffs/a.md")).toEqual(["/v/MeinVault/02 Projekte/X/Handoffs/a.md", "/w/02 Projekte/X/Handoffs/a.md"]);
  });
  it("d) relativ mit Vault-Ordnername vorn: auch Elternordner des Vaults", () => {
    const r = c("Handoff: MeinVault/02 Projekte/a.md");
    expect(r).toContain("/v/MeinVault/02 Projekte/a.md");
    expect(r[0]).toBe("/v/MeinVault/MeinVault/02 Projekte/a.md");
    expect(r).toContain("/w/MeinVault/02 Projekte/a.md");
  });
  it("e) Text hinter dem Pfad wird abgeschnitten", () => {
    expect(c("Handoff: handoffs/a.md (Abschnitt 4)").every((p) => p.endsWith("handoffs/a.md"))).toBe(true);
    expect(c("Handoff: `handoffs/B.MD` Abschnitt").pop()).toBe("/w/handoffs/B.MD");
  });
  it("f) ~\\ und UNC", () => {
    expect(c("Handoff: ~\\h\\a.md")).toEqual(["/Users/n\\h\\a.md"]);
    expect(c("Handoff: \\\\server\\s\\a.md")).toEqual(["\\\\server\\s\\a.md"]);
  });
  it("g) ohne Vault nur der Startordner", () => {
    expect(c("Handoff: a.md", null)).toEqual(["/w/a.md"]);
  });
});

describe("evaluateHandoffCheck", () => {
  it("alles erfüllt: grün", () => {
    const c = evaluateHandoffCheck(ok);
    expect(c.tone).toBe("green");
    expect(c.gaps).toEqual([]);
    expect(c.lines).toEqual(["✓ Handoff geschrieben: a.md", "✓ Daily Note von heute geschrieben", "✓ Git sauber"]);
    expect(c.tooltip).toBe("Übergabe: bereit für /clear");
  });
  it("Grenze: Mtime gleich Sitzungsstart ist nicht geändert; Start unbekannt genügt Existenz", () => {
    const a = evaluateHandoffCheck({ ...ok, handoffMtimeMs: 1000 });
    expect(a.tone).toBe("red");
    expect(a.gaps).toEqual(["Handoff seit Sitzungsstart nicht geändert"]);
    expect(evaluateHandoffCheck({ ...ok, startedAtMs: null, handoffMtimeMs: 5, dailyMtimeMs: 5 }).tone).toBe("green");
  });
  const faelle: Array<[string, Partial<HandoffCheckInput>, string]> = [
    ["Pfad null", { handoffPath: null }, "Handoff-Pfad im Block nicht lesbar"],
    ["Datei fehlt", { handoffMtimeMs: null }, "Handoff-Datei fehlt: /h/a.md"],
    ["Handoff alt", { handoffMtimeMs: 500 }, "Handoff seit Sitzungsstart nicht geändert"],
    ["Daily unset", { dailyUnset: true }, "Daily-Ordner nicht eingerichtet"],
    ["Daily fehlt", { dailyMtimeMs: null }, "Daily Note von heute fehlt"],
    ["Daily alt", { dailyMtimeMs: 500 }, "Daily Note seit Sitzungsstart nicht geändert"],
    ["Git dirty", { git: "dirty" }, "Ungesicherte Änderungen im Startordner"],
    ["Git unknown", { git: "unknown" }, "Git-Status nicht lesbar"],
  ];
  for (const [name, abw, gap] of faelle) {
    it(`Lücke: ${name}`, () => {
      const c = evaluateHandoffCheck({ ...ok, ...abw });
      expect(c.tone).toBe("red");
      expect(c.gaps).toEqual([gap]);
      expect(c.lines.filter((l) => l.startsWith("✗ "))).toEqual(["✗ " + gap]);
      expect(c.tooltip).toBe("Übergabe: 1 Lücke\n" + gap);
    });
  }
  it("Kein Repo ist grün", () => {
    const c = evaluateHandoffCheck({ ...ok, git: "none" });
    expect(c.tone).toBe("green");
    expect(c.lines[2]).toBe("✓ Kein Git-Repo im Startordner");
  });
  it("drei Lücken: Mehrzahl und Reihenfolge", () => {
    const c = evaluateHandoffCheck({ ...ok, handoffPath: null, dailyMtimeMs: null, git: "dirty" });
    expect(c.gaps).toEqual(["Handoff-Pfad im Block nicht lesbar", "Daily Note von heute fehlt", "Ungesicherte Änderungen im Startordner"]);
    expect(c.tooltip).toBe("Übergabe: 3 Lücken\n" + c.gaps.join("\n"));
  });
  it("ohne Block: grau, keine Lücken, egal was sonst rot ist", () => {
    const c = evaluateHandoffCheck({ ...ok, hasBlock: false, handoffPath: null, dailyMtimeMs: null, git: "dirty" });
    expect(c).toEqual({ tone: "gray", gaps: [], lines: ["Kein Handoff-Block in dieser Sitzung."], tooltip: "Übergabe: kein Handoff-Block" });
  });
  it("NO_SESSION_CHECK", () => {
    expect(NO_SESSION_CHECK).toEqual({ tone: "gray", gaps: [], lines: ["Keine aktive Sitzung."], tooltip: "Übergabe: keine aktive Sitzung" });
  });
});

describe("clearNeedsConfirm", () => {
  const rot = evaluateHandoffCheck({ ...ok, git: "dirty" });
  it("nur rot und an liefert die Lücken", () => {
    expect(clearNeedsConfirm(rot, true)).toEqual(["Ungesicherte Änderungen im Startordner"]);
    expect(clearNeedsConfirm(rot, false)).toBeNull();
    expect(clearNeedsConfirm(evaluateHandoffCheck(ok), true)).toBeNull();
    expect(clearNeedsConfirm(NO_SESSION_CHECK, true)).toBeNull();
    expect(clearNeedsConfirm(null, true)).toBeNull();
  });
});
