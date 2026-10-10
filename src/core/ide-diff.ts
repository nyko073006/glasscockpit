// Diff-Ansicht (Abend 17): Die drei Tools der IDE-Brücke, mit denen Claude Code einen Diff in der IDE zeigen lässt
// (openDiff, close_tab, closeAllDiffTabs). Rein. Clean-Room nach PROTOCOL.md (coder/claudecode.nvim) und der Probe vom
// 05.10.2026; nichts aus GPL-Paketen. Eigene Strukturtypen, damit ide-protocol.ts von hier importieren kann, nicht umgekehrt.

export interface DiffToolResult { content: Array<{ type: "text"; text: string }>; isError?: boolean }

export interface OpenDiffArgs {
  oldFilePath: string;
  newFilePath: string;
  newFileContents: string;
  tabName: string;
}
export type OpenDiffParse = { ok: true; args: OpenDiffArgs } | { ok: false; reason: string };

export interface DiffToolDef {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

/** Die Tools, die nur bei eingeschalteter Einstellung ideDiff angeboten werden. */
export const DIFF_TOOLS: DiffToolDef[] = [
  {
    name: "openDiff",
    description: "Open a diff view of the proposed changes (blocking until accepted or rejected)",
    inputSchema: {
      type: "object",
      properties: {
        old_file_path: { type: "string", description: "Path to the original file" },
        new_file_path: { type: "string", description: "Path to the file that is written on accept" },
        new_file_contents: { type: "string", description: "Contents of the new file" },
        tab_name: { type: "string", description: "Tab name for the diff view" },
      },
      required: ["old_file_path", "new_file_path", "new_file_contents", "tab_name"],
    },
  },
  {
    name: "close_tab",
    description: "Close a diff tab by its name",
    inputSchema: { type: "object", properties: { tab_name: { type: "string", description: "Name of the tab to close" } }, required: ["tab_name"] },
  },
  { name: "closeAllDiffTabs", description: "Close all diff tabs", inputSchema: { type: "object", properties: {} } },
];
export const DIFF_TOOL_NAMES: readonly string[] = DIFF_TOOLS.map((t) => t.name);

export type Decision = "accepted" | "rejected";

const text = (value: string): DiffToolResult => ({ content: [{ type: "text", text: value }] });

/** Pflichtfeld aus den Argumenten: Text, nicht leer (bei Pfaden und Tab-Namen), Pfade absolut und ohne NUL. */
function field(args: Record<string, unknown>, name: string, mayBeEmpty: boolean): { ok: true; value: string } | { ok: false; reason: string } {
  const v = args[name];
  if (typeof v !== "string") return { ok: false, reason: `${name} muss Text sein` };
  if (!mayBeEmpty && v.trim() === "") return { ok: false, reason: `${name} ist leer` };
  if (name.endsWith("_path") && v.includes("\0")) return { ok: false, reason: `${name} enthält ein ungültiges Zeichen` };
  if (name.endsWith("_path") && !v.startsWith("/")) return { ok: false, reason: `${name} muss ein absoluter Pfad sein` };
  return { ok: true, value: v };
}

/** Argumente von openDiff (Namen wie in PROTOCOL.md). Pfade müssen absolut sein: Geschrieben wird nur an genau new_file_path. */
export function parseOpenDiffArgs(args: Record<string, unknown>): OpenDiffParse {
  const oldFilePath = field(args, "old_file_path", false);
  if (!oldFilePath.ok) return oldFilePath;
  const newFilePath = field(args, "new_file_path", false);
  if (!newFilePath.ok) return newFilePath;
  const newFileContents = field(args, "new_file_contents", true);
  if (!newFileContents.ok) return newFileContents;
  const tabName = field(args, "tab_name", false);
  if (!tabName.ok) return tabName;
  return { ok: true, args: { oldFilePath: oldFilePath.value, newFilePath: newFilePath.value, newFileContents: newFileContents.value, tabName: tabName.value } };
}

/**
 * Antwort auf openDiff nach der Entscheidung in Obsidian. Gemessen am 05.10.2026 (claude 2.1.289, Probe
 * `scripts/ide-diff-probe.mjs`): Angenommen heißt `FILE_SAVED` plus ein zweiter Eintrag mit dem endgültigen Inhalt; aus ihm
 * schreibt Claude die Datei selbst, die IDE schreibt nichts. Nur `FILE_SAVED` ohne Inhalt lässt Claude zur Abfrage im
 * Terminal zurückfallen, die Datei bleibt unverändert. Abgelehnt: `DIFF_REJECTED`, Claude bricht den Zug ab.
 */
export function openDiffResult(decision: Decision, finalContents: string): DiffToolResult {
  if (decision === "rejected") return text("DIFF_REJECTED");
  return { content: [{ type: "text", text: "FILE_SAVED" }, { type: "text", text: finalContents }] };
}

export const closeTabResult = (): DiffToolResult => text("TAB_CLOSED");
export const closeAllResult = (count: number): DiffToolResult => text(`CLOSED_${count}_DIFF_TABS`);
