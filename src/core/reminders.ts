import { REMINDERS_TIMEOUT_MS } from "./constants";

/**
 * Erinnerungen der macOS-App „Erinnerungen“ (Abend 44), reine Logik: Skripttexte für osascript, Auswertung der Ausgabe,
 * Auswahl der fälligen Einträge und Fehlertexte. Den Aufruf macht src/host/reminders.ts.
 *
 * Gemessen an der echten App: Ein Apple-Event je Erinnerung ist unbrauchbar langsam (56 s für 20), deshalb holt das
 * Leseskript je Liste jede Eigenschaft als Stapel. Ein Fälligkeitsfilter im `whose` wirft -1700, deshalb filtert der Kern.
 * Datumswerte kommen als Jahr, Monat, Tag in Zahlen, nie `as string` (sprachabhängig).
 */

/** Feld- und Satztrenner der Skriptausgabe (ASCII 31 und 30), kommen in Namen praktisch nie vor. */
const FS = String.fromCharCode(31);
const RS = String.fromCharCode(30);

/**
 * Leseskript: alle offenen Erinnerungen aller Listen. Je Satz `id`, `name`, `liste`, `jahr`, `monat`, `tag`; ohne Fälligkeit
 * sind die drei Zahlen leer. Ganztägige Fälligkeit (`allday due date`) geht vor `due date`.
 */
export const REMINDERS_LIST_SCRIPT = `on run
  set FS to character id 31
  set RS to character id 30
  set out to {}
  tell application "Reminders"
    repeat with l in lists
      set ln to name of l
      set ids to id of (reminders of l whose completed is false)
      set nms to name of (reminders of l whose completed is false)
      set ads to allday due date of (reminders of l whose completed is false)
      set dds to due date of (reminders of l whose completed is false)
      if (count of ids) is not (count of nms) or (count of ids) is not (count of ads) or (count of ids) is not (count of dds) then error "Bestand hat sich während des Lesens geändert"
      repeat with i from 1 to count of ids
        set d to item i of ads
        if d is missing value then set d to item i of dds
        if d is missing value then
          set ymd to FS & FS
        else
          set ymd to ((year of d) as text) & FS & ((month of d as integer) as text) & FS & ((day of d) as text)
        end if
        set end of out to (item i of ids) & FS & (item i of nms) & FS & ln & FS & ymd
      end repeat
    end repeat
  end tell
  set AppleScript's text item delimiters to RS
  return out as text
end run`;

/**
 * Setzskript: setzt den Zielzustand (nie kippen). Werte nur als argv: id, "true" oder "false". Zugriff per `reminder id`
 * (diese Form läuft auf dem Mac schon in einem anderen Werkzeug); die `whose`-Suche über alle Erinnerungen ist ungemessen.
 */
export const REMINDERS_SET_SCRIPT = `on run argv
  tell application "Reminders" to set completed of reminder id (item 1 of argv) to ((item 2 of argv) is "true")
end run`;

export interface Reminder {
  id: string;
  name: string;
  list: string;
  /** Fälligkeit als JJJJ-MM-TT. */
  due: string;
}

export interface DueReminder extends Reminder {
  /** „TT.MM.“ der Fälligkeit, nur bei überfälligen Einträgen, sonst null. */
  since: string | null;
}

/** Zahl aus Ziffern, sonst null. */
function digits(text: string): number | null {
  return /^\d{1,4}$/.test(text) ? Number(text) : null;
}

/** JJJJ-MM-TT aus drei Zahlenfeldern, null bei leerem oder ungültigem Datum (auch 31.02.). */
function isoDate(y: string, m: string, d: string): string | null {
  const year = digits(y);
  const month = digits(m);
  const day = digits(d);
  if (year === null || month === null || day === null || year < 1000) return null;
  if (month < 1 || month > 12 || day < 1) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Ausgabe des Leseskripts. Verwirft Sätze mit anderer Feldzahl als 6, ohne id oder ohne gültiges Datum. */
export function parseReminders(out: string): Reminder[] {
  const result: Reminder[] = [];
  for (const record of out.split(RS)) {
    const fields = record.split(FS);
    if (fields.length !== 6) continue;
    const [rawId, rawName, rawList, y, m, d] = fields;
    const id = rawId.trim();
    if (id === "") continue;
    const due = isoDate(y.trim(), m.trim(), d.trim());
    if (due === null) continue;
    result.push({ id, name: rawName.replace(/\s+/g, " ").trim(), list: rawList.trim(), due });
  }
  return result;
}

/** Einstellung „Listen“: Komma-getrennt, getrimmt, Leeres raus. Leer = alle Listen. */
export function parseListNames(setting: string): string[] {
  return setting.split(",").map((s) => s.trim()).filter((s) => s !== "");
}

/**
 * Fällige Einträge für „heute“ (JJJJ-MM-TT vom Host): nur `due <= today`, ohne Überfällige nur `due === today`, bei nicht
 * leerer Listenauswahl nur diese Listen (ohne Groß/Klein, getrimmt). Sortiert nach Fälligkeit, dann Name.
 */
export function dueReminders(all: Reminder[], today: string, opts: { lists: string[]; overdue: boolean }): DueReminder[] {
  const wanted = new Set(opts.lists.map((l) => l.trim().toLowerCase()).filter((l) => l !== ""));
  return all
    .filter((r) => (opts.overdue ? r.due <= today : r.due === today))
    .filter((r) => wanted.size === 0 || wanted.has(r.list.trim().toLowerCase()))
    .map((r) => ({ ...r, since: r.due < today ? `${r.due.slice(8, 10)}.${r.due.slice(5, 7)}.` : null }))
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.name.localeCompare(b.name)));
}

const ERROR_MAX = 160;

/**
 * Kurztext für die Fehlerzeile der Karte: fehlender Zugriff (`(-1743)`, nur in Klammern, damit eine id mit dieser Ziffernfolge
 * nicht zählt), Zeitlimit, sonst erste Zeile.
 */
export function reminderErrorText(message: string): string {
  if (message.includes("(-1743)")) {
    return "Erinnerungen: Zugriff fehlt. Systemeinstellungen → Datenschutz & Sicherheit → Automation → Obsidian → Erinnerungen einschalten.";
  }
  if (/killed|ETIMEDOUT|SIGTERM/.test(message)) return `Erinnerungen: keine Antwort nach ${REMINDERS_TIMEOUT_MS / 1000} s`;
  const first = message.split(/\r?\n/)[0].trim();
  return `Erinnerungen: ${first.slice(0, ERROR_MAX)}`;
}
