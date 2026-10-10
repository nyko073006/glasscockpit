import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkDeployTarget, resolveDeployTarget } from "../src/core/deploy-target";

const PLUGINS = "/tmp/vault/.obsidian/plugins";
const BEISPIEL = `${PLUGINS}/glasscockpit/`;

/** Der Pfad wird abgelehnt, und zwar mit dem Grund der erwarteten Regel. */
function erwarteAblehnung(pfad: string, grund: RegExp) {
  expect(checkDeployTarget(pfad)).toEqual({
    ok: false,
    reason: expect.stringMatching(grund),
  });
}

describe("(c) Zielpfad-Prüfung", () => {
  describe("gültige Pfade", () => {
    it("Beispielziel ist ok, mit abschließendem /", () => {
      expect(checkDeployTarget(BEISPIEL)).toEqual({ ok: true });
    });

    it("Beispielziel ist ok, ohne abschließendes /", () => {
      expect(checkDeployTarget(BEISPIEL.replace(/\/+$/, ""))).toEqual({ ok: true });
    });

    it("mehrere abschließende Schrägstriche sind erlaubt", () => {
      expect(checkDeployTarget(`${PLUGINS}/glasscockpit//`)).toEqual({ ok: true });
    });

    it("zwei Punkte in einem Namen sind kein ..-Segment", () => {
      expect(checkDeployTarget(`${PLUGINS}/foo..bar/glasscockpit`)).toEqual({ ok: true });
    });
  });

  describe("abgelehnt, jede Regel mit einem Fall, an dem nur sie scheitert", () => {
    it("Regel absolut: relativer Pfad plugins/glasscockpit", () => {
      erwarteAblehnung("plugins/glasscockpit", /nicht absolut/);
    });

    it("Regel letztes Segment: glasscockpit-alt", () => {
      erwarteAblehnung(`${PLUGINS}/glasscockpit-alt`, /letztes Segment/);
    });

    it("Regel kein ..-Segment: Pfad mit /../", () => {
      erwarteAblehnung(`${PLUGINS}/../plugins/glasscockpit`, /\.\.-Segment/);
    });

    it("Regel agentic-os: endet richtig, enthält agentic-os", () => {
      erwarteAblehnung(`${PLUGINS}/agentic-os/glasscockpit`, /enthält agentic-os/);
    });

    it("Regel agentic-os, Schreibweise Agentic-OS (APFS unterscheidet nicht)", () => {
      erwarteAblehnung(`${PLUGINS}/Agentic-OS/glasscockpit`, /enthält agentic-os/);
    });
  });

  describe("abgelehnt, weitere Fälle", () => {
    it("der Ordner agentic-os selbst", () => {
      expect(checkDeployTarget(`${PLUGINS}/agentic-os`).ok).toBe(false);
      expect(checkDeployTarget(`${PLUGINS}/agentic-os/`).ok).toBe(false);
    });

    it("letztes Segment muss genau glasscockpit heißen, auch in der Schreibweise", () => {
      erwarteAblehnung(`${PLUGINS}/GlassCockpit`, /letztes Segment/);
    });

    it("leerer Pfad und Wurzel", () => {
      expect(checkDeployTarget("").ok).toBe(false);
      expect(checkDeployTarget("/").ok).toBe(false);
    });
  });
});

describe("resolveDeployTarget", () => {
  const ENV = "/tmp/env-vault/.obsidian/plugins/glasscockpit";
  const DATEI = JSON.stringify({ target: "/tmp/datei-vault/.obsidian/plugins/glasscockpit/" });

  it("Env vor Datei", () => {
    expect(resolveDeployTarget(ENV, DATEI)).toEqual({ ok: true, target: ENV, source: "env" });
  });

  it("nur Env", () => {
    expect(resolveDeployTarget(ENV, null)).toEqual({ ok: true, target: ENV, source: "env" });
  });

  it("nur Datei", () => {
    expect(resolveDeployTarget(undefined, DATEI)).toEqual({
      ok: true,
      target: "/tmp/datei-vault/.obsidian/plugins/glasscockpit/",
      source: "file",
    });
  });

  it("leere Env: Quelle ist die Datei", () => {
    expect(resolveDeployTarget("  ", DATEI)).toMatchObject({ ok: true, source: "file" });
  });

  it("die unveränderte Vorlage deploy.local.example.json besteht die Prüfung nicht", () => {
    const vorlage = readFileSync(new URL("../deploy.local.example.json", import.meta.url), "utf8");
    expect(resolveDeployTarget(undefined, vorlage).ok).toBe(false);
  });

  it("leere Env fällt auf die Datei zurück", () => {
    expect(resolveDeployTarget("", DATEI)).toMatchObject({ ok: true });
  });

  it("Env nur aus Leerzeichen zählt als nicht gesetzt", () => {
    expect(resolveDeployTarget("  \t ", DATEI)).toMatchObject({ ok: true });
  });

  it("Env mit Leerzeichen am Rand wird getrimmt", () => {
    expect(resolveDeployTarget(` ${ENV} `, null)).toEqual({ ok: true, target: ENV, source: "env" });
  });

  it("beides fehlt: Fehler mit Hinweis auf beide Wege", () => {
    for (const env of [undefined, "", "   "]) {
      expect(resolveDeployTarget(env, null)).toEqual({
        ok: false,
        reason: expect.stringMatching(/COCKPIT_DEPLOY_TARGET.*deploy\.local\.json.*deploy\.local\.example\.json/s),
      });
    }
  });

  it("kaputtes JSON: Fehler mit Grund", () => {
    expect(resolveDeployTarget(undefined, "{ nicht json")).toEqual({
      ok: false,
      reason: expect.stringMatching(/deploy\.local\.json.*JSON/s),
    });
  });

  it("Datei ohne target, mit leerem oder falschem target: Fehler", () => {
    for (const text of ["{}", '{"target": ""}', '{"target": "  "}', '{"target": 5}', "[]", "null"]) {
      expect(resolveDeployTarget(undefined, text)).toEqual({
        ok: false,
        reason: expect.stringMatching(/target/),
      });
    }
  });

  it("Ziel mit agentic-os aus Env: Fehler", () => {
    expect(resolveDeployTarget(`${PLUGINS}/agentic-os/glasscockpit`, DATEI)).toEqual({
      ok: false,
      reason: expect.stringMatching(/agentic-os/),
    });
  });

  it("Ziel mit agentic-os aus Datei: Fehler", () => {
    const text = JSON.stringify({ target: `${PLUGINS}/Agentic-OS/glasscockpit` });
    expect(resolveDeployTarget(undefined, text)).toEqual({
      ok: false,
      reason: expect.stringMatching(/agentic-os/),
    });
  });

  it("relativer Pfad: Fehler (Env und Datei)", () => {
    expect(resolveDeployTarget("plugins/glasscockpit", null)).toEqual({
      ok: false,
      reason: expect.stringMatching(/nicht absolut/),
    });
    expect(resolveDeployTarget(undefined, '{"target": "plugins/glasscockpit"}')).toEqual({
      ok: false,
      reason: expect.stringMatching(/nicht absolut/),
    });
  });

  it("ungültige Env fällt nicht auf die gültige Datei zurück", () => {
    expect(resolveDeployTarget("plugins/glasscockpit", DATEI).ok).toBe(false);
  });
});
