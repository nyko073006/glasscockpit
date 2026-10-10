// IDE-Brücke (Abend 16): Das Protokoll, mit dem Claude Code eine „IDE“ anspricht. Rein, ohne Netz und ohne Dateien.
// Clean-Room nach PROTOCOL.md (coder/claudecode.nvim) und der Probe vom 05.10.2026 (claude 2.1.289). Das Protokoll ist nicht
// offiziell dokumentiert und bei Updates schon gebrochen: Alles dazu liegt in src/core/ide-*.ts und src/host/ide-*.ts.
import { DIFF_TOOLS, type DiffToolResult, type OpenDiffArgs, parseOpenDiffArgs } from "./ide-diff";

/** Name im Lockfile und in serverInfo. Räumt auch die eigenen verwaisten Lockfiles auf. */
export const IDE_NAME = "Glasscockpit";
/** Header, in dem Claude Code den Token aus dem Lockfile mitschickt (kleingeschrieben, wie Node ihn liefert). */
export const IDE_AUTH_HEADER = "x-claude-code-ide-authorization";
/** WebSocket-Subprotokoll; Claude Code bietet es an und erwartet es in der Antwort. */
export const IDE_SUBPROTOCOL = "mcp";
/** Rückfall, falls der Client im initialize keine Version nennt (gemessen: claude 2.1.289 nennt 2025-11-25). */
export const IDE_FALLBACK_PROTOCOL_VERSION = "2025-11-25";
const SERVER_VERSION = "0.1.0";

export const RPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
} as const;

export type Id = string | number | null;
export type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

export type ParsedMessage =
  | { kind: "request"; id: string | number; method: string; params: unknown }
  | { kind: "notification"; method: string; params: unknown }
  | { kind: "response" }
  | { kind: "invalid"; id: Id; code: number; reason: string };

export interface RpcResponse {
  jsonrpc: "2.0";
  id: Id;
  result?: unknown;
  error?: { code: number; message: string };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string | number => typeof v === "string" || (typeof v === "number" && Number.isFinite(v));

/** Eine Textnachricht des Clients: Anfrage (mit id), Benachrichtigung (ohne), Antwort des Clients oder ungültig. */
export function parseMessage(text: string): ParsedMessage {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (fehler) {
    return { kind: "invalid", id: null, code: RPC.PARSE_ERROR, reason: fehler instanceof Error ? fehler.message : "kein JSON" };
  }
  if (!isObject(value)) return { kind: "invalid", id: null, code: RPC.INVALID_REQUEST, reason: "kein Objekt" };
  const id = isId(value.id) ? value.id : null;
  if (typeof value.method !== "string") {
    if (isId(value.id) && ("result" in value || "error" in value)) return { kind: "response" };
    return { kind: "invalid", id, code: RPC.INVALID_REQUEST, reason: "method fehlt" };
  }
  if (isId(value.id)) return { kind: "request", id: value.id, method: value.method, params: value.params };
  return { kind: "notification", method: value.method, params: value.params };
}

export const rpcResult = (id: Id, result: unknown): RpcResponse => ({ jsonrpc: "2.0", id, result });
export const rpcError = (id: Id, code: number, message: string): RpcResponse => ({ jsonrpc: "2.0", id, error: { code, message } });
export const notification = (method: string, params: unknown): { jsonrpc: "2.0"; method: string; params: unknown } => ({ jsonrpc: "2.0", method, params });

/** Antwort auf initialize: die Version, die der Client nennt (er lehnt andere ab), capabilities nur tools. */
export function initializeResult(clientVersion: unknown): {
  protocolVersion: string;
  capabilities: { tools: Record<string, never> };
  serverInfo: { name: string; version: string };
} {
  const version = typeof clientVersion === "string" && clientVersion.trim() !== "" ? clientVersion : IDE_FALLBACK_PROTOCOL_VERSION;
  return { protocolVersion: version, capabilities: { tools: {} }, serverInfo: { name: IDE_NAME, version: SERVER_VERSION } };
}

export const textResult = (text: string): ToolResult => ({ content: [{ type: "text", text }] });
/** Wie die VS-Code-Erweiterung: das Ergebnis als JSON-Text im content. */
export const jsonResult = (value: unknown): ToolResult => textResult(JSON.stringify(value));
const errorResult = (text: string): ToolResult => ({ ...textResult(text), isError: true });

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

const NO_INPUT: ToolDef["inputSchema"] = { type: "object", properties: {} };
const FILE_INPUT: ToolDef["inputSchema"] = {
  type: "object",
  properties: { filePath: { type: "string", description: "Pfad der Notiz, absolut oder relativ zum Vault" } },
  required: ["filePath"],
};

/**
 * Die Grundtools. openDiff, close_tab und closeAllDiffTabs (`DIFF_TOOLS`) kommen nur bei eingeschalteter Einstellung ideDiff
 * dazu (Abend 17): Wird openDiff angeboten, wartet Claude bei jeder Änderung auf eine Entscheidung in der IDE.
 */
export const IDE_TOOLS: ToolDef[] = [
  { name: "getCurrentSelection", description: "Get the current text selection in the active editor", inputSchema: { ...NO_INPUT } },
  { name: "getLatestSelection", description: "Get the most recent text selection (even if not in the active editor)", inputSchema: { ...NO_INPUT } },
  { name: "getOpenEditors", description: "Get information about the currently open editors", inputSchema: { ...NO_INPUT } },
  { name: "getWorkspaceFolders", description: "Get all workspace folders currently open in the IDE", inputSchema: { ...NO_INPUT } },
  { name: "openFile", description: "Open a note of the vault in the editor", inputSchema: { ...FILE_INPUT } },
  { name: "checkDocumentDirty", description: "Check if a document has unsaved changes", inputSchema: { ...FILE_INPUT } },
  { name: "saveDocument", description: "Save a document with unsaved changes", inputSchema: { ...FILE_INPUT } },
];

type Promised<T> = T | Promise<T>;
/** Eine Datei, schon geprüft: path ist vault-relativ, absolute der volle Pfad. */
export interface VaultFile { path: string; absolute: string }

/** Die Handler der Diff-Tools (Abend 17). openDiff blockiert, bis in der IDE entschieden ist. */
export interface DiffHandlers {
  openDiff(args: OpenDiffArgs, clientId: number | null): Promised<DiffToolResult>;
  /** Beide wirken nur auf Diffs der anfragenden Verbindung: Claude sendet closeAllDiffTabs zu Beginn jedes Zuges, und eine zweite Sitzung darf dadurch nicht abgelehnt werden. */
  closeTab(tabName: string, clientId: number | null): Promised<DiffToolResult>;
  closeAllDiffTabs(clientId: number | null): Promised<DiffToolResult>;
}

export interface IdeHandlers {
  getCurrentSelection(): Promised<ToolResult>;
  getLatestSelection(): Promised<ToolResult>;
  getOpenEditors(): Promised<ToolResult>;
  getWorkspaceFolders(): Promised<ToolResult>;
  openFile(file: VaultFile): Promised<ToolResult>;
  checkDocumentDirty(file: VaultFile): Promised<ToolResult>;
  saveDocument(file: VaultFile): Promised<ToolResult>;
  /** Nur gesetzt, wo die IDE Diffs zeigen kann; angeboten wird es zusätzlich nur bei diffEnabled. */
  diff?: DiffHandlers;
}

export interface DispatchContext {
  handlers: IdeHandlers;
  /** Vault-Ordner (absolut), gelesen bei jeder Anfrage; null, wenn unbekannt. */
  vaultBase: () => string | null;
  /** Einstellung ideDiff, bei jeder Anfrage frisch gelesen (wirkt ohne Neustart der Brücke). Fehlt sie, gilt aus. */
  diffEnabled?: () => boolean;
  /** Verbindung, von der die Anfrage kommt (für openDiff: Zuordnung zur Sitzung). */
  clientId?: number | null;
}

export type ResolvedPath = { ok: true; path: string; absolute: string } | { ok: false; reason: string };

/**
 * Pfad einer Notiz innerhalb des Vaults. Erlaubt: absolut unter dem Vault-Ordner oder relativ dazu. Abgelehnt: alles
 * Übrige, jedes Segment `..` (auch wenn der Pfad im Vault bliebe), leer, NUL-Zeichen, `~`, der Vault selbst.
 */
export function resolveInVault(base: string, input: string): ResolvedPath {
  const root = base.replace(/\/+$/, "");
  if (root === "") return { ok: false, reason: "Vault-Ordner unbekannt" };
  if (input.trim() === "") return { ok: false, reason: "Pfad ist leer" };
  if (input.includes("\0")) return { ok: false, reason: "Pfad enthält ein ungültiges Zeichen" };
  if (input.startsWith("~")) return { ok: false, reason: "Pfad liegt außerhalb des Vaults" };
  let rest = input;
  if (input.startsWith("/")) {
    if (!input.startsWith(`${root}/`)) return { ok: false, reason: "Pfad liegt außerhalb des Vaults" };
    rest = input.slice(root.length + 1);
  }
  const segments = rest.split("/").filter((s) => s !== "" && s !== ".");
  if (segments.includes("..")) return { ok: false, reason: "Pfad darf kein .. enthalten" };
  if (segments.length === 0) return { ok: false, reason: "Pfad zeigt keine Datei" };
  const path = segments.join("/");
  return { ok: true, path, absolute: `${root}/${path}` };
}

async function callTool(id: Id, params: unknown, ctx: DispatchContext): Promise<RpcResponse> {
  if (!isObject(params) || typeof params.name !== "string") return rpcError(id, RPC.INVALID_PARAMS, "Name des Tools fehlt");
  const name = params.name;
  const args = isObject(params.arguments) ? params.arguments : {};
  const h = ctx.handlers;
  try {
    if (DIFF_TOOLS.some((t) => t.name === name)) return await callDiffTool(id, name, args, ctx);
    switch (name) {
      case "getCurrentSelection": return rpcResult(id, await h.getCurrentSelection());
      case "getLatestSelection": return rpcResult(id, await h.getLatestSelection());
      case "getOpenEditors": return rpcResult(id, await h.getOpenEditors());
      case "getWorkspaceFolders": return rpcResult(id, await h.getWorkspaceFolders());
      case "openFile":
      case "checkDocumentDirty":
      case "saveDocument": {
        if (typeof args.filePath !== "string") return rpcError(id, RPC.INVALID_PARAMS, "filePath muss Text sein");
        const base = ctx.vaultBase();
        if (base === null) return rpcResult(id, errorResult("Vault-Ordner unbekannt"));
        const file = resolveInVault(base, args.filePath);
        if (!file.ok) return rpcResult(id, errorResult(file.reason));
        const target = { path: file.path, absolute: file.absolute };
        return rpcResult(id, await h[name](target));
      }
      default: return rpcError(id, RPC.INVALID_PARAMS, `Unbekanntes Tool: ${name}`);
    }
  } catch (fehler) {
    // Ein Fehler im Tool ist ein Ergebnis mit isError, kein Protokollfehler.
    return rpcResult(id, errorResult(fehler instanceof Error ? fehler.message : String(fehler)));
  }
}

/** openDiff, close_tab, closeAllDiffTabs: nur bei diffEnabled und gesetztem Handler, sonst wie ein unbekanntes Tool. */
async function callDiffTool(id: Id, name: string, args: Record<string, unknown>, ctx: DispatchContext): Promise<RpcResponse> {
  const diff = ctx.handlers.diff;
  if (!diff || !diffOffered(ctx)) return rpcError(id, RPC.INVALID_PARAMS, `Unbekanntes Tool: ${name}`);
  if (name === "openDiff") {
    const parsed = parseOpenDiffArgs(args);
    if (!parsed.ok) return rpcResult(id, errorResult(parsed.reason));
    return rpcResult(id, await diff.openDiff(parsed.args, ctx.clientId ?? null));
  }
  if (name === "close_tab") {
    if (typeof args.tab_name !== "string" || args.tab_name === "") return rpcResult(id, errorResult("tab_name muss Text sein"));
    return rpcResult(id, await diff.closeTab(args.tab_name, ctx.clientId ?? null));
  }
  return rpcResult(id, await diff.closeAllDiffTabs(ctx.clientId ?? null));
}

const diffOffered = (ctx: DispatchContext): boolean => ctx.handlers.diff !== undefined && ctx.diffEnabled?.() === true;

/** Eine Anfrage beantworten. Ohne id (Benachrichtigung) gibt es keine Antwort: null. */
export async function dispatchRequest(
  req: { id: Id | undefined; method: string; params: unknown },
  ctx: DispatchContext,
): Promise<RpcResponse | null> {
  if (req.id === undefined) return null;
  const id = req.id;
  switch (req.method) {
    case "initialize":
      return rpcResult(id, initializeResult(isObject(req.params) ? req.params.protocolVersion : undefined));
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: diffOffered(ctx) ? [...IDE_TOOLS, ...DIFF_TOOLS] : IDE_TOOLS });
    case "tools/call":
      return callTool(id, req.params, ctx);
    default:
      return rpcError(id, RPC.METHOD_NOT_FOUND, `Methode unbekannt: ${req.method}`);
  }
}

export interface Position { line: number; character: number }

export interface SelectionParams {
  text: string;
  filePath: string;
  fileUrl: string;
  selection: { start: Position; end: Position; isEmpty: boolean };
}

/** file://-URL: Segmente kodiert, Schrägstriche bleiben. */
export const fileUrl = (path: string): string => `file://${path.split("/").map(encodeURIComponent).join("/")}`;

/** Parameter von selection_changed (Felder wie in PROTOCOL.md). Zeilen und Spalten zählen ab 0. */
export function selectionParams(a: { filePath: string; text: string; start: Position; end: Position }): SelectionParams {
  const isEmpty = a.start.line === a.end.line && a.start.character === a.end.character;
  return { text: a.text, filePath: a.filePath, fileUrl: fileUrl(a.filePath), selection: { start: a.start, end: a.end, isEmpty } };
}

/** Parameter von at_mentioned (PROTOCOL.md: filePath, lineStart, lineEnd). */
export const atMentionParams = (filePath: string, lineStart: number, lineEnd: number): { filePath: string; lineStart: number; lineEnd: number } => ({
  filePath,
  lineStart,
  lineEnd,
});

/**
 * Zeilen für at_mentioned, 0-basiert wie in selection_changed (Claude Code zählt eins dazu: lineStart 1, lineEnd 2 wurde
 * in der Probe zu #L2-3). Endet eine mehrzeilige Auswahl am Anfang einer Zeile, gehört diese Zeile nicht mehr dazu.
 */
export function mentionLines(selection: SelectionParams["selection"]): { lineStart: number; lineEnd: number } {
  const { start, end } = selection;
  const lineEnd = end.line > start.line && end.character === 0 ? end.line - 1 : end.line;
  return { lineStart: start.line, lineEnd };
}

/** Inhalt von ~/.claude/ide/<port>.lock. pid ist die des Cockpits (Obsidian), nicht die der Claude-Sitzung. */
export function lockContent(a: { pid: number; workspaceFolders: string[]; authToken: string }): string {
  return JSON.stringify({ pid: a.pid, workspaceFolders: a.workspaceFolders, ideName: IDE_NAME, transport: "ws", authToken: a.authToken });
}

/** pid und ideName aus einem Lockfile (zum Aufräumen eigener Reste); alles Ungültige ergibt null. */
export function parseLock(text: string): { pid: number; ideName: string } | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(value) || typeof value.pid !== "number" || !Number.isInteger(value.pid) || typeof value.ideName !== "string") return null;
  return { pid: value.pid, ideName: value.ideName };
}

/** Vergleich in konstanter Zeit (über die längere der beiden Längen, kein früher Ausstieg). Leer gilt nie als gleich. */
export function tokenEquals(a: string, b: string): boolean {
  if (a === "" || b === "") return false;
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** Header-Wert gegen den Token: nur ein einzelner Wert zählt (mehrfach gesendete Header sind verdächtig). */
export function authorized(header: string | string[] | undefined, token: string): boolean {
  return typeof header === "string" && tokenEquals(header, token);
}

/** Umgebung, mit der Claude Code die IDE von selbst findet (Probe 05.10.2026: Verbindung ohne /ide). */
export const ideEnv = (port: number): Record<string, string> => ({ ENABLE_IDE_INTEGRATION: "true", CLAUDE_CODE_SSE_PORT: String(port) });
