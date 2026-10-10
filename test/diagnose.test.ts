import { describe, expect, it } from "vitest";
import { type PaneProbe, firstNonEmptyLine, formatDiagnosis, formatLaunchInfo } from "../src/core/diagnose";

function probe(extra: Partial<PaneProbe> = {}): PaneProbe {
  return {
    viewChunks: 3,
    replayChars: 0,
    bufferLine: { index: 0, text: "alex@mac ~ %" },
    domLine: { index: 0, text: "alex@mac ~ %" },
    cols: 120,
    rows: 30,
    widthPx: 900,
    heightPx: 500,
    renders: 4,
    ...extra,
  };
}

describe("firstNonEmptyLine", () => {
  it("überspringt leere und reine Leerzeichen-Zeilen", () => {
    expect(firstNonEmptyLine(["", "   ", "Last login: Sun", "x"])).toEqual({ index: 2, text: "Last login: Sun" });
  });

  it("schneidet Leerzeichen am Ende ab, nicht am Anfang", () => {
    expect(firstNonEmptyLine(["  % ls   "])).toEqual({ index: 0, text: "  % ls" });
  });

  it("alles leer: null", () => {
    expect(firstNonEmptyLine(["", " "])).toBeNull();
    expect(firstNonEmptyLine([])).toBeNull();
  });
});

describe("formatDiagnosis", () => {
  it("ohne Terminal-View: Hinweis statt leerem Text", () => {
    expect(formatDiagnosis([])).toBe("Kein Terminal offen.");
  });

  it("eine View mit Sitzung: PTY-Portionen, View-Portionen, Puffer- und DOM-Zeile, Maße", () => {
    const text = formatDiagnosis([
      {
        sessionId: "3f2a-uuid",
        session: { running: true, exitCode: null, chunks: 5, chars: 812, ringChars: 812, cols: 120, rows: 30, subscribers: 1 },
        early: probe({ viewChunks: 2, renders: 0, domLine: null }),
        now: probe(),
      },
    ]);
    expect(text).toBe(
      [
        "Terminal 1, Sitzung 3f2a-uuid",
        "  PTY: läuft, 5 Portionen, 812 Zeichen, Ring 812, 120x30, 1 Abonnent(en)",
        "  nach 2 s: View 2 Portionen, Replay 0 Zeichen, Renders 0, 120x30 bei 900x500 px",
        "    Puffer Z0: alex@mac ~ %",
        "    DOM: (leer)",
        "  jetzt: View 3 Portionen, Replay 0 Zeichen, Renders 4, 120x30 bei 900x500 px",
        "    Puffer Z0: alex@mac ~ %",
        "    DOM Z0: alex@mac ~ %",
      ].join("\n"),
    );
  });

  it("View ohne Sitzung, Sitzung beendet, Momentaufnahme fehlt", () => {
    const text = formatDiagnosis([
      { sessionId: null, session: null, early: null, now: probe({ bufferLine: null, domLine: null }) },
      {
        sessionId: "b",
        session: { running: false, exitCode: 1, chunks: 0, chars: 0, ringChars: 0, cols: 80, rows: 24, subscribers: 0 },
        early: null,
        now: null,
      },
    ]);
    expect(text).toBe(
      [
        "Terminal 1, ohne Sitzung",
        "  nach 2 s: keine Momentaufnahme",
        "  jetzt: View 3 Portionen, Replay 0 Zeichen, Renders 4, 120x30 bei 900x500 px",
        "    Puffer: (leer)",
        "    DOM: (leer)",
        "",
        "Terminal 2, Sitzung b",
        "  PTY: beendet (Exit 1), 0 Portionen, 0 Zeichen, Ring 0, 80x24, 0 Abonnent(en)",
        "  nach 2 s: keine Momentaufnahme",
        "  jetzt: keine Pane",
      ].join("\n"),
    );
  });

  it("Sitzungs-id ohne Eintrag im Manager", () => {
    const text = formatDiagnosis([{ sessionId: "weg", session: null, early: null, now: null }]);
    expect(text.split("\n")[1]).toBe("  PTY: nicht im Session-Manager");
  });

  it("lange Zeilen werden auf 80 Zeichen gekürzt", () => {
    const lang = "x".repeat(100);
    const text = formatDiagnosis([
      { sessionId: null, session: null, early: null, now: probe({ bufferLine: { index: 4, text: lang } }) },
    ]);
    expect(text).toContain(`    Puffer Z4: ${"x".repeat(80)}…`);
  });
});

describe("formatLaunchInfo", () => {
  const dirs = ["/Users/alex/.local/bin", "/opt/homebrew/bin", "/usr/bin"];

  it("nennt den gefundenen claude-Pfad und die Herkunft Login-Shell", () => {
    const text = formatLaunchInfo({ binary: "/Users/alex/.local/bin/claude", origin: "login-shell", reason: null, dirs });
    expect(text).toContain("claude: /Users/alex/.local/bin/claude");
    expect(text).toContain("PATH: aus der Login-Shell, 3 Verzeichnisse");
  });

  it("feste Liste: mit Grund", () => {
    const text = formatLaunchInfo({ binary: "/opt/homebrew/bin/claude", origin: "fest", reason: "Timeout nach 5 s", dirs });
    expect(text).toContain("PATH: feste Liste (Timeout nach 5 s), 3 Verzeichnisse");
  });

  it("nicht gefunden: sagt es und listet die Verzeichnisse", () => {
    const text = formatLaunchInfo({ binary: null, origin: "login-shell", reason: null, dirs });
    expect(text).toContain("claude: nicht gefunden");
    for (const dir of dirs) expect(text).toContain(dir);
  });
});
