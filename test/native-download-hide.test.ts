import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { windowsExtract } from "../src/host/native-download";

// Obsidian ist ein GUI-Prozess: Startet er ein Konsolenprogramm wie tar.exe per execFile ohne windowsHide, öffnet Windows ein
// eigenes Konsolenfenster (Node-Vorgabe windowsHide: false). Das echte execFile ist hier durch eine Attrappe ersetzt, die die
// Optionen mitschreibt; auf dem Mac ist windowsHide wirkungslos, deshalb prüft der Test die Optionen statt eines Fensters.
const h = vi.hoisted(() => ({ aufrufe: [] as { datei: string; args: string[]; optionen: Record<string, unknown> }[] }));
vi.mock("node:child_process", () => ({
  execFile: (
    datei: string,
    args: string[],
    optionen: Record<string, unknown>,
    fertig: (fehler: Error | null, stdout: string, stderr: string) => void,
  ) => {
    h.aufrufe.push({ datei, args, optionen });
    fertig(null, args[0] === "-t" ? "lib/\r\nlib/index.js\r\n" : "", "");
  },
}));

const angelegt: string[] = [];
afterEach(() => {
  h.aufrufe.length = 0;
  for (const d of angelegt.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("Abend 40 (3): tar.exe ohne Konsolenfenster", () => {
  it("windowsExtract startet das Listing und das Entpacken mit windowsHide: true", async () => {
    const dir = mkdtempSync(join(tmpdir(), "glasscockpit-hide-"));
    angelegt.push(dir);
    await windowsExtract(join(dir, "native.zip"), join(dir, "entpackt"), "C:\\W");
    expect(h.aufrufe.map((a) => a.args[0])).toEqual(["-t", "-x"]); // beide Aufrufe liefen über die echte run()
    for (const a of h.aufrufe) expect(a.optionen.windowsHide, a.args.join(" ")).toBe(true);
  });
});
