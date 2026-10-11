import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// Stop-Hook hooks/clearable-banner.py (Abend 26b): wird als Prozess mit fester Eingabe per stdin aufgerufen.
// COCKPIT_DIR und HOME zeigen auf Temp-Ordner, damit weder Schwellen noch Log den echten Rechner berühren.

const HOOK = resolve(__dirname, "..", "hooks", "clearable-banner.py");
const DEPLOY = resolve(__dirname, "..", "scripts", "deploy-hook.mjs");

const aufraeumen: string[] = [];
afterEach(() => {
  while (aufraeumen.length) rmSync(aufraeumen.pop()!, { recursive: true, force: true });
});

function temp(): string {
  const d = mkdtempSync(join(tmpdir(), "clearable-"));
  aufraeumen.push(d);
  return d;
}

const zeile = (o: unknown) => JSON.stringify(o) + "\n";

/** Transkript wie nach /clear: Meta-Eintrag, Slash-Befehl, dann n Nachrichten mit je einem Tool-Ergebnis. */
function transkript(ordner: string, nachrichten: number): string {
  let text = zeile({ type: "user", isMeta: true, message: { content: "<local-command-caveat>x</local-command-caveat>" } });
  text += zeile({ type: "user", message: { content: "<command-name>/clear</command-name>" } });
  for (let i = 0; i < nachrichten; i++) {
    text += zeile({ type: "user", message: { content: `Auftrag ${i}` } });
    text += zeile({ type: "user", message: { content: [{ type: "tool_result", content: "x" }] } });
  }
  const pfad = join(ordner, "t.jsonl");
  writeFileSync(pfad, text);
  return pfad;
}

function lauf(opt: { nachrichten: number; prozent?: number | null; schwellen?: string; text?: string }): string {
  const home = temp();
  const cockpit = join(home, "cockpit");
  mkdirSync(join(cockpit, "sessions"), { recursive: true });
  if (opt.prozent !== null) writeFileSync(join(cockpit, "sessions", "abc.json"), JSON.stringify({ used_percentage: opt.prozent ?? 20 }));
  if (opt.schwellen !== undefined) writeFileSync(join(cockpit, "thresholds.json"), opt.schwellen);
  const eingabe = {
    session_id: "abc",
    transcript_path: transkript(home, opt.nachrichten),
    last_assistant_message: opt.text ?? "fertig\n```text\nHandoff: x.md\n```",
  };
  const r = spawnSync("python3", [HOOK], {
    input: JSON.stringify(eingabe), encoding: "utf8", env: { ...process.env, HOME: home, COCKPIT_DIR: cockpit },
  });
  expect(r.status).toBe(0);
  return r.stdout;
}
const banner = (stdout: string) => stdout.includes("Session clearable");

describe("clearable-banner: Handoff-Freigabe", () => {
  it("Vorgabe 2 Nachrichten: bei 1 kein Banner, bei 2 Banner", () => {
    expect(banner(lauf({ nachrichten: 1 }))).toBe(false);
    expect(banner(lauf({ nachrichten: 2 }))).toBe(true);
  });
  it("Slash-Befehle, Meta-Einträge und Tool-Ergebnisse zählen nicht als Nachricht", () => {
    expect(banner(lauf({ nachrichten: 1, schwellen: '{"clearable_min_prompts":2}' }))).toBe(false);
  });
  it("Vorgabe 10 % Kontext: bei 5 % kein Banner; unbekannter Kontext hält nicht auf", () => {
    expect(banner(lauf({ nachrichten: 2, prozent: 5 }))).toBe(false);
    expect(banner(lauf({ nachrichten: 2, prozent: null }))).toBe(true);
  });
  it("Schwellen aus thresholds.json", () => {
    expect(banner(lauf({ nachrichten: 2, schwellen: '{"clearable_min_prompts":3}' }))).toBe(false);
    expect(banner(lauf({ nachrichten: 1, schwellen: '{"clearable_min_prompts":1}' }))).toBe(true);
    expect(banner(lauf({ nachrichten: 2, prozent: 5, schwellen: '{"clearable_min_context_pct":0}' }))).toBe(true);
  });
  it("kaputte oder unzulässige Werte: Vorgaben", () => {
    expect(banner(lauf({ nachrichten: 1, schwellen: "{kaputt" }))).toBe(false);
    expect(banner(lauf({ nachrichten: 1, schwellen: '{"clearable_min_prompts":0}' }))).toBe(false);
    expect(banner(lauf({ nachrichten: 2, prozent: 5, schwellen: '{"clearable_min_context_pct":true}' }))).toBe(false);
  });
  it("ohne Signal kein Banner, „nicht clearable“ ist kein Signal", () => {
    expect(lauf({ nachrichten: 5, text: "fertig" })).toBe("");
    expect(banner(lauf({ nachrichten: 5, text: "Die Session ist nicht clearable." }))).toBe(false);
  });
  it("Banner trägt die Startnachricht", () => {
    expect(lauf({ nachrichten: 2 })).toContain("Handoff: x.md");
  });
});

describe("npm run deploy:hook", () => {
  it("kopiert den Hook bytegleich und ausführbar ans Ziel", () => {
    const ziel = join(temp(), "hooks", "clearable-banner.py");
    const r = spawnSync(process.execPath, [DEPLOY, ziel], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(existsSync(ziel)).toBe(true);
    expect(readFileSync(ziel, "utf8")).toBe(readFileSync(HOOK, "utf8"));
    expect(statSync(ziel).mode & 0o111).not.toBe(0);
  });
});
