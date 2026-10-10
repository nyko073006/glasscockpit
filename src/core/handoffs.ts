import { readFrontmatter, splitFrontmatter, type YamlParse } from "./frontmatter";

/** Ein offener Handoff je Projekt (Abend 19h). repo: Ordner aus dem HUB, null = Start im Vault. */
export interface OpenHandoff { project: string; path: string; created: string; task: string; repo: string | null }
export interface HandoffSource { path: string; name: string; text: string }

const DAY = /^\d{4}-\d{2}-\d{2}$/;
// erstellt zeilenweise lesen: parseYaml kann ein unquotiertes Datum als Date liefern.
const CREATED = /^erstellt[ \t]*:[ \t]*["']?(\d{4}-\d{2}-\d{2})["']?[ \t]*$/;

function createdOf(frontmatter: string, name: string): string | null {
  for (const line of frontmatter.split("\n")) {
    const m = CREATED.exec(line);
    if (m) return m[1];
  }
  const head = name.slice(0, 10);
  return DAY.test(head) ? head : null;
}

export function newestOpen(project: string, repo: string | null, files: readonly HandoffSource[], parse: YamlParse): { item: OpenHandoff | null; errors: string[] } {
  const errors: string[] = [];
  let best: OpenHandoff | null = null;
  for (const f of files) {
    const { frontmatter } = splitFrontmatter(f.text);
    if (frontmatter === null) { errors.push(`Handoff ohne Frontmatter: ${f.path}`); continue; }
    const { fields } = readFrontmatter(f.text, parse);
    if (fields.status !== "offen") continue;
    const created = createdOf(frontmatter, f.name);
    if (!created) { errors.push(`Handoff ohne Datum: ${f.path}`); continue; }
    const item = { project, path: f.path, created, task: fields.naechster_auftrag ?? "", repo };
    if (!best || created > best.created || (created === best.created && f.path > best.path)) best = item;
  }
  return { item: best, errors };
}

export function expandHome(path: string, home: string): string {
  if (path === "~") return home;
  return path.startsWith("~/") ? `${home}${path.slice(1)}` : path;
}

export function sortHandoffs(items: readonly OpenHandoff[]): OpenHandoff[] {
  return [...items].sort((a, b) => (a.created === b.created ? a.project.localeCompare(b.project, "de") : a.created < b.created ? 1 : -1));
}

/** Ersetzt {datei} und {auftrag}; Funktion statt Text, damit $ wörtlich bleibt (wie fillPrompt). */
export function fillHandoffPrompt(template: string, v: { datei: string; auftrag: string }): string {
  return template.replace(/\{datei\}/g, () => v.datei).replace(/\{auftrag\}/g, () => v.auftrag);
}

const STATUS = /^status[ \t]*:(.*?)(\r?)$/;
const QUOTED = /^(?:"([^"]*)"|'([^']*)')[ \t]*(?:#.*)?$/;

/** Wert wie YAML: in Anführungszeichen alles bis zum schließenden; sonst bis zum Kommentar (" #", Leerraum davor nötig). */
function statusValue(raw: string): string {
  const v = raw.trim();
  const q = QUOTED.exec(v);
  if (q) return q[1] ?? q[2];
  return v.replace(/(^|[ \t]+)#.*$/, "").trim();
}
const TAKEN = /^aufgenommen[ \t]*:.*?(\r?)$/;

/** Setzt status: aufgenommen und aufgenommen: <day>; alle anderen Zeilen bleiben bytegleich. */
export function markTakenUp(text: string, day: string): { ok: true; content: string } | { ok: false; reason: string } {
  const lines = text.split("\n");
  if (lines[0]?.replace(/\r$/, "").replace(/^\uFEFF/, "") !== "---") return { ok: false, reason: "Handoff ohne Frontmatter" };
  const end = lines.findIndex((l, i) => i > 0 && l.replace(/\r$/, "") === "---");
  if (end < 0) return { ok: false, reason: "Handoff ohne Frontmatter" };
  let statusAt = -1; let takenAt = -1; let cr = "";
  for (let i = 1; i < end; i++) {
    const s = STATUS.exec(lines[i]);
    if (s && statusAt < 0) { if (statusValue(s[1]) !== "offen") return { ok: false, reason: "Handoff ist nicht offen" }; statusAt = i; cr = s[2]; }
    else if (TAKEN.test(lines[i]) && takenAt < 0) takenAt = i;
  }
  if (statusAt < 0) return { ok: false, reason: "Handoff ist nicht offen" };
  lines[statusAt] = `status: aufgenommen${cr}`;
  const taken = `aufgenommen: ${day}${cr}`;
  if (takenAt >= 0) lines[takenAt] = taken; else lines.splice(statusAt + 1, 0, taken);
  return { ok: true, content: lines.join("\n") };
}

export function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export interface StartWatch { onChange(cb: () => void): () => void; isRunning(): boolean; timeoutMs: number; setTimer(fn: () => void, ms: number): unknown; clearTimer(handle: unknown): void }

/** true, sobald isRunning() stimmt; false nach timeoutMs. Meldet sich in beiden Fällen ab.
 *  off/handle sind vorab deklariert: ruft onChange den Callback synchron auf, liegen sie sonst in der TDZ. */
export function awaitRunning(w: StartWatch): Promise<boolean> {
  if (w.isRunning()) return Promise.resolve(true);
  return new Promise((resolve) => {
    let done = false;
    let off: (() => void) | null = null;
    let handle: unknown = null;
    let armed = false;
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      off?.();
      if (armed) w.clearTimer(handle);
      resolve(v);
    };
    const unsubscribe = w.onChange(() => { if (w.isRunning()) finish(true); });
    if (done) unsubscribe(); else off = unsubscribe;
    if (done) return;
    handle = w.setTimer(() => finish(false), w.timeoutMs);
    armed = true;
  });
}

/** Gehört `path` zu den Handoffs (Handoff-Ordner oder HUB-Datei unter hubsDir)? Leere hubsDir/handoffsDir: nie; leerer hubSuffix zählt nicht. */
export function touchesHandoffs(path: string, s: { hubsDir: string; handoffsDir: string; hubSuffix: string }): boolean {
  const hubs = s.hubsDir.trim().replace(/^\/+|\/+$/g, "");
  const handoffs = s.handoffsDir.trim().replace(/^\/+|\/+$/g, "");
  if (hubs === "" || handoffs === "") return false;
  if (!path.startsWith(`${hubs}/`)) return false;
  return path.includes(`/${handoffs}/`) || (s.hubSuffix !== "" && path.endsWith(s.hubSuffix));
}
