// Reine Logik der Karte „Heute“: Aufgabe einfügen, drei Quellen zusammenführen. Kein Import von obsidian.
import { RULE, fenceStep, headingOf, type BriefingPoint } from "./focus";
import { splitFrontmatter } from "./frontmatter";
import type { DueReminder } from "./reminders";
import type { ReminderDone } from "./session-model";
import type { CockpitSettings } from "./settings";
import { isUnset } from "./unset";
import { LIST_PREFIX, bare, type TaskRow } from "./tasks";

export type TodayRow =
  | { kind: "source"; text: string }
  | { kind: "heading"; text: string; level: number }
  | { kind: "briefing"; key: string; text: string; done: boolean; locked: boolean }
  | { kind: "reminder"; id: string; text: string; done: boolean; since: string | null }
  | { kind: "task"; line: number; text: string; done: boolean; depth: number };

export interface TodayInput {
  briefing: BriefingPoint[];
  briefingDone: readonly string[];
  reminders: DueReminder[];
  remindersDone: readonly ReminderDone[];
  /** null = Datei fehlt. */
  tasks: TaskRow[] | null;
}

export interface TodayView {
  open: TodayRow[];
  done: TodayRow[];
  doneCount: number;
  total: number;
  openTexts: string[];
  tasksMissing: boolean;
}

/** Listenpunkt jeder Ebene. */
const ITEM = new RegExp(`^${LIST_PREFIX}`);

/**
 * Pfad des heutigen Briefings, wenn Briefing-Punkte aktiv sind: `<briefingsDir>/<today>.md`; null bei ausgeschaltetem
 * `todayBriefing` oder nicht gesetztem Ordner. Eine Bedingung für die Karte „Heute“ und das Abhaken in der Briefing-Karte.
 */
export function todayBriefingPath(s: Pick<CockpitSettings, "todayBriefing" | "briefingsDir">, today: string): string | null {
  if (!s.todayBriefing || isUnset(s.briefingsDir)) return null;
  return `${s.briefingsDir}/${today}.md`;
}

/** Merker der Briefing-Karte: Ändert er sich, lädt sie neu (Ordner, Schalter der Briefing-Punkte, Überschrift). */
export function briefingLoadKey(s: Pick<CockpitSettings, "briefingsDir" | "todayBriefing" | "focusHeading">): string {
  return JSON.stringify([s.briefingsDir, s.todayBriefing, s.focusHeading]);
}

/**
 * Fügt `- [ ] <text>` in die Aufgabenliste ein. `text` mit Umbrüchen zu Leerzeichen, getrimmt; leer ergibt null.
 * Überschrift wie im Briefing (ohne Groß/Klein, getrimmt, erste Fundstelle außerhalb von Codeblock und Frontmatter):
 * hinter den letzten Listenpunkt ihres Abschnitts (bis zur nächsten Überschrift jeder Ebene) samt allem, was zu ihm gehört
 * (eingerückte Zeilen auch nach Leerzeilen, eingerückt geöffnete Codeblöcke bis zum Zaun, Text direkt dahinter; ein nicht
 * eingerückter Absatz nach Leerzeile, ein nicht eingerückter Zaun oder eine Trennlinie schließt ihn), ohne Listenpunkt direkt
 * darunter (nach genau einer Leerzeile, wenn dort eine steht). Leeres `heading` oder keine Fundstelle: ans Dateiende.
 * Das Zeilenende der ersten Zeile gilt für die neue Zeile.
 */
export function insertTask(content: string, heading: string, text: string): string | null {
  const task = text.replace(/\r\n|\r|\n/g, " ").trim();
  if (task === "") return null;
  const lines = content.split("\n");
  const eol = lines.length > 1 && lines[0].endsWith("\r") ? "\r\n" : "\n";
  const newLine = `- [ ] ${task}`;
  const endsWithBreak = content.endsWith("\n");
  /** Zeilen ohne den leeren Rest hinter dem letzten Umbruch. */
  const real = endsWithBreak ? lines.length - 1 : lines.length;
  const atEnd = (): string => (content === "" ? "" : endsWithBreak ? content : content + eol) + newLine + eol;

  const wanted = heading.trim().toLowerCase();
  if (wanted === "") return atEnd();
  const offset = lines.length - splitFrontmatter(content).body.split("\n").length;
  const plain = (i: number): string => {
    const line = bare(lines[i]);
    return i === 0 && line.startsWith("\uFEFF") ? line.slice(1) : line;
  };

  let fence: string | null = null;
  let found = -1;
  /** Letzte Zeile, die zum letzten Listenpunkt gehört. */
  let last = -1;
  /** Ein Listenpunkt ist offen: eingerückte Zeilen (auch nach Leerzeilen) gehören noch zu ihm. */
  let itemOpen = false;
  /** Seit der letzten Zeile des offenen Punkts stand eine Leerzeile. */
  let blank = false;
  /** Der offene Codeblock wurde eingerückt im offenen Punkt geöffnet und gehört zu ihm. */
  let fenceInItem = false;
  for (let i = offset; i < real; i++) {
    const line = plain(i);
    const opening = fence === null;
    const step = fenceStep(fence, line);
    fence = step.fence;
    const indented = /^[ \t]/.test(line);
    if (step.code) {
      if (found < 0) continue;
      if (opening) {
        fenceInItem = itemOpen && indented;
        if (!fenceInItem) itemOpen = false;
      }
      if (fenceInItem) {
        last = i;
        blank = false;
      }
      continue;
    }
    const h = headingOf(line);
    if (found < 0) {
      if (h && h.text.toLowerCase() === wanted) found = i;
      continue;
    }
    if (h) break;
    if (line.trim() === "") {
      blank = true;
      continue;
    }
    const rule = RULE.test(line);
    if (!rule && ITEM.test(line)) {
      // Neuer Listenpunkt jeder Ebene, ein Unterpunkt bleibt Teil des offenen Punkts.
      last = i;
      itemOpen = true;
      blank = false;
    } else if (itemOpen && (indented || (!blank && !rule))) {
      // Eingerückt gehört zum Punkt, nicht eingerückter Text direkt dahinter ist Markdown-Fortsetzung.
      last = i;
      blank = false;
    } else itemOpen = false;
  }
  if (found < 0) return atEnd();
  let at = last >= 0 ? last + 1 : found + 1;
  if (last < 0 && at < real && plain(at).trim() === "") at++;
  if (at >= real && !endsWithBreak) return content + eol + newLine + eol;
  lines.splice(at, 0, newLine + (eol === "\r\n" ? "\r" : ""));
  return lines.join("\n");
}

/** Führt Briefing, Erinnerungen und Aufgabenliste zu einer Ansicht zusammen (offen in dieser Reihenfolge, dann Erledigt). */
export function todayView(i: TodayInput): TodayView {
  const open: TodayRow[] = [];
  const done: TodayRow[] = [];
  const briefingDone = new Set(i.briefingDone);

  const briefingOpen: TodayRow[] = [];
  for (const p of i.briefing) {
    if (p.fileDone) done.push({ kind: "briefing", key: p.key, text: p.text, done: true, locked: true });
    else if (briefingDone.has(p.key)) done.push({ kind: "briefing", key: p.key, text: p.text, done: true, locked: false });
    else briefingOpen.push({ kind: "briefing", key: p.key, text: p.text, done: false, locked: false });
  }
  if (briefingOpen.length > 0) open.push({ kind: "source", text: "Briefing" }, ...briefingOpen);

  if (i.reminders.length > 0) {
    open.push({ kind: "source", text: "Erinnerungen" });
    for (const r of i.reminders) open.push({ kind: "reminder", id: r.id, text: r.name, done: false, since: r.since });
  }
  const dueIds = new Set(i.reminders.map((r) => r.id));
  for (const r of i.remindersDone) {
    if (!dueIds.has(r.id)) done.push({ kind: "reminder", id: r.id, text: r.name, done: true, since: null });
  }

  let pendingHeading: TodayRow | null = null;
  for (const row of i.tasks ?? []) {
    if (row.kind === "heading") {
      pendingHeading = { kind: "heading", text: row.text, level: row.level };
      continue;
    }
    const task: TodayRow = { kind: "task", line: row.line, text: row.text, done: row.done, depth: row.depth };
    if (row.done) {
      done.push(task);
      continue;
    }
    if (pendingHeading !== null) open.push(pendingHeading);
    pendingHeading = null;
    open.push(task);
  }

  const points = open.filter((r) => r.kind !== "source" && r.kind !== "heading");
  return {
    open,
    done,
    doneCount: done.length,
    total: points.length + done.length,
    openTexts: points.map((r) => r.text),
    tasksMissing: i.tasks === null,
  };
}
