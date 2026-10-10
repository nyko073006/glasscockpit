import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
describe("Abend 19h Verdrahtung", () => {
  const body = main.slice(main.indexOf("private async takeUpHandoff"));
  it("Status erst nach dem Start setzen", () => {
    const wait = body.indexOf("awaitRunning("); const mark = body.indexOf("markTakenUp(");
    expect(wait).toBeGreaterThan(0); expect(mark).toBeGreaterThan(wait);
    expect(body.slice(wait, mark)).toContain("if (!started)");
  });
  it("Startnachricht geht über createSession, nicht über send", () => {
    expect(body.slice(0, body.indexOf("awaitRunning("))).toContain("prompt: h.prompt");
    expect(body.slice(0, body.indexOf("\n  }\n"))).not.toContain("sendToActive");
  });
  it("Menü liest Handoffs beim Öffnen neu", () => {
    const open = main.slice(main.indexOf("private async openNewSessionModal"));
    expect(open.indexOf("readOpenHandoffs(")).toBeLessThan(open.indexOf("new NewSessionModal("));
  });
  it("Lesefehler im Menü: readOpenHandoffs im try, Menü öffnet nach dem catch trotzdem", () => {
    const open = main.slice(main.indexOf("private async openNewSessionModal"));
    const tryAt = open.indexOf("try {");
    const read = open.indexOf("readOpenHandoffs(");
    const catchAt = open.indexOf("catch");
    const modal = open.indexOf("new NewSessionModal(");
    expect(tryAt).toBeGreaterThan(-1);
    expect(tryAt).toBeLessThan(read);
    expect(read).toBeLessThan(catchAt);
    expect(open.slice(catchAt, modal)).toContain("console.warn");
    expect(catchAt).toBeLessThan(modal);
  });
  it("In-Flight-Satz: vor createSession geprüft, im finally aufgeräumt, Menü filtert ihn", () => {
    const create = body.indexOf("this.createSession(");
    expect(body.slice(0, create)).toContain("handoffsInFlight.has(h.path)");
    expect(body.slice(0, create)).toContain("handoffsInFlight.add(h.path)");
    const fin = body.indexOf("finally");
    expect(fin).toBeGreaterThan(create);
    expect(body.slice(fin, body.indexOf("\n  }\n"))).toContain("handoffsInFlight.delete(h.path)");
    const open = main.slice(main.indexOf("private async openNewSessionModal"));
    expect(open.slice(0, open.indexOf("new NewSessionModal("))).toContain("this.handoffsInFlight");
  });
});
