import { DIAG_SNAPSHOT_MS } from "./constants";
import type { SessionStats } from "./session-manager";

export interface FoundLine {
  index: number;
  text: string;
}

/** Messung an einer View: Kamen Daten an, stehen sie im xterm-Puffer, wurden sie gezeichnet? */
export interface PaneProbe {
  /** Datenportionen, die diese View an xterm übergeben hat (ohne Replay-Aufruf). */
  viewChunks: number;
  /** Zeichen im Replay beim Anhängen. */
  replayChars: number;
  bufferLine: FoundLine | null;
  domLine: FoundLine | null;
  cols: number;
  rows: number;
  widthPx: number;
  heightPx: number;
  renders: number;
}

export interface ViewDiagnosis {
  sessionId: string | null;
  session: SessionStats | null;
  /** Momentaufnahme DIAG_SNAPSHOT_MS nach dem Anhängen, null, solange sie fehlt. */
  early: PaneProbe | null;
  now: PaneProbe | null;
}

const MAX_LINE = 80;

/** Erste Zeile mit sichtbarem Text, Leerzeichen am Ende entfernt. */
export function firstNonEmptyLine(lines: readonly string[]): FoundLine | null {
  for (let index = 0; index < lines.length; index++) {
    const text = lines[index].trimEnd();
    if (text.trim() !== "") return { index, text };
  }
  return null;
}

function lineText(label: string, line: FoundLine | null): string {
  if (!line) return `    ${label}: (leer)`;
  const text = line.text.length > MAX_LINE ? `${line.text.slice(0, MAX_LINE)}…` : line.text;
  return `    ${label} Z${line.index}: ${text}`;
}

function probeLines(label: string, probe: PaneProbe | null, missing: string): string[] {
  if (!probe) return [`  ${label}: ${missing}`];
  return [
    `  ${label}: View ${probe.viewChunks} Portionen, Replay ${probe.replayChars} Zeichen, Renders ${probe.renders}, ` +
      `${probe.cols}x${probe.rows} bei ${probe.widthPx}x${probe.heightPx} px`,
    lineText("Puffer", probe.bufferLine),
    lineText("DOM", probe.domLine),
  ];
}

function sessionLine(view: ViewDiagnosis): string[] {
  if (view.sessionId === null) return [];
  const s = view.session;
  if (!s) return ["  PTY: nicht im Session-Manager"];
  const state = s.running ? "läuft" : `beendet (Exit ${s.exitCode})`;
  return [
    `  PTY: ${state}, ${s.chunks} Portionen, ${s.chars} Zeichen, Ring ${s.ringChars}, ` +
      `${s.cols}x${s.rows}, ${s.subscribers} Abonnent(en)`,
  ];
}

/**
 * Diagnosebericht aller Terminal-Views. Liest sich von oben nach unten:
 * PTY-Portionen (Daten kamen an), Puffer-Zeile (xterm hat sie), DOM-Zeile (gezeichnet).
 */
export function formatDiagnosis(views: readonly ViewDiagnosis[]): string {
  if (views.length === 0) return "Kein Terminal offen.";
  const early = `nach ${DIAG_SNAPSHOT_MS / 1000} s`;
  return views
    .map((view, i) =>
      [
        `Terminal ${i + 1}, ${view.sessionId === null ? "ohne Sitzung" : `Sitzung ${view.sessionId}`}`,
        ...sessionLine(view),
        ...probeLines(early, view.early, "keine Momentaufnahme"),
        ...probeLines("jetzt", view.now, "keine Pane"),
      ].join("\n"),
    )
    .join("\n\n");
}

/** Herkunft des PATH für den Claude-Start (Abend 5). */
export interface LaunchInfo {
  binary: string | null;
  origin: "login-shell" | "fest";
  /** Warum die Login-Shell nicht geliefert hat, nur bei origin "fest". */
  reason: string | null;
  dirs: readonly string[];
}

/** Kopf des Diagnoseberichts: Welches claude startet, und woher kommt der PATH? */
export function formatLaunchInfo(info: LaunchInfo): string {
  const origin = info.origin === "login-shell" ? "aus der Login-Shell" : `feste Liste (${info.reason ?? "ohne Grund"})`;
  const lines = [
    `claude: ${info.binary ?? "nicht gefunden"}`,
    `PATH: ${origin}, ${info.dirs.length} Verzeichnisse`,
  ];
  if (!info.binary) lines.push(...info.dirs.map((dir) => `  ${dir}`));
  return lines.join("\n");
}
