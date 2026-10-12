// Hintergrundaufgaben aus dem Transkript (Abend 28, Stille Zwischenstände): Agents, Workflows, Bash und MCP-Werkzeuge, die
// im Hintergrund laufen. Ein Antwortende, hinter dem noch etwas läuft, meldet nichts. Format gemessen am 12.10.2026 an
// 80 echten Transkripten (eine JSON-Zeile je Eintrag), rein ohne Obsidian und Dateizugriff.
//
// Start: Eintrag `user` mit tool_result-Block und dem Feld `toolUseResult` der obersten Ebene:
//   - Objekt mit status "async_launched" (Agent mit isAsync, Workflow mit taskType "local_workflow"),
//   - Objekt mit nichtleerem String `backgroundTaskId` (Bash im Hintergrund, auch nach Zeitlimit verschoben),
//   - Objekt mit nichtleerem String `resumedAgentId` (SendMessage setzt einen beendeten Agenten fort),
//   - Array (MCP-Werkzeug): nur am Text des tool_result, er enthält „was moved to the background“.
//   Bash-Ergebnisse ohne backgroundTaskId sind nie ein Start, auch wenn der stdout nach einem Start aussieht (grep-Ausgabe).
// Ende: ein `<task-notification>`-Block mit `<tool-use-id>` (dieselbe ID wie der Start) in Einträgen `user` (ohne tool_result),
//   `queue-operation` oder `attachment`. Jeder Status zählt. Einträge `assistant` zählen nie: Claude zitiert solche Blöcke.

import { MAX_BG_TASKS } from "./constants";

export interface BackgroundScan {
  /** Zeitpunkt in ms seit 1970, aus dem timestamp des Start-Eintrags; ohne gültigen timestamp zählt der Start nicht. */
  starts: { id: string; at: number }[];
  ends: string[];
}

const MOVED_TO_BACKGROUND = "was moved to the background";
const NOTIFICATION_BLOCK = /<task-notification>([\s\S]*?)<\/task-notification>/g;
const TOOL_USE_ID = /<tool-use-id>\s*([A-Za-z0-9_-]+)\s*<\/tool-use-id>/g;

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** Text eines tool_result: String oder Array aus {type:"text", text}-Blöcken. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => (isRecord(item) && item.type === "text" && typeof item.text === "string" ? item.text : ""))
    .join("\n");
}

/** Die tool_result-Blöcke eines user-Eintrags (leer, wenn message.content ein String oder ohne solche Blöcke ist). */
function toolResults(entry: Json): Json[] {
  const message = entry.message;
  if (!isRecord(message) || !Array.isArray(message.content)) return [];
  return message.content.filter((b): b is Json => isRecord(b) && b.type === "tool_result");
}

const nonEmpty = (v: unknown): boolean => typeof v === "string" && v !== "";

/**
 * toolUseResult als Objekt: Agent oder Workflow mit async_launched, Bash mit nichtleerer backgroundTaskId, SendMessage mit
 * nichtleerer resumedAgentId (der Agent läuft wieder im Hintergrund; gemessen 12.10.2026: 45 von 45 mit Fertig-Meldung, ohne
 * resumedAgentId 0 von 7).
 */
function launchedInBackground(result: unknown): boolean {
  if (!isRecord(result)) return false;
  if (result.status === "async_launched") return true;
  return nonEmpty(result.backgroundTaskId) || nonEmpty(result.resumedAgentId);
}

/** IDs der Starts in einem user-Eintrag mit tool_result-Blöcken. */
function startIds(entry: Json, blocks: Json[]): string[] {
  const result = entry.toolUseResult;
  // Mehrere Ergebnisse in einem Eintrag: toolUseResult ließe sich keinem Block sicher zuordnen. Dann zählt nur der MCP-Text.
  const objectStart = blocks.length === 1 && launchedInBackground(result);
  const ids: string[] = [];
  for (const block of blocks) {
    const id = block.tool_use_id;
    if (typeof id !== "string" || id === "") continue;
    const mcpStart = Array.isArray(result) && textOf(block.content).includes(MOVED_TO_BACKGROUND);
    if (objectStart || mcpStart) ids.push(id);
  }
  return ids;
}

/** IDs aller Fertig-Meldungen in der Rohzeile: nur `<tool-use-id>` innerhalb eines `<task-notification>`-Blocks. */
function endIds(line: string): string[] {
  const ids: string[] = [];
  for (const block of line.matchAll(NOTIFICATION_BLOCK)) {
    for (const hit of block[1].matchAll(TOOL_USE_ID)) ids.push(hit[1]);
  }
  return ids;
}

/**
 * Starts und Enden von Hintergrundaufgaben im Text eines Transkripts (oder seines gelesenen Endes). Kaputte und abgeschnittene
 * Zeilen entfallen. Jede ID steht höchstens einmal in jeder Liste; bei mehrfachem Start gewinnt der erste Zeitpunkt.
 */
export function scanBackgroundTasks(text: string): BackgroundScan {
  const starts = new Map<string, number>();
  const ends = new Set<string>();
  for (const line of text.split("\n")) {
    // Das meiste Transkript ist Text; nur Zeilen, die ein Ergebnis oder eine Fertig-Meldung sein können, werden gelesen.
    const mayStart = line.includes('"tool_result"');
    const mayEnd = line.includes("<task-notification>");
    if (!mayStart && !mayEnd) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // die erste Zeile eines gelesenen Endes ist meist abgeschnitten
    }
    if (!isRecord(entry)) continue;
    if (entry.type === "user") {
      const blocks = toolResults(entry);
      if (blocks.length === 0) {
        if (mayEnd) for (const id of endIds(line)) ends.add(id);
        continue;
      }
      // Ein Ergebnis kann nur starten, nie beenden: Sonst beendete eine grep-Ausgabe mit solchem Text fremde Aufgaben.
      const at = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : Number.NaN;
      if (Number.isNaN(at)) continue;
      for (const id of startIds(entry, blocks)) if (!starts.has(id)) starts.set(id, at);
    } else if ((entry.type === "queue-operation" || entry.type === "attachment") && mayEnd) {
      for (const id of endIds(line)) ends.add(id);
    }
  }
  return { starts: [...starts].map(([id, at]) => ({ id, at })), ends: [...ends] };
}

/**
 * Merkt Starts und Enden über mehrere Lesevorgänge, denn der Leser sieht nur das Ende der Datei. Beides ist auf MAX_BG_TASKS
 * begrenzt, damit der Speicher nicht wächst: Von den Starts fallen die ältesten zuerst raus (bei gleichem Zeitpunkt nach ID, damit
 * ein erneut gelesener Alt-Start nicht mit einem anderen tauscht), von den Enden zuerst die, deren Start unbekannt ist.
 */
export class BackgroundTasks {
  private readonly starts = new Map<string, number>();
  private readonly ends = new Set<string>();

  merge(scan: BackgroundScan): void {
    for (const s of scan.starts) if (!this.starts.has(s.id)) this.starts.set(s.id, s.at);
    for (const id of scan.ends) this.ends.add(id);
    this.trim();
  }

  /** Starts ohne Ende, die höchstens maxAgeMs alt sind (genau an der Grenze zählt noch). Ungültige Zahlen ergeben 0: im Zweifel melden. */
  open(nowMs: number, maxAgeMs: number): number {
    let count = 0;
    for (const [id, at] of this.starts) if (!this.ends.has(id) && nowMs - at <= maxAgeMs) count++;
    return count;
  }

  /** Für Tests: wie viele Starts und Enden gemerkt sind. */
  counts(): { starts: number; ends: number } {
    return { starts: this.starts.size, ends: this.ends.size };
  }

  private trim(): void {
    if (this.starts.size > MAX_BG_TASKS) {
      const oldestFirst = [...this.starts].sort(([idA, atA], [idB, atB]) => atA - atB || (idA < idB ? -1 : idA > idB ? 1 : 0));
      for (const [id] of oldestFirst.slice(0, this.starts.size - MAX_BG_TASKS)) this.starts.delete(id);
    }
    if (this.ends.size <= MAX_BG_TASKS) return;
    // Zuerst Enden ohne bekannten Start; mehr als MAX_BG_TASKS bekannte gibt es nicht, weil jeder Start höchstens ein Ende hat.
    for (const id of [...this.ends]) {
      if (this.ends.size <= MAX_BG_TASKS) return;
      if (!this.starts.has(id)) this.ends.delete(id);
    }
  }
}
