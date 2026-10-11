import {
  DEFAULT_ALERT_BANNER, DEFAULT_ALERT_GAP_MS, DEFAULT_BANNER_SECONDS, DEFAULT_HANDOFF_PREFIX, DEFAULT_BRIEFINGS_DIR, DEFAULT_CONTINUE_PROMPT, DEFAULT_PULL_INTERVAL_MIN, DEFAULT_ALERT_SOUND, DEFAULT_MARK_TAB, DEFAULT_MAX_SESSIONS,
  DEFAULT_NOTIFY_ON_DONE, DEFAULT_NOTIFY_ON_QUESTION, DEFAULT_PROJECTS_ROOT, DEFAULT_SOUND_FILE,
  DEFAULT_SKILL_BUTTONS, DEFAULT_TASKS_FILE, DEFAULT_RESUME_CONVERSATIONS, DEFAULT_REOPEN_AFTER_DISABLE, DEFAULT_FONT_SIZE, DEFAULT_SCROLLBACK, DEFAULT_MIN_CONTRAST,
  DEFAULT_TELEGRAM_CHAT_ID, DEFAULT_TELEGRAM_ENV_FILE, DEFAULT_TELEGRAM_IDLE_MIN, DEFAULT_TELEGRAM_ON_DONE, DEFAULT_TELEGRAM_ON_QUESTION,
  DEFAULT_USAGE_POLL_SEC, DEFAULT_WRITE_TOKENS_FILE, DEFAULT_RESEARCH_SEARCHES, DEFAULT_RESEARCH_MAX_AGE_MIN, DEFAULT_IDE_BRIDGE, DEFAULT_IDE_DIFF, DEFAULT_FIXED_PROMPT, DEFAULT_SKIP_PERMISSIONS,
  DASHBOARD_LAYOUTS, DEFAULT_DASHBOARD_LAYOUT, COCKPIT_CROPS, DEFAULT_COCKPIT_CROP,
  DEFAULT_CONTEXT_WARN, DEFAULT_CONTEXT_HANDOFF, DEFAULT_CLEARABLE_MIN_CONTEXT_PCT, DEFAULT_CLEARABLE_MIN_PROMPTS, DEFAULT_TOKENS_DAY_MEDIAN, DEFAULT_TOKENS_DAY_P90, DEFAULT_FOCUS_HEADING, DEFAULT_INBOX_DIR,
  DEFAULT_HUBS_DIR, DEFAULT_HANDOFFS_DIR, DEFAULT_HUB_SUFFIX, DEFAULT_HANDOFF_PROMPT,
  DEFAULT_INDEX_FILE, DEFAULT_LINT_AFTER_DAYS, DEFAULT_DAILY_DIR, DEFAULT_NEXT_EFFORT, DEFAULT_LINT_COMMAND, RADAR_SLOTS, EFFORT_STEPS,
} from "./constants";

export type DashboardLayout = (typeof DASHBOARD_LAYOUTS)[number];
export type CockpitCrop = (typeof COCKPIT_CROPS)[number];

/** Ein Radar: Anzeigename und Pfad seiner state.json (leerer Pfad = nicht eingerichtet). */
export interface RadarEntry { name: string; stateFile: string }

export interface CockpitSettings {
  projectsRoot: string; maxSessions: number; reopenAfterDisable: boolean; notifyOnDone: boolean; notifyOnQuestion: boolean;
  markTab: boolean; alertSound: boolean; alertBanner: boolean; soundFile: string; alertGapMs: number; bannerSeconds: number;
  briefingsDir: string; pullIntervalMin: number; continuePrompt: string;
  tasksFile: string; skillButtons: number; usagePollSec: number; writeTokensFile: boolean;
  resumeConversations: boolean; fixedPrompt: boolean; skipPermissions: boolean; fontSize: number; scrollback: number; minimumContrast: number;
  ideBridge: boolean; ideDiff: boolean; handoffPrefix: string;
  telegramOnDone: boolean; telegramOnQuestion: boolean; telegramEnvFile: string; telegramChatId: string; telegramIdleMin: number;
  researchSearches: string; researchMaxAgeMin: number;
  dashboardLayout: DashboardLayout;
  cockpitCrop: CockpitCrop;
  contextWarn: number; contextHandoff: number; clearableMinContextPct: number; clearableMinPrompts: number;
  tokensDayMedian: number; tokensDayP90: number;
  focusHeading: string; inboxDir: string; indexFile: string; lintAfterDays: number; dailyDir: string;
  nextEffort: (typeof EFFORT_STEPS)[number]; radars: RadarEntry[]; lintCommand: string;
  hubsDir: string; handoffsDir: string; hubSuffix: string; handoffPrompt: string;
}

export const DEFAULT_SETTINGS: CockpitSettings = {
  projectsRoot: DEFAULT_PROJECTS_ROOT,
  maxSessions: DEFAULT_MAX_SESSIONS,
  reopenAfterDisable: DEFAULT_REOPEN_AFTER_DISABLE,
  notifyOnDone: DEFAULT_NOTIFY_ON_DONE,
  notifyOnQuestion: DEFAULT_NOTIFY_ON_QUESTION,
  markTab: DEFAULT_MARK_TAB,
  alertSound: DEFAULT_ALERT_SOUND,
  alertBanner: DEFAULT_ALERT_BANNER,
  soundFile: DEFAULT_SOUND_FILE,
  alertGapMs: DEFAULT_ALERT_GAP_MS,
  bannerSeconds: DEFAULT_BANNER_SECONDS,
  briefingsDir: DEFAULT_BRIEFINGS_DIR,
  pullIntervalMin: DEFAULT_PULL_INTERVAL_MIN,
  continuePrompt: DEFAULT_CONTINUE_PROMPT,
  tasksFile: DEFAULT_TASKS_FILE,
  skillButtons: DEFAULT_SKILL_BUTTONS,
  usagePollSec: DEFAULT_USAGE_POLL_SEC,
  writeTokensFile: DEFAULT_WRITE_TOKENS_FILE,
  resumeConversations: DEFAULT_RESUME_CONVERSATIONS,
  fixedPrompt: DEFAULT_FIXED_PROMPT,
  skipPermissions: DEFAULT_SKIP_PERMISSIONS,
  fontSize: DEFAULT_FONT_SIZE,
  scrollback: DEFAULT_SCROLLBACK,
  minimumContrast: DEFAULT_MIN_CONTRAST,
  ideBridge: DEFAULT_IDE_BRIDGE,
  ideDiff: DEFAULT_IDE_DIFF,
  handoffPrefix: DEFAULT_HANDOFF_PREFIX,
  telegramOnDone: DEFAULT_TELEGRAM_ON_DONE,
  telegramOnQuestion: DEFAULT_TELEGRAM_ON_QUESTION,
  telegramEnvFile: DEFAULT_TELEGRAM_ENV_FILE,
  telegramChatId: DEFAULT_TELEGRAM_CHAT_ID,
  telegramIdleMin: DEFAULT_TELEGRAM_IDLE_MIN,
  researchSearches: DEFAULT_RESEARCH_SEARCHES,
  researchMaxAgeMin: DEFAULT_RESEARCH_MAX_AGE_MIN,
  dashboardLayout: DEFAULT_DASHBOARD_LAYOUT,
  cockpitCrop: DEFAULT_COCKPIT_CROP,
  contextWarn: DEFAULT_CONTEXT_WARN,
  contextHandoff: DEFAULT_CONTEXT_HANDOFF,
  clearableMinContextPct: DEFAULT_CLEARABLE_MIN_CONTEXT_PCT,
  clearableMinPrompts: DEFAULT_CLEARABLE_MIN_PROMPTS,
  tokensDayMedian: DEFAULT_TOKENS_DAY_MEDIAN,
  tokensDayP90: DEFAULT_TOKENS_DAY_P90,
  focusHeading: DEFAULT_FOCUS_HEADING,
  inboxDir: DEFAULT_INBOX_DIR,
  indexFile: DEFAULT_INDEX_FILE,
  lintAfterDays: DEFAULT_LINT_AFTER_DAYS,
  dailyDir: DEFAULT_DAILY_DIR,
  nextEffort: DEFAULT_NEXT_EFFORT,
  radars: [],
  lintCommand: DEFAULT_LINT_COMMAND,
  hubsDir: DEFAULT_HUBS_DIR,
  handoffsDir: DEFAULT_HANDOFFS_DIR,
  hubSuffix: DEFAULT_HUB_SUFFIX,
  handoffPrompt: DEFAULT_HANDOFF_PROMPT,
};

export interface SettingsParse { settings: CockpitSettings; invalid: string[] }

type Check = (value: unknown) => string | null;

/** Grenzen der ganzen Zahlen: die Seite prüft streng dagegen, beim Laden wird auf sie geklemmt. */
const RANGES = {
  maxSessions: [1, 50],
  alertGapMs: [0, 60000],
  bannerSeconds: [1, 60],
  pullIntervalMin: [0, 1440],
  skillButtons: [1, 30],
  usagePollSec: [10, 3600],
  fontSize: [8, 32],
  scrollback: [500, 100000],
  minimumContrast: [1, 21],
  telegramIdleMin: [0, 240],
  researchMaxAgeMin: [10, 1440],
  contextWarn: [1000, 1000000],
  contextHandoff: [1000, 1000000],
  clearableMinContextPct: [0, 100],
  clearableMinPrompts: [1, 50],
  tokensDayMedian: [1000, 100000000],
  tokensDayP90: [1000, 100000000],
  lintAfterDays: [1, 365],
} as const satisfies Partial<Record<keyof CockpitSettings, readonly [number, number]>>;

type RangedKey = keyof typeof RANGES;

const intIn = (min: number, max: number): Check => (v) =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? null : `ganze Zahl von ${min} bis ${max}`;
/** Beliebige endliche Zahl im Bereich (Dezimalwerte erlaubt). */
const numIn = (min: number, max: number): Check => (v) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? null : `Zahl von ${min} bis ${max}`;
/** Schlüssel mit Dezimalwerten: Klemmen beim Laden gilt auch für nicht ganze Zahlen. */
const DECIMAL_KEYS: ReadonlyArray<string> = ["minimumContrast"];
const nonEmpty: Check = (v) => (typeof v === "string" && v.trim() !== "" ? null : "darf nicht leer sein");
const flag: Check = (v) => (typeof v === "boolean" ? null : "muss an oder aus sein");

/** Vault-relativer Ordner: getrimmt, ohne führende und abschließende Schrägstriche. */
const stripSlashes = (v: string): string => v.trim().replace(/^\/+|\/+$/g, "").trim();

const text: Check = (v) => (typeof v === "string" ? null : "muss Text sein");

/** Segmente eines Vault-Pfads: `/` und `\` trennen, jedes Segment wird getrimmt (`a/ ../b` ist ein `..`). */
const segments = (path: string): string[] => path.split(/[\\/]/).map((p) => p.trim());

/** Grund, wenn ein Segment `..` oder `.` ist (`.` zeigt auf die Vault-Wurzel, git pull dort!), sonst null. */
function segmentProblem(path: string): string | null {
  const parts = segments(path);
  if (parts.includes("..")) return "darf kein .. enthalten";
  return parts.includes(".") ? "darf nicht auf die Vault-Wurzel zeigen (kein . als Ordner)" : null;
}

/** Vault-relativer Ordner: leer erlaubt (nicht eingerichtet), sonst kein `..` und kein `.`. */
const vaultDir: Check = (v) => {
  if (typeof v !== "string") return "muss Text sein";
  return segmentProblem(stripSlashes(v));
};

/** Vault-relative Markdown-Datei: leer erlaubt (nicht eingerichtet), sonst kein `..`/`.` und auf .md endend. */
const vaultMdFile: Check = (v) => {
  if (typeof v !== "string") return "muss Text sein";
  const path = stripSlashes(v);
  if (path === "") return null;
  return segmentProblem(path) ?? (path.endsWith(".md") ? null : "muss auf .md enden");
};

/** Ein gültiger Eintrag der Radar-Liste (Namen und Pfad Text, beide dürfen leer sein). */
const isRadarEntry = (e: unknown): e is RadarEntry =>
  typeof e === "object" && e !== null && !Array.isArray(e) && typeof (e as RadarEntry).name === "string" && typeof (e as RadarEntry).stateFile === "string";

const trimRadar = (e: RadarEntry): RadarEntry => ({ name: e.name.trim(), stateFile: e.stateFile.trim() });

const CHECKS: { [K in keyof CockpitSettings]: Check } = {
  projectsRoot: text,
  maxSessions: intIn(...RANGES.maxSessions),
  notifyOnDone: flag,
  notifyOnQuestion: flag,
  markTab: flag,
  alertSound: flag,
  alertBanner: flag,
  soundFile: nonEmpty,
  alertGapMs: intIn(...RANGES.alertGapMs),
  bannerSeconds: intIn(...RANGES.bannerSeconds),
  briefingsDir: vaultDir,
  pullIntervalMin: intIn(...RANGES.pullIntervalMin),
  continuePrompt: nonEmpty,
  tasksFile: (v) => {
    if (typeof v !== "string" || stripSlashes(v) === "") return "darf nicht leer sein";
    const path = stripSlashes(v);
    return segmentProblem(path) ?? (path.endsWith(".md") ? null : "muss auf .md enden");
  },
  skillButtons: intIn(...RANGES.skillButtons),
  usagePollSec: intIn(...RANGES.usagePollSec),
  writeTokensFile: flag,
  resumeConversations: flag,
  fixedPrompt: flag,
  skipPermissions: flag,
  reopenAfterDisable: flag,
  fontSize: intIn(...RANGES.fontSize),
  scrollback: intIn(...RANGES.scrollback),
  minimumContrast: numIn(...RANGES.minimumContrast),
  ideBridge: flag,
  ideDiff: flag,
  // Leer erlaubt (Knopf aus); sonst jeder Text. Das Präfix wird nur am Anfang der ersten nichtleeren Zeile eines Blocks verglichen.
  handoffPrefix: (v) => (typeof v === "string" ? null : "muss Text sein"),
  telegramOnDone: flag,
  telegramOnQuestion: flag,
  telegramEnvFile: nonEmpty,
  // Leer erlaubt (dann gilt allowFrom[0]); sonst nur Ziffern mit optionalem - vorn.
  telegramChatId: (v) => (typeof v === "string" && /^(-?\d+)?$/.test(v.trim()) ? null : "leer oder nur Ziffern, optional mit - vorn"),
  telegramIdleMin: intIn(...RANGES.telegramIdleMin),
  // Nur „muss Text sein“, leer erlaubt: eine ungültige Zeile blockiert das Speichern nicht, die Karte meldet sie je Zeile.
  researchSearches: (v) => (typeof v === "string" ? null : "muss Text sein"),
  researchMaxAgeMin: intIn(...RANGES.researchMaxAgeMin),
  dashboardLayout: (v) => ((DASHBOARD_LAYOUTS as readonly unknown[]).includes(v) ? null : "cockpit oder list"),
  cockpitCrop: (v) => ((COCKPIT_CROPS as readonly unknown[]).includes(v) ? null : "crop oder full"),
  contextWarn: intIn(...RANGES.contextWarn),
  contextHandoff: intIn(...RANGES.contextHandoff),
  clearableMinContextPct: intIn(...RANGES.clearableMinContextPct),
  clearableMinPrompts: intIn(...RANGES.clearableMinPrompts),
  tokensDayMedian: intIn(...RANGES.tokensDayMedian),
  tokensDayP90: intIn(...RANGES.tokensDayP90),
  focusHeading: (v) => (typeof v === "string" && v.trim() !== "" && !/[\r\n]/.test(v) ? null : "eine Zeile, nicht leer"),
  inboxDir: vaultDir,
  indexFile: vaultMdFile,
  lintAfterDays: intIn(...RANGES.lintAfterDays),
  dailyDir: vaultDir,
  nextEffort: (v) => ((EFFORT_STEPS as readonly unknown[]).includes(v) ? null : `eine der Stufen ${EFFORT_STEPS.join(", ")}`),
  radars: (v) => {
    if (!Array.isArray(v)) return "muss eine Liste sein";
    if (!v.every(isRadarEntry)) return "jeder Eintrag braucht Name und Pfad als Text";
    return v.length > RADAR_SLOTS ? `höchstens ${RADAR_SLOTS} Radare` : null;
  },
  // Beliebiger Text (Befehl oder Prompt), leer = Lint-Taste aus.
  lintCommand: text,
  hubsDir: vaultDir,
  handoffsDir: (v) => (typeof v !== "string" ? "muss Text sein" : v.trim() === "" ? null : /[\\/]/.test(v) || v.trim() === "." || v.trim() === ".." ? "ein Ordnername ohne Schrägstrich" : null),
  hubSuffix: (v) => (typeof v === "string" && v.endsWith(".md") ? null : "muss auf .md enden"),
  handoffPrompt: (v) => (typeof v !== "string" || v.trim() === "" ? "darf nicht leer sein" : v.trimStart().startsWith("-") ? "darf nicht mit - beginnen" : null),
};

const KEYS = Object.keys(CHECKS) as Array<keyof CockpitSettings>;

const TEXT_KEYS: ReadonlyArray<keyof CockpitSettings> = ["projectsRoot", "soundFile", "briefingsDir", "continuePrompt", "tasksFile", "telegramEnvFile", "telegramChatId", "focusHeading", "handoffPrefix", "lintCommand", "hubsDir", "handoffsDir", "handoffPrompt"];

/** Textwerte getrimmt, alles andere unverändert (nach bestandener Prüfung). */
export function normalizeSetting<K extends keyof CockpitSettings>(key: K, value: CockpitSettings[K]): CockpitSettings[K] {
  if ((key === "briefingsDir" || key === "tasksFile" || key === "inboxDir" || key === "indexFile" || key === "dailyDir" || key === "hubsDir") && typeof value === "string") return stripSlashes(value) as CockpitSettings[K];
  // Nur am Ende gekürzt: führende Leerzeilen bleiben, damit „Zeile N“ der Meldungen mit dem Feld übereinstimmt.
  if (key === "radars" && Array.isArray(value)) return value.map(trimRadar) as CockpitSettings[K];
  if (key === "researchSearches" && typeof value === "string") return value.trimEnd() as CockpitSettings[K];
  return TEXT_KEYS.includes(key) && typeof value === "string" ? (value.trim() as CockpitSettings[K]) : value;
}

export function validateSetting<K extends keyof CockpitSettings>(key: K, value: unknown): string | null {
  return CHECKS[key](value);
}

/**
 * Abhängigkeiten zwischen Einstellungen: Diffs laufen über die IDE-Brücke, ohne sie bleibt ideDiff aus. Die Schwellenpaare
 * müssen aufsteigen (Warnung unter Handoff, Median unter p90); ein Paar, das das nicht tut, fällt als Ganzes auf die Vorgaben.
 */
export function applyDependencies(s: CockpitSettings): CockpitSettings {
  let r = s.ideDiff && !s.ideBridge ? { ...s, ideDiff: false } : s;
  if (r.contextWarn >= r.contextHandoff) r = { ...r, contextWarn: DEFAULT_CONTEXT_WARN, contextHandoff: DEFAULT_CONTEXT_HANDOFF };
  if (r.tokensDayMedian >= r.tokensDayP90) r = { ...r, tokensDayMedian: DEFAULT_TOKENS_DAY_MEDIAN, tokensDayP90: DEFAULT_TOKENS_DAY_P90 };
  return r;
}

/** Grund, warum dieser Wert bei den übrigen Einstellungen nicht geht, sonst null. */
export function dependencyReason<K extends keyof CockpitSettings>(current: CockpitSettings, key: K, value: CockpitSettings[K]): string | null {
  if (key === "ideDiff" && value === true && !current.ideBridge) return "braucht die IDE-Brücke";
  if (typeof value !== "number") return null;
  if (key === "contextWarn" && value >= current.contextHandoff) return "muss unter der Handoff-Schwelle liegen";
  if (key === "contextHandoff" && value <= current.contextWarn) return "muss über der Warn-Schwelle liegen";
  if (key === "tokensDayMedian" && value >= current.tokensDayP90) return "muss unter dem p90 liegen";
  if (key === "tokensDayP90" && value <= current.tokensDayMedian) return "muss über dem Median liegen";
  return null;
}

/** Vorgaben als neues Objekt, die Radar-Liste nicht mit DEFAULT_SETTINGS geteilt. */
function freshDefaults(): CockpitSettings {
  return { ...DEFAULT_SETTINGS, radars: [] };
}

export function parseSettings(raw: unknown): SettingsParse {
  if (raw === undefined) return { settings: freshDefaults(), invalid: [] };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { settings: freshDefaults(), invalid: ["settings"] };
  }
  const obj = raw as Record<string, unknown>;
  const settings: Record<string, unknown> = { ...freshDefaults() };
  const invalid: string[] = [];
  settings.radars = [];
  for (const key of KEYS) {
    if (!(key in obj) || obj[key] === undefined) continue;
    if (key === "radars") {
      const r = parseRadars(obj.radars);
      settings.radars = r.radars;
      if (r.dropped) invalid.push("radars");
      continue;
    }
    const range = (RANGES as Record<string, readonly [number, number]>)[key as RangedKey];
    const value = obj[key];
    // Ganze Zahl außerhalb der Grenzen: auf die Grenze klemmen statt verwerfen. Alles andere prüft validateSetting.
    if (range && typeof value === "number" && (Number.isInteger(value) || (DECIMAL_KEYS.includes(key) && Number.isFinite(value)))) {
      settings[key] = Math.min(range[1], Math.max(range[0], value));
    } else if (validateSetting(key, obj[key]) === null) settings[key] = normalizeSetting(key, obj[key] as never);
    else invalid.push(key);
  }
  return { settings: applyDependencies(settings as unknown as CockpitSettings), invalid };
}

/** Gültige Einträge getrimmt, höchstens RADAR_SLOTS; `dropped`: etwas war ungültig oder zu viel und fiel weg. */
function parseRadars(value: unknown): { radars: RadarEntry[]; dropped: boolean } {
  if (!Array.isArray(value)) return { radars: [], dropped: true };
  const valid = value.filter(isRadarEntry).map(trimRadar);
  return { radars: valid.slice(0, RADAR_SLOTS), dropped: valid.length !== value.length || valid.length > RADAR_SLOTS };
}

/** "~" und "~/x" werden zu absoluten Pfaden; alles andere bleibt unverändert. */
export function expandHome(path: string, home: string): string {
  if (path === "~") return home;
  if (path.startsWith("~/")) return home + path.slice(1);
  return path;
}

/** Zahl aus einem Textfeld: leer (auch nur Leerzeichen) ergibt NaN, nicht 0; die Prüfung nennt dann den Grund. */
export function parseNumberInput(text: string): number {
  const t = text.trim();
  return t === "" ? NaN : Number(t);
}

/** Text unter dem Feld bei ungültiger Eingabe: Grund plus der Wert, der weiter gilt. */
export function invalidMessage(reason: string, current: unknown): string {
  return `${reason} (gilt weiter: ${String(current)})`;
}
