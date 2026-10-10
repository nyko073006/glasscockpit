import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { awaitRunning, expandHome, fillHandoffPrompt, isoDay, markTakenUp, newestOpen, sortHandoffs, touchesHandoffs, type HandoffSource } from "../src/core/handoffs";

const doc = (fm: string, body = "Text"): string => `---\n${fm}\n---\n${body}\n`;
const src = (name: string, fm: string): HandoffSource => ({ path: `P/Projekt A/Handoffs/${name}`, name, text: doc(fm) });

describe("newestOpen", () => {
  it("nimmt den neuesten offenen Handoff", () => {
    const r = newestOpen("Projekt A", "/Users/alex/a", [
      src("2026-01-02 Alt.md", "status: offen\nerstellt: 2026-01-02\nnaechster_auftrag: alt"),
      src("2026-01-05 Neu.md", "status: offen\nerstellt: 2026-01-05\nnaechster_auftrag: \"neu machen\""),
    ], parse);
    expect(r.item).toEqual({ project: "Projekt A", path: "P/Projekt A/Handoffs/2026-01-05 Neu.md", created: "2026-01-05", task: "neu machen", repo: "/Users/alex/a" });
    expect(r.errors).toEqual([]);
  });
  it("aufgenommene erscheinen nicht, auch wenn sie neuer sind", () => {
    const r = newestOpen("Projekt A", null, [
      src("2026-01-02 Offen.md", "status: offen\nerstellt: 2026-01-02"),
      src("2026-01-09 Fertig.md", "status: aufgenommen\nerstellt: 2026-01-09"),
    ], parse);
    expect(r.item?.path).toBe("P/Projekt A/Handoffs/2026-01-02 Offen.md");
  });
  it("nur aufgenommene: kein Eintrag", () => {
    expect(newestOpen("Projekt A", null, [src("2026-01-09 F.md", "status: aufgenommen\nerstellt: 2026-01-09")], parse).item).toBeNull();
  });
  it("Datum ohne Anführungszeichen und ohne erstellt: Datum aus dem Dateinamen", () => {
    const r = newestOpen("Projekt A", null, [
      src("2026-01-03 Name.md", "status: offen"),
      src("x.md", "status: offen\nerstellt: '2026-01-04'"),
    ], parse);
    expect(r.item?.created).toBe("2026-01-04");
  });
  it("ohne Datum oder ohne Frontmatter: Fehlermeldung, kein Eintrag", () => {
    const r = newestOpen("Projekt A", null, [
      { path: "P/Projekt A/Handoffs/kaputt.md", name: "kaputt.md", text: "kein frontmatter" },
      src("ohne-datum.md", "status: offen"),
    ], parse);
    expect(r.item).toBeNull();
    expect(r.errors).toEqual([
      "Handoff ohne Frontmatter: P/Projekt A/Handoffs/kaputt.md",
      "Handoff ohne Datum: P/Projekt A/Handoffs/ohne-datum.md",
    ]);
  });
  it("fehlender Auftrag wird leerer Text", () => {
    expect(newestOpen("Projekt A", null, [src("2026-01-03 a.md", "status: offen")], parse).item?.task).toBe("");
  });
});

describe("expandHome", () => {
  it("ersetzt führendes ~", () => {
    expect(expandHome("~/dev/a", "/Users/alex")).toBe("/Users/alex/dev/a");
    expect(expandHome("~", "/Users/alex")).toBe("/Users/alex");
    expect(expandHome("/abs/~x", "/Users/alex")).toBe("/abs/~x");
  });
});

describe("sortHandoffs", () => {
  it("neueste zuerst, dann Projektname", () => {
    const h = (project: string, created: string) => ({ project, created, path: project, task: "", repo: null });
    expect(sortHandoffs([h("B", "2026-01-01"), h("A", "2026-01-03"), h("C", "2026-01-03")]).map((x) => x.project)).toEqual(["A", "C", "B"]);
  });
});

describe("fillHandoffPrompt", () => {
  it("ersetzt {datei} und {auftrag}, $ bleibt wörtlich", () => {
    expect(fillHandoffPrompt("Handoff: {datei}\nNächster Auftrag: {auftrag} ({datei})", { datei: "P/a$1.md", auftrag: "x" }))
      .toBe("Handoff: P/a$1.md\nNächster Auftrag: x (P/a$1.md)");
  });
});

describe("markTakenUp", () => {
  const before = "---\ntags: [handoff]\nstatus: offen\naufgenommen:\nerstellt: 2026-01-02\n---\nText\n";
  it("setzt status und aufgenommen, sonst bytegleich", () => {
    const r = markTakenUp(before, "2026-01-05");
    expect(r).toEqual({ ok: true, content: "---\ntags: [handoff]\nstatus: aufgenommen\naufgenommen: 2026-01-05\nerstellt: 2026-01-02\n---\nText\n" });
  });
  it("fehlt aufgenommen, kommt es direkt nach status", () => {
    const r = markTakenUp("---\nstatus: offen\nx: 1\n---\n", "2026-01-05");
    expect(r).toEqual({ ok: true, content: "---\nstatus: aufgenommen\naufgenommen: 2026-01-05\nx: 1\n---\n" });
  });
  it("CRLF bleibt erhalten", () => {
    const r = markTakenUp("---\r\nstatus: offen\r\naufgenommen:\r\n---\r\nText\r\n", "2026-01-05");
    expect(r).toEqual({ ok: true, content: "---\r\nstatus: aufgenommen\r\naufgenommen: 2026-01-05\r\n---\r\nText\r\n" });
  });
  it("bereits aufgenommen: Fehler, nichts geändert", () => {
    expect(markTakenUp("---\nstatus: aufgenommen\n---\n", "2026-01-05")).toEqual({ ok: false, reason: "Handoff ist nicht offen" });
  });
  it("status im Text unterhalb des Frontmatters zählt nicht", () => {
    expect(markTakenUp("---\nx: 1\n---\nstatus: offen\n", "2026-01-05")).toEqual({ ok: false, reason: "Handoff ist nicht offen" });
  });
  it("abschließender YAML-Kommentar zählt nicht zum Wert (wie newestOpen)", () => {
    const text = "---\nstatus: offen # Notiz\nerstellt: 2026-01-02\n---\nText\n";
    expect(newestOpen("Projekt A", null, [src("2026-01-02 K.md", "status: offen # Notiz\nerstellt: 2026-01-02")], parse).item).not.toBeNull();
    expect(markTakenUp(text, "2026-01-05")).toEqual({ ok: true, content: "---\nstatus: aufgenommen\naufgenommen: 2026-01-05\nerstellt: 2026-01-02\n---\nText\n" });
    const crlf = markTakenUp("---\r\nstatus: 'offen'  # x\r\n---\r\n", "2026-01-05");
    expect(crlf).toEqual({ ok: true, content: "---\r\nstatus: aufgenommen\r\naufgenommen: 2026-01-05\r\n---\r\n" });
  });
  it("Gegentest: # im Anführungszeichen oder ohne Leerraum davor gehört zum Wert, nicht offen (wie newestOpen)", () => {
    for (const line of ['status: "offen # x"', "status: 'offen # x'", "status: offen#x", "status: aufgenommen # offen"]) {
      expect(newestOpen("Projekt A", null, [src("2026-01-02 K.md", `${line}\nerstellt: 2026-01-02`)], parse).item, line).toBeNull();
      expect(markTakenUp(`---\n${line}\n---\n`, "2026-01-05"), line).toEqual({ ok: false, reason: "Handoff ist nicht offen" });
    }
  });
  it("ohne Frontmatter: Fehler", () => {
    expect(markTakenUp("status: offen\n", "2026-01-05")).toEqual({ ok: false, reason: "Handoff ohne Frontmatter" });
  });
});

describe("isoDay", () => {
  it("lokales Datum mit führenden Nullen", () => {
    expect(isoDay(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});

describe("awaitRunning", () => {
  const watch = () => {
    let running = false; let cb: (() => void) | null = null; let fire: (() => void) | null = null; let unsubscribed = false;
    const w = {
      onChange: (c: () => void) => { cb = c; return () => { unsubscribed = true; }; },
      isRunning: () => running, timeoutMs: 1000,
      setTimer: (fn: () => void) => { fire = fn; return 1; }, clearTimer: () => { fire = null; },
    };
    return { w, start: () => { running = true; cb?.(); }, timeout: () => fire?.(), unsub: () => unsubscribed };
  };
  it("true, sobald die Sitzung läuft; meldet sich ab", async () => {
    const t = watch(); const p = awaitRunning(t.w); t.start();
    await expect(p).resolves.toBe(true); expect(t.unsub()).toBe(true);
  });
  it("läuft schon beim Aufruf: sofort true", async () => {
    const t = watch(); t.start();
    await expect(awaitRunning(t.w)).resolves.toBe(true);
  });
  it("Zeitlimit: false, meldet sich ab", async () => {
    const t = watch(); const p = awaitRunning(t.w); t.timeout();
    await expect(p).resolves.toBe(false); expect(t.unsub()).toBe(true);
  });
  it("onChange ruft den Callback synchron auf: kein Absturz, true, abgemeldet", async () => {
    let unsubscribed = false; let timers = 0;
    const w = {
      onChange: (c: () => void) => { running = true; c(); return () => { unsubscribed = true; }; },
      isRunning: () => running, timeoutMs: 1000,
      setTimer: () => { timers++; return 1; }, clearTimer: () => {},
    };
    let running = false;
    await expect(awaitRunning(w)).resolves.toBe(true);
    expect(unsubscribed).toBe(true); expect(timers).toBe(0);
  });
});

describe("touchesHandoffs", () => {
  const s = { hubsDir: "Projekte", handoffsDir: "Handoffs", hubSuffix: " - HUB.md" };
  it("Pfad im Handoff-Ordner", () => expect(touchesHandoffs("Projekte/A/Handoffs/x.md", s)).toBe(true));
  it("HUB-Datei", () => expect(touchesHandoffs("Projekte/A/A - HUB.md", s)).toBe(true));
  it("andere Notiz unter hubsDir", () => expect(touchesHandoffs("Projekte/A/Notiz.md", s)).toBe(false));
  it("Pfad außerhalb von hubsDir", () => {
    expect(touchesHandoffs("Anderes/A/Handoffs/x.md", s)).toBe(false);
    expect(touchesHandoffs("ProjekteX/A/Handoffs/x.md", s)).toBe(false);
  });
  it("hubsDir mit Schrägstrich oder Leerzeichen wie ohne", () => {
    for (const hubsDir of ["Projekte/", " Projekte ", "/Projekte/"]) {
      expect(touchesHandoffs("Projekte/A/Handoffs/x.md", { ...s, hubsDir })).toBe(true);
      expect(touchesHandoffs("Anderes/A/Handoffs/x.md", { ...s, hubsDir })).toBe(false);
    }
  });
  it("leeres hubsDir oder handoffsDir: nie", () => {
    expect(touchesHandoffs("Projekte/A/Handoffs/x.md", { ...s, hubsDir: "" })).toBe(false);
    expect(touchesHandoffs("Projekte/A/Handoffs/x.md", { ...s, hubsDir: "  " })).toBe(false);
    expect(touchesHandoffs("Projekte/A/Handoffs/x.md", { ...s, handoffsDir: "" })).toBe(false);
  });
  it("leeres hubSuffix: HUB-Fall false, Handoff-Fall true", () => {
    expect(touchesHandoffs("Projekte/A/A - HUB.md", { ...s, hubSuffix: "" })).toBe(false);
    expect(touchesHandoffs("Projekte/A/Handoffs/x.md", { ...s, hubSuffix: "" })).toBe(true);
  });
});
