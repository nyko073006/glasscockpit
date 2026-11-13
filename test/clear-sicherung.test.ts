import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ON_WINDOWS } from "./helpers/platform";

// SessionEnd-Hook hooks/clear-sicherung.py (Nachtrag 43i): stempelt die endende Sitzung in den zuletzt genannten Handoff
// und schreibt jede Sitzungsende-Zeile ins Protokoll. COCKPIT_DIR zeigt auf einen Temp-Ordner.

const HOOK = resolve(__dirname, "..", "hooks", "clear-sicherung.py");
const aufraeumen: string[] = [];
afterEach(() => { while (aufraeumen.length) rmSync(aufraeumen.pop()!, { recursive: true, force: true }); });

function temp(): string {
  const d = mkdtempSync(join(tmpdir(), "clear-sicherung-"));
  aufraeumen.push(d);
  return d;
}
const zeile = (o: unknown) => JSON.stringify(o) + "\n";
const assistant = (text: string) => zeile({ type: "assistant", message: { content: [{ type: "text", text }] } });
const block = (pfad: string) => "Fertig.\n\n```\nHandoff: " + pfad + "\nAuftrag: weiter\n```\n";

function lauf(o: { cwd: string; transkript: string; reason?: string; cockpit?: string; schwellen?: unknown }) {
  const cockpit = o.cockpit ?? temp();
  if (o.schwellen) writeFileSync(join(cockpit, "thresholds.json"), JSON.stringify(o.schwellen));
  const eingabe = JSON.stringify({ session_id: "abc-123", transcript_path: o.transkript, cwd: o.cwd, reason: o.reason ?? "clear", hook_event_name: "SessionEnd" });
  const r = spawnSync("python3", [HOOK], { input: eingabe, encoding: "utf8", env: { ...process.env, COCKPIT_DIR: cockpit } });
  const log = existsSync(join(cockpit, "clear-log.jsonl")) ? readFileSync(join(cockpit, "clear-log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
  return { status: r.status, stdout: r.stdout, log };
}

describe.skipIf(ON_WINDOWS)("clear-sicherung.py (Nachtrag 43i)", () => {
  it("stempelt Vorgänger-Sitzung und Transkript in das Frontmatter des letzten Handoffs (relativ zum cwd), Rest bytegleich", () => {
    const cwd = temp();
    mkdirSync(join(cwd, "Handoffs"));
    const h = join(cwd, "Handoffs", "H 1.md");
    writeFileSync(h, "---\nstatus: offen\nerstellt: 2026-11-08\n---\n\n# Text\n");
    const t = join(cwd, "t.jsonl");
    writeFileSync(t, assistant(block("Handoffs/alt.md")) + assistant(block("Handoffs/H 1.md")));
    const r = lauf({ cwd, transkript: t });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(readFileSync(h, "utf8")).toBe(`---\nstatus: offen\nerstellt: 2026-11-08\nvorgaenger_session: abc-123\nvorgaenger_transkript: ${t}\n---\n\n# Text\n`);
    expect(r.log).toHaveLength(1);
    expect(r.log[0]).toMatchObject({ reason: "clear", session_id: "abc-123", transkript: t, handoff: h, gestempelt: true });
  });

  it("vorhandene Felder werden ersetzt, nicht verdoppelt; CRLF bleibt", () => {
    const cwd = temp();
    const h = join(cwd, "h.md");
    writeFileSync(h, "---\r\nstatus: offen\r\nvorgaenger_session: alt\r\nvorgaenger_transkript: /alt.jsonl\r\n---\r\nText\r\n");
    const t = join(cwd, "t.jsonl");
    writeFileSync(t, assistant(block(h)));
    lauf({ cwd, transkript: t });
    expect(readFileSync(h, "utf8")).toBe(`---\r\nstatus: offen\r\nvorgaenger_session: abc-123\r\nvorgaenger_transkript: ${t}\r\n---\r\nText\r\n`);
  });

  it("Datei ohne Frontmatter: Zeile am Ende angehängt, Inhalt davor bleibt", () => {
    const cwd = temp();
    const h = join(cwd, "h.md");
    writeFileSync(h, "# Nur Text\n");
    const t = join(cwd, "t.jsonl");
    writeFileSync(t, assistant(block("`h.md`")));
    lauf({ cwd, transkript: t });
    expect(readFileSync(h, "utf8")).toBe(`# Nur Text\n\n> Vorgänger-Sitzung: abc-123 (${t})\n`);
  });

  it("Präfix aus thresholds.json (handoff_prefix)", () => {
    const cwd = temp();
    const h = join(cwd, "h.md");
    writeFileSync(h, "---\nx: 1\n---\n");
    const t = join(cwd, "t.jsonl");
    writeFileSync(t, assistant("```\nÜbergabe: h.md\n```"));
    lauf({ cwd, transkript: t, schwellen: { handoff_prefix: "Übergabe:" } });
    expect(readFileSync(h, "utf8")).toContain("vorgaenger_session: abc-123");
  });

  it("Gegentest: ohne Handoff-Block oder mit fehlender Datei bleibt alles unverändert, das Protokoll hält das Ende trotzdem fest", () => {
    const cwd = temp();
    const h = join(cwd, "h.md");
    writeFileSync(h, "---\nx: 1\n---\n");
    const t = join(cwd, "t.jsonl");
    writeFileSync(t, assistant("Kein Block, nur h.md erwähnt."));
    const ohne = lauf({ cwd, transkript: t, reason: "prompt_input_exit" });
    expect(readFileSync(h, "utf8")).toBe("---\nx: 1\n---\n");
    expect(ohne.log[0]).toMatchObject({ reason: "prompt_input_exit", handoff: null, gestempelt: false });
    writeFileSync(t, assistant(block("gibt-es-nicht.md")));
    const fehlt = lauf({ cwd, transkript: t });
    expect(fehlt.status).toBe(0);
    expect(fehlt.log[0]).toMatchObject({ handoff: "gibt-es-nicht.md", gestempelt: false });
  });

  it("kaputte Eingabe oder fehlendes Transkript: still Exit 0", () => {
    const cockpit = temp();
    const r = spawnSync("python3", [HOOK], { input: "kein json", encoding: "utf8", env: { ...process.env, COCKPIT_DIR: cockpit } });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    const r2 = lauf({ cwd: temp(), transkript: "/gibt/es/nicht.jsonl", cockpit });
    expect(r2.status).toBe(0);
  });
});
