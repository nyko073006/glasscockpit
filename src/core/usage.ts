/**
 * Usage-Karte (Abend 12). Die Limits kommen aus dem Schnappschuss der Statuszeile
 * (~/.claude/cockpit/usage.json, `{ written_at, rate_limits }`), gerechnet wird hier kein Fenster.
 * Aus den Transkripten kommen nur die Output-Tokens des lokalen Kalendertags.
 *
 * Transkriptformat (erkundet am 05.10.2026, claude 2.1.289): JSONL; zählen nur Zeilen `type: "assistant"`
 * mit `message.usage.output_tokens` und `timestamp` (ISO, UTC). Claude Code schreibt je Inhaltsblock eine
 * Zeile mit derselben `message.id`, frühe Zeilen tragen Zwischenstände; fortgesetzte Sitzungen kopieren
 * Zeilen samt altem Zeitstempel in neue Dateien. Deshalb: Schlüssel `message.id` über alle Dateien, höchster Wert.
 */

export type WindowKey = "five_hour" | "seven_day";

/** `resetsAt` in Unix-Sekunden, wie Claude Code es liefert. */
export interface UsageWindow { usedPercentage: number; resetsAt: number }
export interface UsageSnapshot { writtenAt: number | null; windows: Partial<Record<WindowKey, UsageWindow>> }

export interface UsageRow {
  key: WindowKey;
  label: string;
  expired: boolean;
  percent: number | null;
  remainingSec: number | null;
  text: string;
}
export interface UsageViewModel { rows: UsageRow[]; ageSec: number | null; ageText: string }

const WINDOWS: ReadonlyArray<[WindowKey, string]> = [["five_hour", "5 Stunden"], ["seven_day", "Woche"]];

export const RESET_TEXT = "zurückgesetzt, neuer Stand nach der nächsten Antwort";

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Tolerant: kaputt oder leer ergibt null; fehlt ein Fenster oder ist es kaputt, fehlt nur dieses. */
export function parseUsageSnapshot(text: string): UsageSnapshot | null {
  if (text.trim() === "") return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(raw)) return null;
  const limits = isObject(raw.rate_limits) ? raw.rate_limits : {};
  const windows: UsageSnapshot["windows"] = {};
  for (const [key] of WINDOWS) {
    const w = limits[key];
    if (isObject(w) && finite(w.used_percentage) && finite(w.resets_at)) {
      windows[key] = { usedPercentage: w.used_percentage, resetsAt: w.resets_at };
    }
  }
  return { writtenAt: finite(raw.written_at) ? raw.written_at : null, windows };
}

const plural = (n: number, eins: string, viele: string) => `${n} ${n === 1 ? eins : viele}`;

export function formatRemaining(sec: number): string {
  if (sec < 60) return "unter 1 Min.";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} Min.`;
  const std = Math.floor(min / 60);
  if (std < 24) return `${std} Std. ${min % 60} Min.`;
  return `${plural(Math.floor(std / 24), "Tag", "Tagen")} ${std % 24} Std.`;
}

export function formatAge(sec: number | null): string {
  if (sec === null) return "Alter unbekannt";
  if (sec < 60) return "gerade eben";
  if (sec < 3600) return `vor ${Math.floor(sec / 60)} Min.`;
  if (sec < 86400) return `vor ${Math.floor(sec / 3600)} Std.`;
  return `vor ${plural(Math.floor(sec / 86400), "Tag", "Tagen")}`;
}

/** Je Fenster Prozent und Restzeit; ist resets_at erreicht, gilt das Fenster als zurückgesetzt (keine alte Zahl). */
export function usageView(snapshot: UsageSnapshot, nowMs: number): UsageViewModel {
  const nowSec = nowMs / 1000;
  const rows: UsageRow[] = [];
  for (const [key, label] of WINDOWS) {
    const w = snapshot.windows[key];
    if (!w) continue;
    if (w.resetsAt <= nowSec) {
      rows.push({ key, label, expired: true, percent: null, remainingSec: null, text: RESET_TEXT });
      continue;
    }
    const percent = Math.min(100, Math.max(0, Math.round(w.usedPercentage)));
    const remainingSec = Math.floor(w.resetsAt - nowSec);
    rows.push({ key, label, expired: false, percent, remainingSec, text: `${percent} % · Reset in ${formatRemaining(remainingSec)}` });
  }
  const ageSec = snapshot.writtenAt === null ? null : Math.max(0, Math.floor(nowSec - snapshot.writtenAt));
  return { rows, ageSec, ageText: formatAge(ageSec) };
}

/** `tokensSub`: der Teil von `tokens`, der aus Sub-Agent-Zeilen stammt (Datei unter /subagents/ oder isSidechain). */
export interface TokenCount { tokens: number; tokensSub: number; skipped: number; lines: number }

/** Lokale Mitternacht des Tages von `now` (ms). */
export function localDayStart(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/** Nächste lokale Mitternacht; über das Datum statt +24 h, damit Umstellungstage stimmen. */
function localDayEnd(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
}

/**
 * Summe je Tag: Antworten nach `message.id` entdoppelt (höchster Wert), defekte Zeilen gezählt.
 * Sub-Agent-Zeile: Dateipfad enthält `/subagents/` oder die Zeile trägt `isSidechain: true` (Abend 19d).
 */
export class TokenTally {
  private readonly byId = new Map<string, { out: number; sub: boolean }>();
  private skipped = 0;
  private lines = 0;
  private readonly startMs: number;
  private readonly endMs: number;

  constructor(startMs: number, endMs: number) {
    this.startMs = startMs;
    this.endMs = endMs;
  }

  add(line: string, path = ""): void {
    if (line.trim() === "") return;
    this.lines++;
    let o: unknown;
    try {
      o = JSON.parse(line);
    } catch {
      this.skipped++;
      return;
    }
    if (!isObject(o)) {
      this.skipped++;
      return;
    }
    if (o.type !== "assistant") return;
    const m = o.message;
    const out = isObject(m) && isObject(m.usage) ? m.usage.output_tokens : undefined;
    if (!isObject(m) || !finite(out) || out < 0) {
      this.skipped++;
      return;
    }
    // Ohne Tokens gibt es nichts zu zählen (synthetische Zeilen haben 0 und teils keine ID).
    if (out === 0) return;
    const ts = typeof o.timestamp === "string" ? Date.parse(o.timestamp) : NaN;
    if (typeof m.id !== "string" || m.id === "" || Number.isNaN(ts)) {
      this.skipped++;
      return;
    }
    if (ts < this.startMs || ts >= this.endMs) return;
    const sub = path.includes("/subagents/") || o.isSidechain === true;
    // Höchstwert je message.id; der Sub-Merker gehört zur Zeile mit dem höchsten Wert.
    const alt = this.byId.get(m.id);
    if (!alt || out > alt.out) this.byId.set(m.id, { out, sub });
  }

  result(): TokenCount {
    let tokens = 0;
    let tokensSub = 0;
    for (const v of this.byId.values()) {
      tokens += v.out;
      if (v.sub) tokensSub += v.out;
    }
    return { tokens, tokensSub, skipped: this.skipped, lines: this.lines };
  }
}

export function outputTokensToday(lines: string[], now: Date): TokenCount {
  const tally = new TokenTally(localDayStart(now), localDayEnd(now));
  for (const line of lines) tally.add(line);
  return tally.result();
}

const NEWLINE = 0x0a;
const decoder = new TextDecoder();

/** Nur vollständige Zeilen; `consumed` in Bytes bis einschließlich des letzten Zeilenumbruchs. */
export function splitComplete(bytes: Uint8Array): { text: string; consumed: number } {
  const last = bytes.lastIndexOf(NEWLINE);
  if (last < 0) return { text: "", consumed: 0 };
  return { text: decoder.decode(bytes.subarray(0, last)), consumed: last + 1 };
}

export interface TranscriptFile { path: string; size: number; mtimeMs: number }
/** Dateizugriff für den Scanner. `read` liefert die Bytes [from, to) oder null, wenn die Datei fehlt. */
export interface TranscriptFs {
  list(): Promise<TranscriptFile[]>;
  read(path: string, from: number, to: number): Promise<Uint8Array | null>;
}

/**
 * Inkrementelles Lesen: je Datei die gelesene Größe merken und ab dort weiterlesen.
 * Nur heute geänderte Dateien. Neuer Tag oder geschrumpfte Datei: alles neu.
 */
export class TranscriptScanner {
  private dayStart = NaN;
  private tally = new TokenTally(0, 0);
  private offsets = new Map<string, number>();
  private readonly fs: TranscriptFs;

  constructor(fs: TranscriptFs) {
    this.fs = fs;
  }

  private reset(now: Date): void {
    this.dayStart = localDayStart(now);
    this.tally = new TokenTally(this.dayStart, localDayEnd(now));
    this.offsets = new Map();
  }

  async scan(now: Date): Promise<TokenCount> {
    if (localDayStart(now) !== this.dayStart) this.reset(now);
    const files = (await this.fs.list()).filter((f) => f.mtimeMs >= this.dayStart);
    if (files.some((f) => f.size < (this.offsets.get(f.path) ?? 0))) this.reset(now);
    for (const f of files) {
      const from = this.offsets.get(f.path) ?? 0;
      if (f.size <= from) continue;
      const bytes = await this.fs.read(f.path, from, f.size);
      if (!bytes) continue;
      const { text, consumed } = splitComplete(bytes);
      if (consumed === 0) continue;
      for (const line of text.split("\n")) this.tally.add(line, f.path);
      this.offsets.set(f.path, from + consumed);
    }
    return this.tally.result();
  }
}

/** Lesen nur bei sichtbarem Dashboard und frühestens `pollSec` nach dem letzten Lesen. */
export function usagePollDue(lastMs: number | null, nowMs: number, pollSec: number, visible: boolean): boolean {
  if (!visible) return false;
  return lastMs === null || nowMs - lastMs >= pollSec * 1000;
}

/** Lokaler Kalendertag als JJJJ-MM-TT (nicht UTC). */
export function localDayString(now: Date): string {
  const zwei = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${zwei(now.getMonth() + 1)}-${zwei(now.getDate())}`;
}

/** Inhalt von tokens-today.json: `written_at` in ganzen Unix-Sekunden, `day` lokal. Die Statuszeile liest genau diese Felder. */
export function tokensFileContent(count: TokenCount, now: Date): string {
  const o = {
    written_at: Math.floor(now.getTime() / 1000),
    day: localDayString(now),
    output_tokens: count.tokens,
    output_tokens_sub: count.tokensSub,
    skipped: count.skipped,
    lines: count.lines,
  };
  return `${JSON.stringify(o)}\n`;
}

export type CounterState = { kind: "loading" } | { kind: "ok"; count: TokenCount } | { kind: "error"; message: string };

export interface TokenCounterDeps {
  scan: (now: Date) => Promise<TokenCount>;
  /** Schreibt den Inhalt atomar in die Tagessummen-Datei. */
  write: (content: string) => Promise<void>;
  /** Gelesen bei jeder Nutzung, nie beim Start gemerkt. */
  settings: () => { writeTokensFile: boolean; usagePollSec: number };
  now: () => Date;
  /** Schreib- und Abonnentenfehler nur melden (Konsole), nie werfen. */
  log: (message: string) => void;
}

const errText = (fehler: unknown): string => (fehler instanceof Error ? fehler.message : String(fehler));

/**
 * Ein Zähler pro Plugin: hält den Stand der heutigen Output-Tokens, läuft im Takt von usagePollSec
 * unabhängig vom Dashboard und schreibt nach jedem Lauf die Tagessumme, wenn writeTokensFile an ist.
 * Den Takt (Timer) stellt der Host; hier zählt nur `requestRun`.
 */
export class TokenCounter {
  private readonly deps: TokenCounterDeps;
  private current: CounterState = { kind: "loading" };
  private lastRunMs: number | null = null;
  private okAt: number | null = null;
  private running: Promise<void> | null = null;
  private readonly subscribers = new Set<() => void>();

  constructor(deps: TokenCounterDeps) {
    this.deps = deps;
  }

  state(): CounterState {
    return this.current;
  }

  /** Zeit (ms) des letzten erfolgreichen Laufs, null solange keiner gelungen ist. */
  asOf(): number | null {
    return this.okAt;
  }

  /** Meldet sich an; der Rückgabewert meldet wieder ab. Aufgerufen nach jedem Lauf (auch bei Fehlern). */
  subscribe(cb: () => void): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  /** Startet einen Lauf, wenn der letzte älter als usagePollSec ist (oder keiner lief) und keiner läuft. */
  requestRun(): Promise<void> {
    if (this.running) return this.running;
    const now = this.deps.now();
    if (!usagePollDue(this.lastRunMs, now.getTime(), this.deps.settings().usagePollSec, true)) return Promise.resolve();
    this.lastRunMs = now.getTime();
    this.running = this.run(now).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run(now: Date): Promise<void> {
    try {
      const count = await this.deps.scan(now);
      this.current = { kind: "ok", count };
      this.okAt = now.getTime();
      if (this.deps.settings().writeTokensFile) {
        try {
          await this.deps.write(tokensFileContent(count, now));
        } catch (fehler) {
          this.deps.log(`Cockpit: tokens-today.json nicht geschrieben: ${errText(fehler)}`);
        }
      }
    } catch (fehler) {
      this.current = { kind: "error", message: errText(fehler) };
    }
    for (const cb of [...this.subscribers]) {
      try {
        cb();
      } catch (fehler) {
        this.deps.log(`Cockpit: Abonnent des Zählers gescheitert: ${errText(fehler)}`);
      }
    }
  }
}
