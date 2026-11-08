import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ON_WINDOWS } from "./helpers/platform";

// Statuszeile (Abend 13, Teil B): das Skript statusline/statusline-command.sh wird als Prozess
// mit fester Eingabe per stdin aufgerufen. Uhr, Ordner und HOME sind überschrieben.

const SKRIPT = resolve(__dirname, "..", "statusline", "statusline-command.sh");

// Berlin, 05.10.2026 12:00 (MESZ = UTC+2).
const NOW = Date.UTC(2026, 9, 5, 10, 0, 0) / 1000;
const TAG = 86400;
const WOCHE = 7 * TAG;

const ESC = "\u001b";
const GELB = `${ESC}[0;33m`;
const ROT = `${ESC}[0;1;31m`;
const GRUEN = `${ESC}[0;32m`;

const aufraeumen: string[] = [];
afterEach(() => {
  while (aufraeumen.length) rmSync(aufraeumen.pop()!, { recursive: true, force: true });
});

function temp(): string {
  const d = mkdtempSync(join(tmpdir(), "statuszeile-"));
  aufraeumen.push(d);
  return d;
}

interface Limits {
  five?: { pct: number; resets: number };
  week?: { pct: number; resets: number };
}

const UUID = "90ef2efe-1234-4abc-8def-0123456789ab";

function eingabe(opts: { kontext?: number; limits?: Limits | null; sessionId?: unknown; api?: number } = {}): string {
  const kontext = opts.kontext ?? 82_000;
  const o: Record<string, unknown> = {
    model: { display_name: "Opus 5.5" },
    context_window: {
      current_usage: {
        input_tokens: 1,
        cache_creation_input_tokens: 1_000,
        cache_read_input_tokens: kontext - 1_001,
      },
      used_percentage: 41,
    },
  };
  if (opts.sessionId !== undefined) o.session_id = opts.sessionId;
  // Merker (Nachtrag 43e): aufsummierte Wartezeit auf API-Antworten in ms
  if (opts.api !== undefined) o.cost = { total_api_duration_ms: opts.api };
  const l = opts.limits;
  if (l) {
    const rl: Record<string, unknown> = {};
    if (l.five) rl.five_hour = { used_percentage: l.five.pct, resets_at: l.five.resets };
    if (l.week) rl.seven_day = { used_percentage: l.week.pct, resets_at: l.week.resets };
    o.rate_limits = rl;
  }
  return JSON.stringify(o);
}

/** Woche, die zu `zeitPct` Prozent verstrichen ist (nur glatte Werte verwenden). */
const woche = (pct: number, zeitPct: number) => ({
  pct,
  resets: NOW + WOCHE - Math.round((zeitPct / 100) * WOCHE),
});
const fuenf = (pct: number, rest = 2 * 3600 + 13 * 60 + 30) => ({ pct, resets: NOW + rest });

interface Lauf {
  out: string;
  plain: string;
  zeilen: string[];
  dir: string;
  home: string;
}

function lauf(
  stdin: string,
  opts: {
    now?: number;
    tokens?: string | object | null;
    homeBlockiert?: boolean;
    thresholds?: string | object | null;
    usage?: string | object | null;
    /** Dateien in <COCKPIT_DIR>/sessions vor dem Lauf (Name → Inhalt; String roh, Objekt als JSON). */
    sitzungen?: Record<string, string | object>;
    /** <COCKPIT_DIR>/sessions während des Laufs schreibgeschützt (0o555), danach wieder 0o755. */
    sitzungenGesperrt?: boolean;
    /** Ordner, der vor PATH steht (Attrappen wie ein scheiterndes mv). */
    pfadVorn?: string;
  } = {},
): Lauf {
  const dir = temp();
  const home = temp();
  if (opts.homeBlockiert) writeFileSync(join(home, ".claude"), "ich bin eine Datei");
  const u = opts.usage;
  if (u !== undefined && u !== null) {
    mkdirSync(join(home, ".claude", "cockpit"), { recursive: true });
    writeFileSync(join(home, ".claude", "cockpit", "usage.json"), typeof u === "string" ? u : JSON.stringify(u));
  }
  const t = opts.tokens;
  if (t !== undefined && t !== null) {
    writeFileSync(join(dir, "tokens-today.json"), typeof t === "string" ? t : JSON.stringify(t));
  }
  const th = opts.thresholds;
  if (th !== undefined && th !== null) {
    writeFileSync(join(dir, "thresholds.json"), typeof th === "string" ? th : JSON.stringify(th));
  }
  const sessions = join(dir, "sessions");
  if (opts.sitzungen) {
    mkdirSync(sessions, { recursive: true });
    for (const [name, inhalt] of Object.entries(opts.sitzungen)) {
      writeFileSync(join(sessions, name), typeof inhalt === "string" ? inhalt : JSON.stringify(inhalt));
    }
  }
  if (opts.sitzungenGesperrt) {
    mkdirSync(sessions, { recursive: true });
    chmodSync(sessions, 0o555);
  }
  const r = spawnSync("bash", [SKRIPT], {
    input: stdin,
    encoding: "utf8",
    env: {
      PATH: opts.pfadVorn ? `${opts.pfadVorn}:${process.env.PATH}` : process.env.PATH,
      HOME: home,
      TZ: "Europe/Berlin",
      LANG: "de_DE.UTF-8",
      COCKPIT_NOW: String(opts.now ?? NOW),
      COCKPIT_DIR: dir,
    },
  });
  if (opts.sitzungenGesperrt) chmodSync(sessions, 0o755);
  const out = r.stdout;
  // eslint-disable-next-line no-control-regex
  const plain = out.replace(/\u001b\[[0-9;]*m/g, "");
  return { out, plain, zeilen: plain.split("\n"), dir, home };
}

/** usage.json nach dem Lauf (HOME/.claude/cockpit/usage.json), geparst. */
const datei = (r: Lauf) => JSON.parse(readFileSync(join(r.home, ".claude", "cockpit", "usage.json"), "utf8"));

/** Sitzungsdatei von UUID nach dem Lauf (<COCKPIT_DIR>/sessions/<UUID>.json), geparst. */
const sitzung = (r: Lauf) => JSON.parse(readFileSync(join(r.dir, "sessions", `${UUID}.json`), "utf8"));

/** Vorige Sitzungsdatei von UUID mit Merker api_ms und Beobachtungszeit api_at (Nachtrag 43e). */
const vorher = (api_ms: unknown, api_at: unknown) => ({
  session_id: UUID,
  written_at: NOW - 30,
  context_tokens: 82_000,
  used_percentage: 41,
  model: "Opus 5.5",
  api_ms,
  api_at,
});

const heute = (n: number, alterSek = 30, day = "2026-10-05") => ({
  written_at: NOW - alterSek,
  day,
  output_tokens: n,
  skipped: 0,
  lines: 100,
});

// Windows: Skript läuft in bash und braucht jq (Inventur H13)
describe.skipIf(ON_WINDOWS)("Statuszeile: Zeile 1 und 2", () => {
  it("ohne rate_limits: nur Zeile 1, kein 5h-Teil, keine Wochenzeile, kein Zeilenumbruch am Ende", () => {
    const r = lauf(eingabe());
    expect(r.plain).toBe("Opus 5.5 │ 82k (41%)");
  });

  it("beide Fenster: Zeile 1 mit 5h und Restzeit, Zeile 2 mit Wochenbalken", () => {
    const r = lauf(eingabe({ limits: { five: fuenf(42), week: woche(38, 43) } }), { tokens: heute(340_000) });
    expect(r.zeilen).toEqual([
      "Opus 5.5 │ 82k (41%) │ 5h 42% · noch 2:13 │ heute 340k",
      "Woche ▓▓▓▓░░░░░░ 38% · Zeit 43% · im Plan",
    ]);
  });

  it("Zeile 2 ist gedimmt, Zeile 1 beginnt gedimmt", () => {
    const r = lauf(eingabe({ limits: { five: fuenf(42), week: woche(38, 43) } }));
    expect(r.out.startsWith(`${ESC}[0;2m`)).toBe(true);
    expect(r.out.split("\n")[1].startsWith(`${ESC}[0;2m`)).toBe(true);
  });

  it("nur 5h vorhanden: Wochenzeile entfällt", () => {
    const r = lauf(eingabe({ limits: { five: fuenf(42) } }));
    expect(r.zeilen).toEqual(["Opus 5.5 │ 82k (41%) │ 5h 42% · noch 2:13"]);
  });

  it("nur Woche vorhanden: 5h-Teil entfällt, Zeile 2 bleibt", () => {
    const r = lauf(eingabe({ limits: { week: woche(38, 43) } }));
    expect(r.zeilen).toEqual(["Opus 5.5 │ 82k (41%)", "Woche ▓▓▓▓░░░░░░ 38% · Zeit 43% · im Plan"]);
  });

  it("5h abgelaufen: „zurückgesetzt“ statt Restzeit", () => {
    const r = lauf(eingabe({ limits: { five: { pct: 97, resets: NOW - 60 }, week: woche(38, 43) } }));
    expect(r.zeilen[0]).toBe("Opus 5.5 │ 82k (41%) │ 5h zurückgesetzt");
    // der alte Stand löst keinen 5h-Hinweis mehr aus
    expect(r.zeilen[1]).toContain("im Plan");
  });

  it("5h genau jetzt erreicht zählt als zurückgesetzt", () => {
    const r = lauf(eingabe({ limits: { five: { pct: 50, resets: NOW } } }));
    expect(r.zeilen[0]).toContain("zurückgesetzt");
  });

  it("Restzeit: Minuten mit führender Null, ab 24 h Tage und Stunden", () => {
    expect(lauf(eingabe({ limits: { five: fuenf(10, 5 * 60 + 59) } })).zeilen[0]).toContain("noch 0:05");
    expect(lauf(eingabe({ limits: { five: fuenf(10, 4 * 3600 + 7 * 60) } })).zeilen[0]).toContain("noch 4:07");
    expect(lauf(eingabe({ limits: { five: fuenf(10, TAG + 5 * 3600 + 1) } })).zeilen[0]).toContain("noch 1d 5h");
    expect(lauf(eingabe({ limits: { five: fuenf(10, TAG - 1) } })).zeilen[0]).toContain("noch 23:59");
  });

  it("Wochenbalken: 10 Felder, auf ganze Felder gerundet, Rand 0 und 100", () => {
    const balken = (p: number) => lauf(eingabe({ limits: { week: woche(p, 43) } })).zeilen[1].split(" ")[1];
    expect(balken(0)).toBe("░░░░░░░░░░");
    expect(balken(38)).toBe("▓▓▓▓░░░░░░");
    expect(balken(45)).toBe("▓▓▓▓▓░░░░░");
    expect(balken(100)).toBe("▓▓▓▓▓▓▓▓▓▓");
  });
});

// Windows: Skript läuft in bash und braucht jq (Inventur H13)
describe.skipIf(ON_WINDOWS)("Statuszeile: Empfehlung", () => {
  it("Tempo vorn (Verbrauch 60 %, Zeit 43 %): nennt die Hebel", () => {
    const r = lauf(eingabe({ limits: { five: fuenf(10), week: woche(60, 43) } }));
    expect(r.zeilen[1]).toBe("Woche ▓▓▓▓▓▓░░░░ 60% · Zeit 43% · zu schnell: kein xhigh, Sonnet-Agents, früher übergeben");
  });

  it("Grenze: genau TEMPO_MARGIN (10 Punkte) vorn ist noch im Plan, 11 nicht", () => {
    expect(lauf(eingabe({ limits: { week: woche(53, 43) } })).zeilen[1]).toContain("im Plan");
    expect(lauf(eingabe({ limits: { week: woche(54, 43) } })).zeilen[1]).toContain("zu schnell");
  });

  it("Verbrauch hinter der Zeit: im Plan", () => {
    expect(lauf(eingabe({ limits: { week: woche(5, 43) } })).zeilen[1]).toContain("im Plan");
  });

  it("5h fast voll hat Vorrang vor Tempo", () => {
    const r = lauf(eingabe({ limits: { five: fuenf(95), week: woche(60, 43) } }));
    expect(r.zeilen[1]).toContain("5h fast voll");
    expect(r.zeilen[1]).not.toContain("kein xhigh");
  });

  it("Grenze FIVE_HOUR_WARN: 89 nicht, 90 ja", () => {
    expect(lauf(eingabe({ limits: { five: fuenf(89), week: woche(38, 43) } })).zeilen[1]).toContain("im Plan");
    expect(lauf(eingabe({ limits: { five: fuenf(90), week: woche(38, 43) } })).zeilen[1]).toContain("5h fast voll");
  });

  it("Woche abgelaufen: „zurückgesetzt“ statt Empfehlung", () => {
    const r = lauf(eingabe({ limits: { week: { pct: 90, resets: NOW - 5 } } }));
    expect(r.zeilen[1]).toContain("zurückgesetzt");
    expect(r.zeilen[1]).not.toContain("zu schnell");
  });
});

// Windows: Skript läuft in bash und braucht jq (Inventur H13)
describe.skipIf(ON_WINDOWS)("Statuszeile: Farben", () => {
  const farbeVon5h = (pct: number) => {
    const r = lauf(eingabe({ limits: { five: fuenf(pct) } }));
    for (const f of [GRUEN, GELB, ROT]) if (r.out.includes(`${f}${pct}%`)) return f;
    return null;
  };

  it("Ampel der 5h-Prozente: unter 70 grün, unter 90 gelb, sonst rot", () => {
    expect(farbeVon5h(69)).toBe(GRUEN);
    expect(farbeVon5h(70)).toBe(GELB);
    expect(farbeVon5h(89)).toBe(GELB);
    expect(farbeVon5h(90)).toBe(ROT);
  });

  it("Ampel gilt auch für den Wochenwert", () => {
    const r = lauf(eingabe({ limits: { week: woche(75, 43) } }));
    expect(r.out).toContain(`${GELB}75%`);
  });
});

// Windows: Skript läuft in bash und braucht jq (Inventur H13)
describe.skipIf(ON_WINDOWS)("Statuszeile: Kontextmarken", () => {
  it("149.999 Token: gedimmt, kein Gelb, kein HANDOFF", () => {
    const r = lauf(eingabe({ kontext: 149_999 }));
    expect(r.plain).toContain("149k");
    expect(r.out).not.toContain(GELB);
    expect(r.out).not.toContain(ROT);
    expect(r.plain).not.toContain("HANDOFF");
  });

  it("150.000 Token: gelb, noch kein HANDOFF", () => {
    const r = lauf(eingabe({ kontext: 150_000 }));
    expect(r.out).toContain(GELB);
    expect(r.out).not.toContain(ROT);
    expect(r.plain).not.toContain("HANDOFF");
  });

  it("174.999 Token: gelb ohne HANDOFF, 175.000: rot mit HANDOFF", () => {
    const knapp = lauf(eingabe({ kontext: 174_999 }));
    expect(knapp.plain).not.toContain("HANDOFF");
    expect(knapp.out).toContain(GELB);
    const voll = lauf(eingabe({ kontext: 175_000 }));
    expect(voll.plain).toContain("HANDOFF");
    expect(voll.out).toContain(`${ROT}`);
    expect(voll.plain).toContain("175k");
  });

  it("Kontext ist die Summe aus input, cache_creation und cache_read", () => {
    const r = lauf(
      JSON.stringify({
        model: { display_name: "X" },
        context_window: {
          current_usage: { input_tokens: 10_000, cache_creation_input_tokens: 20_000, cache_read_input_tokens: 30_000 },
          used_percentage: 12.4,
        },
      }),
    );
    expect(r.plain).toBe("X │ 60k (12%)");
  });

  it("fehlende current_usage: 0k, kein Absturz", () => {
    const r = lauf(JSON.stringify({ model: { display_name: "X" }, context_window: { used_percentage: null } }));
    expect(r.plain).toBe("X │ 0k (0%)");
  });
});

// Windows: Skript läuft in bash und braucht jq (Inventur H13)
describe.skipIf(ON_WINDOWS)("Statuszeile: Output-Tokens heute (tokens-today.json)", () => {
  const ohne = "Opus 5.5 │ 82k (41%)";

  it("frisch: „heute 340k“ ohne Alter", () => {
    expect(lauf(eingabe(), { tokens: heute(340_000) }).plain).toBe(`${ohne} │ heute 340k`);
  });

  it("Format: unter 1000 ganz, ab einer Million „1,2M“", () => {
    expect(lauf(eingabe(), { tokens: heute(850) }).plain).toBe(`${ohne} │ heute 850`);
    expect(lauf(eingabe(), { tokens: heute(999_999) }).plain).toBe(`${ohne} │ heute 999k`);
    expect(lauf(eingabe(), { tokens: heute(1_234_567) }).plain).toBe(`${ohne} │ heute 1,2M`);
    expect(lauf(eingabe(), { tokens: heute(2_000_000) }).plain).toBe(`${ohne} │ heute 2,0M`);
  });

  it("Summe von gestern wird nicht gezeigt", () => {
    expect(lauf(eingabe(), { tokens: heute(340_000, 30, "2026-10-04") }).plain).toBe(ohne);
  });

  it("lokaler Tag um Mitternacht: 00:30 Berlin ist noch UTC-Vortag, es zählt der lokale Tag", () => {
    const nachMitternacht = Date.UTC(2026, 9, 4, 22, 30, 0) / 1000; // 05.10. 00:30 Berlin
    const mit = lauf(eingabe(), {
      now: nachMitternacht,
      tokens: { ...heute(5_000), written_at: nachMitternacht - 20, day: "2026-10-05" },
    });
    expect(mit.plain).toBe(`${ohne} │ heute 5k`);
    const alt = lauf(eingabe(), {
      now: nachMitternacht,
      tokens: { ...heute(5_000), written_at: nachMitternacht - 20, day: "2026-10-04" },
    });
    expect(alt.plain).toBe(ohne);
  });

  it("Alter: bis 10 Minuten ohne Hinweis, danach mit Alter", () => {
    expect(lauf(eingabe(), { tokens: heute(340_000, 600) }).plain).toBe(`${ohne} │ heute 340k`);
    expect(lauf(eingabe(), { tokens: heute(340_000, 601) }).plain).toBe(`${ohne} │ heute 340k (vor 10 Min)`);
    expect(lauf(eingabe(), { tokens: heute(340_000, 25 * 60) }).plain).toBe(`${ohne} │ heute 340k (vor 25 Min)`);
    expect(lauf(eingabe(), { tokens: heute(340_000, 3 * 3600 + 10) }).plain).toBe(`${ohne} │ heute 340k (vor 3 Std)`);
  });

  it("Datei fehlt: Teil entfällt", () => {
    expect(lauf(eingabe()).plain).toBe(ohne);
  });

  it("Datei kaputt: Teil entfällt, Rest unverändert", () => {
    expect(lauf(eingabe(), { tokens: "{ das ist kein json" }).plain).toBe(ohne);
    expect(lauf(eingabe(), { tokens: "" }).plain).toBe(ohne);
    expect(lauf(eingabe(), { tokens: "[1,2,3]" }).plain).toBe(ohne);
    expect(lauf(eingabe(), { tokens: { ...heute(1), output_tokens: "viele" } }).plain).toBe(ohne);
    expect(lauf(eingabe(), { tokens: { day: "2026-10-05", output_tokens: 5 } }).plain).toBe(`${ohne} │ heute 5`);
  });

  describe("Anteil der Sub-Agents (Abend 19d)", () => {
    const mitSub = (n: number, sub: unknown, alterSek = 30) => ({ ...heute(n, alterSek), output_tokens_sub: sub });

    it("mit Feld: „heute 1,5M · Sub 63 %“ (955000 / 1524445 = 62,65 %, gerundet)", () => {
      expect(lauf(eingabe(), { tokens: mitSub(1_524_445, 955_000) }).plain).toBe(`${ohne} │ heute 1,5M · Sub 63 %`);
    });
    it("rundet ganzzahlig: 1 von 3 ergibt 33 %, 2 von 3 ergibt 67 %, 0 ergibt 0 %", () => {
      expect(lauf(eingabe(), { tokens: mitSub(3_000, 1_000) }).plain).toBe(`${ohne} │ heute 3k · Sub 33 %`);
      expect(lauf(eingabe(), { tokens: mitSub(3_000, 2_000) }).plain).toBe(`${ohne} │ heute 3k · Sub 67 %`);
      expect(lauf(eingabe(), { tokens: mitSub(3_000, 0) }).plain).toBe(`${ohne} │ heute 3k · Sub 0 %`);
    });
    it("die Altersangabe steht hinter dem Anteil", () => {
      expect(lauf(eingabe(), { tokens: mitSub(1_524_445, 955_000, 601) }).plain).toBe(`${ohne} │ heute 1,5M · Sub 63 % (vor 10 Min)`);
    });
    it("ohne Feld: Ausgabe bytegleich zu vorher", () => {
      const a = lauf(eingabe(), { tokens: heute(1_524_445) });
      expect(a.plain).toBe(`${ohne} │ heute 1,5M`);
      expect(a.out).toBe(lauf(eingabe(), { tokens: heute(1_524_445) }).out);
      expect(a.out).not.toContain("Sub");
    });
    it("output_tokens: 0 ergibt keinen Anteil (keine Division durch null)", () => {
      expect(lauf(eingabe(), { tokens: mitSub(0, 0) }).plain).toBe(`${ohne} │ heute 0`);
      expect(lauf(eingabe(), { tokens: mitSub(0, 5) }).plain).toBe(`${ohne} │ heute 0`);
    });
    it("ein String statt einer Zahl ergibt keinen Anteil", () => {
      expect(lauf(eingabe(), { tokens: mitSub(1_524_445, "955000") }).plain).toBe(`${ohne} │ heute 1,5M`);
      expect(lauf(eingabe(), { tokens: mitSub(1_524_445, null) }).plain).toBe(`${ohne} │ heute 1,5M`);
    });
  });

  it("ohne rate_limits steht „heute“ trotzdem in Zeile 1", () => {
    const r = lauf(eingabe(), { tokens: heute(340_000) });
    expect(r.zeilen).toHaveLength(1);
    expect(r.plain).toContain("heute 340k");
  });
});

describe("Statuszeile: Schnappschuss-Block und Laufzeit", () => {
  // Der Block ändert sich mit 43d bewusst (er führt mit usage.json zusammen); sein Verhalten sichern die
  // Tests unten und im Abschnitt „Limits zusammenführen“. Hier nur die Stelle: direkt nach input=$(cat).
  it("Schnappschuss-Block steht direkt nach input=$(cat)", () => {
    const z = readFileSync(SKRIPT, "utf8").split("\n");
    const i = z.findIndex((l) => l.trim() === "input=$(cat)");
    expect(i).toBeGreaterThan(0);
    expect(z[i + 1]).toBe("");
    expect(z[i + 2].startsWith("# Schnappschuss der Limits")).toBe(true);
  });

  // Windows: Skript läuft in bash und braucht jq (Inventur H13)
  it.skipIf(ON_WINDOWS)("Schnappschuss wird mit rate_limits geschrieben, ohne rate_limits nicht", () => {
    const mit = lauf(eingabe({ limits: { five: fuenf(42), week: woche(38, 43) } }));
    const datei = join(mit.home, ".claude", "cockpit", "usage.json");
    expect(existsSync(datei)).toBe(true);
    expect(JSON.parse(readFileSync(datei, "utf8")).rate_limits.five_hour.used_percentage).toBe(42);
    const ohne = lauf(eingabe());
    expect(existsSync(join(ohne.home, ".claude", "cockpit", "usage.json"))).toBe(false);
  });

  // Windows: Skript läuft in bash und braucht jq (Inventur H13)
  it.skipIf(ON_WINDOWS)("Ausgabe ist gleich, ob der Schnappschuss geschrieben werden konnte oder nicht", () => {
    const e = eingabe({ limits: { five: fuenf(42), week: woche(38, 43) } });
    const gut = lauf(e, { tokens: heute(340_000) });
    const blockiert = lauf(e, { tokens: heute(340_000), homeBlockiert: true });
    expect(blockiert.out).toBe(gut.out);
    expect(blockiert.out).not.toBe("");
    expect(existsSync(join(blockiert.home, ".claude", "cockpit"))).toBe(false);
  });

  // Windows: Skript läuft in bash, Ordner mit chmod 0o555 gesperrt (Inventur H13)
  it.skipIf(ON_WINDOWS)("Schnappschuss-Ordner schreibgeschützt: Ausgabe unverändert", () => {
    const e = eingabe({ limits: { five: fuenf(42), week: woche(38, 43) } });
    const gut = lauf(e);
    const home = temp();
    const cockpit = join(home, ".claude", "cockpit");
    mkdirSync(cockpit, { recursive: true });
    chmodSync(cockpit, 0o555);
    const dir = temp();
    const r = spawnSync("bash", [SKRIPT], {
      input: e,
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: home, TZ: "Europe/Berlin", COCKPIT_NOW: String(NOW), COCKPIT_DIR: dir },
    });
    chmodSync(cockpit, 0o755);
    expect(r.stdout).toBe(gut.out);
  });

  // Windows: Skript läuft in bash, jq-Attrappe ist ein bash-Skript mit chmod (Inventur H13)
  it.skipIf(ON_WINDOWS)("ein jq-Aufruf für die Statuszeile (Schnappschuss-Block und Sitzungsdatei zählen nicht mit; Schwellen werden im selben Aufruf gelesen)", () => {
    const bin = temp();
    const log = join(bin, "aufrufe.log");
    const echtes = spawnSync("bash", ["-c", "command -v jq"], { encoding: "utf8" }).stdout.trim();
    writeFileSync(join(bin, "jq"), `#!/bin/bash\necho x >> "${log}"\nexec "${echtes}" "$@"\n`);
    chmodSync(join(bin, "jq"), 0o755);
    const zaehle = (stdin: string, vorige?: object) => {
      rmSync(log, { force: true });
      const dir = temp();
      const home = temp();
      if (vorige) {
        mkdirSync(join(dir, "sessions"));
        writeFileSync(join(dir, "sessions", `${UUID}.json`), JSON.stringify(vorige));
      }
      spawnSync("bash", [SKRIPT], {
        input: stdin,
        encoding: "utf8",
        env: { PATH: `${bin}:${process.env.PATH}`, HOME: home, TZ: "Europe/Berlin", COCKPIT_NOW: String(NOW), COCKPIT_DIR: dir },
      });
      return readFileSync(log, "utf8").trim().split("\n").length;
    };
    // ohne rate_limits: Kopf, Sitzungsdatei, Statuszeile
    expect(zaehle(eingabe())).toBe(3);
    // mit rate_limits: Kopf, Sitzungsdatei, Zusammenführen, Statuszeile
    expect(zaehle(eingabe({ limits: { five: fuenf(42), week: woche(38, 43) } }))).toBe(4);
    // mit gültiger session_id, voriger Sitzungsdatei und rate_limits: Kopf, Sitzungsdatei, Zusammenführen, Statuszeile
    const mitVoriger = eingabe({ sessionId: UUID, api: 5000, limits: { five: fuenf(42), week: woche(38, 43) } });
    expect(zaehle(mitVoriger, vorher(1000, NOW - 60))).toBe(4);
  });
});

describe("Statuszeile: Vorgaben", () => {
  // Windows: Skript läuft in bash und braucht jq (Inventur H13)
  it.skipIf(ON_WINDOWS)("ohne COCKPIT_NOW und COCKPIT_DIR läuft das Skript mit echter Uhr und liest HOME/.claude/cockpit", () => {
    const home = temp();
    const cockpit = join(home, ".claude", "cockpit");
    mkdirSync(cockpit, { recursive: true });
    const jetzt = Math.floor(Date.now() / 1000);
    const tag = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
    writeFileSync(join(cockpit, "tokens-today.json"), JSON.stringify({ written_at: jetzt, day: tag, output_tokens: 7_000 }));
    const r = spawnSync("bash", [SKRIPT], {
      input: eingabe({ limits: { five: { pct: 10, resets: jetzt + 3600 + 5 * 60 + 30 } } }),
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: home, TZ: "Europe/Berlin" },
    });
    // eslint-disable-next-line no-control-regex
    expect(r.stdout.replace(/\u001b\[[0-9;]*m/g, "")).toBe("Opus 5.5 │ 82k (41%) │ 5h 10% · noch 1:05 │ heute 7k");
  });

  it("Schwellen stehen als Variablen oben im Skript", () => {
    const s = readFileSync(SKRIPT, "utf8");
    for (const v of ["TEMPO_MARGIN=10", "FIVE_HOUR_WARN=90", "CTX_WARN=150000", "CTX_HANDOFF=175000", "PCT_YELLOW=70", "PCT_RED=90", "WINDOW_SLACK=600", "WINDOW_LEN_5H=18000", "WINDOW_LEN_MAX=604800", "DROP_MIN=2", "OBS_SLACK=60"]) {
      expect(s).toContain(v);
    }
  });
});

describe("deploy:statusline", () => {
  it("npm-Skript vorhanden", () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "..", "package.json"), "utf8"));
    expect(pkg.scripts["deploy:statusline"]).toBe("node scripts/deploy-statusline.mjs");
  });

  // Windows: prüft den POSIX-Modus 0o755 der Kopie (Inventur H13)
  it.skipIf(ON_WINDOWS)("kopiert atomar mit Modus 755, ohne temporäre Reste, und ersetzt eine bestehende Datei", async () => {
    const { statSync, readdirSync } = await import("node:fs");
    const ziel = join(temp(), "neu", "statusline-command.sh");
    mkdirSync(join(ziel, ".."), { recursive: true });
    writeFileSync(ziel, "alt");
    const r = spawnSync("node", [resolve(__dirname, "..", "scripts", "deploy-statusline.mjs"), ziel], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(ziel, "utf8")).toBe(readFileSync(SKRIPT, "utf8"));
    expect(statSync(ziel).mode & 0o777).toBe(0o755);
    expect(readdirSync(join(ziel, ".."))).toEqual(["statusline-command.sh"]);
  });
});

// Was das Terminal an einer Textstelle zeigt: SGR-Codes nachspielen (0 Reset, 1 fett, 2 gedimmt, 22 normal, 3x Farbe, 39 Standard).
function stilAn(out: string, text: string): { fg: number | null; dim: boolean } {
  let fg: number | null = null;
  let dim = false;
  const zeichen: { c: string; fg: number | null; dim: boolean }[] = [];
  // eslint-disable-next-line no-control-regex
  const re = /\u001b\[([0-9;]*)m|([\s\S])/gu;
  for (let m = re.exec(out); m; m = re.exec(out)) {
    if (m[2] !== undefined) { zeichen.push({ c: m[2], fg, dim }); continue; }
    for (const p of (m[1] === "" ? "0" : m[1]).split(";").map(Number)) {
      if (p === 0) { fg = null; dim = false; }
      else if (p === 2) dim = true;
      else if (p === 22) dim = false;
      else if (p >= 30 && p <= 37) fg = p;
      else if (p === 39) fg = null;
    }
  }
  const i = zeichen.map((z) => z.c).join("").indexOf(text);
  if (i < 0) throw new Error(`Text nicht gefunden: ${text}`);
  return { fg: zeichen[i].fg, dim: zeichen[i].dim };
}

// Windows: Skript läuft in bash und braucht jq (Inventur H13)
describe.skipIf(ON_WINDOWS)("Statuszeile: Farbe endet mit dem Wert", () => {
  it("nach dem farbigen 5h-Wert ist der Rest wieder gedimmt ohne Farbe", () => {
    const r = lauf(eingabe({ limits: { five: fuenf(42), week: woche(38, 43) } }));
    expect(stilAn(r.out, "42%")).toEqual({ fg: 32, dim: false });
    expect(stilAn(r.out, " · noch")).toEqual({ fg: null, dim: true });
    expect(stilAn(r.out, " · Zeit")).toEqual({ fg: null, dim: true });
  });

  it("nach HANDOFF ist der 5h-Teil ohne Rot", () => {
    const r = lauf(eingabe({ kontext: 175_000, limits: { five: fuenf(42) } }));
    expect(stilAn(r.out, "HANDOFF").fg).toBe(31);
    expect(stilAn(r.out, " │ 5h")).toEqual({ fg: null, dim: true });
  });
});

// Windows: Skript läuft in bash und braucht jq (Inventur H13)
describe.skipIf(ON_WINDOWS)("Statuszeile: Sitzungsdatei (Abend 18)", () => {
  const sdir = (r: Lauf) => join(r.dir, "sessions");
  const datei = (r: Lauf) => join(sdir(r), `${UUID}.json`);
  const E = (extra: { kontext?: number; limits?: Limits | null; api?: number } = {}) => eingabe({ ...extra, sessionId: UUID });

  it("schreibt <COCKPIT_DIR>/sessions/<id>.json mit allen Feldern (written_at in Unix-Sekunden wie usage.json)", () => {
    const r = lauf(E({ kontext: 82_000 }));
    expect(existsSync(datei(r))).toBe(true);
    expect(JSON.parse(readFileSync(datei(r), "utf8"))).toEqual({
      session_id: UUID,
      written_at: NOW,
      context_tokens: 82_000,
      used_percentage: 41,
      model: "Opus 5.5",
      api_ms: null,
      api_at: null,
    });
    // mit Merker, ohne vorige Datei: api_ms ist der Merker, die Beobachtungszeit ist unbekannt (Nachtrag 43e)
    const mitMerker = lauf(E({ kontext: 82_000, api: 5000 }));
    expect(JSON.parse(readFileSync(datei(mitMerker), "utf8"))).toEqual({
      session_id: UUID,
      written_at: NOW,
      context_tokens: 82_000,
      used_percentage: 41,
      model: "Opus 5.5",
      api_ms: 5000,
      api_at: null,
    });
  });

  it("context_tokens ist derselbe Wert wie in der Statuszeile (input + cache_creation + cache_read)", () => {
    const r = lauf(
      JSON.stringify({
        session_id: UUID,
        model: { display_name: "X" },
        context_window: {
          current_usage: { input_tokens: 10_000, cache_creation_input_tokens: 20_000, cache_read_input_tokens: 30_000 },
          used_percentage: 12.4,
        },
      }),
    );
    expect(r.plain).toBe("X │ 60k (12%)");
    expect(JSON.parse(readFileSync(datei(r), "utf8")).context_tokens).toBe(60_000);
  });

  it("fehlende current_usage: 0 Token, Datei trotzdem da", () => {
    const r = lauf(JSON.stringify({ session_id: UUID, model: { display_name: "X" }, context_window: {} }));
    const j = JSON.parse(readFileSync(datei(r), "utf8"));
    expect(j.context_tokens).toBe(0);
    expect(j.used_percentage).toBe(0);
  });

  it("stdout ist bit-gleich mit und ohne Sitzungsdatei (auch mit rate_limits und Tokens)", () => {
    for (const k of [82_000, 160_000, 180_000]) {
      const mit = lauf(E({ kontext: k, limits: { five: fuenf(42), week: woche(38, 43) } }), { tokens: heute(340_000) });
      const ohne = lauf(eingabe({ kontext: k, limits: { five: fuenf(42), week: woche(38, 43) } }), { tokens: heute(340_000) });
      expect(existsSync(datei(mit))).toBe(true);
      expect(mit.out).toBe(ohne.out);
      expect(mit.out).not.toBe("");
    }
  });

  it("Sitzungsordner nicht beschreibbar: Ausgabe unverändert, kein Absturz", () => {
    const gut = lauf(eingabe());
    const dir = temp();
    writeFileSync(join(dir, "sessions"), "ich bin eine Datei, kein Ordner");
    const r = spawnSync("bash", [SKRIPT], {
      input: E(),
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: temp(), TZ: "Europe/Berlin", LANG: "de_DE.UTF-8", COCKPIT_NOW: String(NOW), COCKPIT_DIR: dir },
    });
    expect(r.stdout).toBe(gut.out);
    expect(r.status).toBe(0);
  });

  it("ungültige ID: keine Datei, nirgends (Pfad-Einschleusung)", () => {
    const ungueltig: unknown[] = [
      "../../evil", "../evil", "/etc/passwd", "abc", "", "90ef2efe-1234-4abc-8def-0123456789ab/../x",
      "90ef2efe-1234-4abc-8def-0123456789zz", `${UUID}\n`, ` ${UUID}`, `${UUID}x`, 42, null, { a: 1 },
    ];
    for (const id of ungueltig) {
      const r = lauf(eingabe({ sessionId: id }));
      expect(existsSync(sdir(r)), `ID ${JSON.stringify(id)}`).toBe(false);
      expect(readdirSync(r.dir)).toEqual([]);
      expect(r.plain).toBe("Opus 5.5 │ 82k (41%)");
    }
  });

  it("ohne session_id: keine Datei", () => {
    const r = lauf(eingabe());
    expect(existsSync(sdir(r))).toBe(false);
  });

  it("atomar: nach dem Lauf nur die Zieldatei, kein temporärer Rest; zweiter Lauf ersetzt sie", () => {
    const r = lauf(E({ kontext: 82_000 }));
    expect(readdirSync(sdir(r))).toEqual([`${UUID}.json`]);
    const r2 = spawnSync("bash", [SKRIPT], {
      input: E({ kontext: 99_000 }),
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: temp(), TZ: "Europe/Berlin", COCKPIT_NOW: String(NOW + 5), COCKPIT_DIR: r.dir },
    });
    expect(r2.status).toBe(0);
    expect(readdirSync(sdir(r))).toEqual([`${UUID}.json`]);
    const j = JSON.parse(readFileSync(datei(r), "utf8"));
    expect(j.context_tokens).toBe(99_000);
    expect(j.written_at).toBe(NOW + 5);
  });

  it("zwei Sitzungen: zwei Dateien", () => {
    const r = lauf(E());
    const andere = "11111111-2222-4333-8444-555555555555";
    spawnSync("bash", [SKRIPT], {
      input: eingabe({ sessionId: andere }),
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: temp(), COCKPIT_NOW: String(NOW), COCKPIT_DIR: r.dir },
    });
    expect(readdirSync(sdir(r)).sort()).toEqual([`${UUID}.json`, `${andere}.json`].sort());
  });
});

// Windows: Skript läuft in bash und braucht jq (Inventur H13)
describe.skipIf(ON_WINDOWS)("Statuszeile: thresholds.json (Festlegung 1)", () => {
  const ohneFarbe = (r: Lauf) => !r.out.includes(GELB) && !r.out.includes(ROT);

  it("gültig und niedriger: 100k ist gelb, 120k rot mit HANDOFF", () => {
    const th = { context_warn: 90_000, context_handoff: 110_000 };
    expect(lauf(eingabe({ kontext: 89_999 }), { thresholds: th }).out).not.toContain(GELB);
    expect(lauf(eingabe({ kontext: 90_000 }), { thresholds: th }).out).toContain(GELB);
    const rot = lauf(eingabe({ kontext: 110_000 }), { thresholds: th });
    expect(rot.plain).toContain("HANDOFF");
    expect(rot.out).toContain(ROT);
  });

  it("gültig und höher: 160k bleibt ungefärbt, kein HANDOFF bei 180k", () => {
    const th = { context_warn: 200_000, context_handoff: 250_000 };
    expect(ohneFarbe(lauf(eingabe({ kontext: 160_000 }), { thresholds: th }))).toBe(true);
    expect(lauf(eingabe({ kontext: 180_000 }), { thresholds: th }).plain).not.toContain("HANDOFF");
  });

  it("ohne Datei gelten die eingebauten Werte (150k gelb, 175k HANDOFF)", () => {
    expect(lauf(eingabe({ kontext: 150_000 })).out).toContain(GELB);
    expect(lauf(eingabe({ kontext: 175_000 })).plain).toContain("HANDOFF");
  });

  const ungueltig: [string, string | object][] = [
    ["kein JSON", "{ kaputt"],
    ["leer", ""],
    ["Array", "[1,2]"],
    ["Felder fehlen", {}],
    ["nur warn", { context_warn: 90_000 }],
    ["nur handoff", { context_handoff: 110_000 }],
    ["Strings", { context_warn: "90000", context_handoff: "110000" }],
    ["null", { context_warn: null, context_handoff: null }],
    ["Null", { context_warn: 0, context_handoff: 110_000 }],
    ["negativ", { context_warn: -5, context_handoff: 110_000 }],
    ["Dezimal", { context_warn: 90_000.5, context_handoff: 110_000 }],
    ["warn gleich handoff", { context_warn: 100_000, context_handoff: 100_000 }],
    ["warn größer handoff", { context_warn: 120_000, context_handoff: 100_000 }],
  ];
  for (const [name, th] of ungueltig) {
    it(`unsinnig (${name}): eingebaute Werte gelten, Ausgabe wie ohne Datei`, () => {
      for (const k of [100_000, 150_000, 175_000]) {
        const mit = lauf(eingabe({ kontext: k }), { thresholds: th });
        const ohne = lauf(eingabe({ kontext: k }));
        expect(mit.out).toBe(ohne.out);
      }
    });
  }

  it("die Schwellen gelten auch für die Sitzungsdatei-freie Zeile mit rate_limits (Zeile 2 unberührt)", () => {
    const e = eingabe({ kontext: 100_000, limits: { five: fuenf(42), week: woche(38, 43) } });
    const mit = lauf(e, { thresholds: { context_warn: 90_000, context_handoff: 110_000 } });
    expect(mit.zeilen[1]).toBe("Woche ▓▓▓▓░░░░░░ 38% · Zeit 43% · im Plan");
    expect(mit.out).toContain(GELB);
  });
});

// Nachtrag 43d: Jeder Tab schrieb bisher seinen eigenen Stand nach usage.json, der letzte Schreiber gewann,
// und ruhige Tabs setzten frischere Werte zurück. Das Skript führt jetzt je Fenster mit der Datei zusammen.
// Seit 43e der Fall „beide Beobachtungszeiten unbekannt“ (keine Sitzungsdatei, kein observed_at): Es gilt der höhere Wert.
describe.skipIf(ON_WINDOWS)("Statuszeile: Limits zusammenführen (Nachtrag 43d)", () => {
  const R5 = NOW + 3600;
  const RW = NOW + WOCHE / 2;
  const fenster = (pct: number, resets: number) => ({ used_percentage: pct, resets_at: resets });
  const usageDatei = (f: { five?: [number, number]; week?: [number, number] }) => ({
    written_at: NOW - 30,
    rate_limits: {
      ...(f.five ? { five_hour: fenster(...f.five) } : {}),
      ...(f.week ? { seven_day: fenster(...f.week) } : {}),
    },
  });
  const fuenfPct = (r: Lauf) => datei(r).rate_limits.five_hour.used_percentage;
  const wochePct = (r: Lauf) => datei(r).rate_limits.seven_day.used_percentage;

  it("ruhender Tab setzt nichts zurück (gemessen 27.10.: 0 % gegen 15 %)", () => {
    const r = lauf(eingabe({ limits: { five: { pct: 0, resets: R5 }, week: { pct: 92, resets: RW } } }), {
      usage: usageDatei({ five: [15, R5], week: [94, RW] }),
    });
    expect(r.plain).toContain("5h 15%");
    expect(r.zeilen[1]).toContain("94%");
    expect(fuenfPct(r)).toBe(15);
    expect(wochePct(r)).toBe(94);
  });

  it("eigener höherer Wert gewinnt", () => {
    const r = lauf(eingabe({ limits: { five: { pct: 16, resets: R5 } } }), { usage: usageDatei({ five: [15, R5] }) });
    expect(r.plain).toContain("5h 16%");
    expect(fuenfPct(r)).toBe(16);
  });

  it("neues Fenster schlägt altes mit höherem Wert", () => {
    const r = lauf(eingabe({ limits: { five: { pct: 2, resets: NOW + 5 * 3600 - 120 } } }), {
      usage: usageDatei({ five: [80, NOW - 60] }),
    });
    expect(r.plain).toContain("5h 2%");
    expect(fuenfPct(r)).toBe(2);
  });

  it("altes Fenster verliert gegen neueres aus der Datei", () => {
    const r = lauf(eingabe({ limits: { five: { pct: 80, resets: NOW - 60 } } }), {
      usage: usageDatei({ five: [3, NOW + 4 * 3600] }),
    });
    expect(r.plain).toContain("5h 3% · noch 4:00");
    expect(fuenfPct(r)).toBe(3);
  });

  it("Toleranz 600 s", () => {
    const usage = usageDatei({ five: [20, R5] });
    const gleich = lauf(eingabe({ limits: { five: { pct: 10, resets: R5 + 600 } } }), { usage });
    expect(gleich.plain).toContain("5h 20%");
    expect(fuenfPct(gleich)).toBe(20);
    const neuer = lauf(eingabe({ limits: { five: { pct: 10, resets: R5 + 601 } } }), { usage });
    expect(neuer.plain).toContain("5h 10%");
    expect(fuenfPct(neuer)).toBe(10);
    // Dateiseite: Datei 20 / R5 + 600 ist dasselbe Fenster wie eigen 30 / R5 (eigener höherer Wert), + 601 das neuere
    const eigen = eingabe({ limits: { five: { pct: 30, resets: R5 } } });
    const dateiGleich = lauf(eigen, { usage: usageDatei({ five: [20, R5 + 600] }) });
    expect(dateiGleich.plain).toContain("5h 30%");
    expect(fuenfPct(dateiGleich)).toBe(30);
    const dateiNeuer = lauf(eigen, { usage: usageDatei({ five: [20, R5 + 601] }) });
    expect(dateiNeuer.plain).toContain("5h 20%");
    expect(fuenfPct(dateiNeuer)).toBe(20);
  });

  it("Fenster nur in der Datei bleibt", () => {
    const r = lauf(eingabe({ limits: { five: { pct: 10, resets: R5 } } }), { usage: usageDatei({ week: [94, RW] }) });
    expect(r.zeilen).toHaveLength(2);
    expect(r.zeilen[1]).toContain("94%");
    expect(wochePct(r)).toBe(94);
    expect(fuenfPct(r)).toBe(10);
  });

  it("kaputte Datei: eigener Stand", () => {
    const e = eingabe({ limits: { five: { pct: 30, resets: R5 }, week: { pct: 38, resets: RW } } });
    const ohne = lauf(e);
    const kaputt: Array<string | object> = [
      "kein json",
      { rate_limits: "x" },
      { rate_limits: { five_hour: { used_percentage: 99 } } },
      "42",
      "[]",
      { rate_limits: { five_hour: { used_percentage: 99, resets_at: "x" } } },
    ];
    for (const usage of kaputt) {
      const r = lauf(e, { usage });
      expect(r.out, JSON.stringify(usage)).toBe(ohne.out);
      expect(fuenfPct(r), JSON.stringify(usage)).toBe(30);
    }
  });

  it("ohne eigenes rate_limits bleibt die Datei unberührt", () => {
    const usage = usageDatei({ five: [15, R5], week: [94, RW] });
    const r = lauf(eingabe(), { usage });
    expect(r.zeilen).toHaveLength(1);
    expect(r.plain).not.toContain("5h");
    expect(readFileSync(join(r.home, ".claude", "cockpit", "usage.json"), "utf8")).toBe(JSON.stringify(usage));
  });

  it("Unsinnig spätes Fenster in der Datei hält nicht", () => {
    const r = lauf(eingabe({ limits: { five: { pct: 41, resets: R5 } } }), { usage: usageDatei({ five: [0, 9_999_999_999] }) });
    expect(r.plain).toContain("5h 41%");
    expect(fuenfPct(r)).toBe(41);
  });

  it("Obergrenze des 5h-Fensters: Fensterlänge plus 600 s", () => {
    // Datei 5h 3 / NOW + 18000 + 600 gilt und ist gegen eigen 50 / R5 das neuere Fenster
    const e = eingabe({ limits: { five: { pct: 50, resets: R5 } } });
    const gilt = lauf(e, { usage: usageDatei({ five: [3, NOW + 18_000 + 600] }) });
    expect(gilt.plain).toContain("5h 3%");
    expect(fuenfPct(gilt)).toBe(3);
    const zuSpaet = lauf(e, { usage: usageDatei({ five: [3, NOW + 18_000 + 601] }) });
    expect(zuSpaet.plain).toContain("5h 50%");
    expect(fuenfPct(zuSpaet)).toBe(50);
  });

  it("Obergrenze der Woche: Fensterlänge plus 600 s", () => {
    const e = eingabe({ limits: { week: { pct: 40, resets: RW } } });
    const gilt = lauf(e, { usage: usageDatei({ week: [3, NOW + WOCHE + 600] }) });
    expect(gilt.zeilen[1]).toContain(" 3% ");
    expect(wochePct(gilt)).toBe(3);
    const zuSpaet = lauf(e, { usage: usageDatei({ week: [3, NOW + WOCHE + 601] }) });
    expect(zuSpaet.zeilen[1]).toContain(" 40% ");
    expect(wochePct(zuSpaet)).toBe(40);
  });

  it("Zu große Datei: eigener Stand wird geschrieben", () => {
    // Eine Datei von rund 2 MB sprengt die Argumentgrenze des Zusammenführens; ohne Rückfall bliebe nichts geschrieben
    const r = lauf(eingabe({ limits: { five: { pct: 41, resets: R5 } } }), { usage: "x".repeat(2_000_000) });
    expect(r.plain).toContain("5h 41%");
    expect(fuenfPct(r)).toBe(41);
  });
});

// Nachtrag 43e: Nach einem Planwechsel hielt Regel 4 aus 43d („im selben Fenster der höhere Wert“) den alten
// hohen Wert fest. Jede Sitzung schätzt jetzt aus dem Merker cost.total_api_duration_ms, wann ihr Stand entstand
// (api_at in der Sitzungsdatei, observed_at je Fenster in usage.json). Merker in ms; der Stempel ist jetzt minus
// der Zuwachs in ganzen Sekunden. Im selben Fenster gilt der höhere Wert, außer die jüngere Beobachtung liegt
// mindestens DROP_MIN (2) Punkte darunter.
describe.skipIf(ON_WINDOWS)("Statuszeile: jüngere Beobachtung (Nachtrag 43e)", () => {
  const R5 = NOW + 3600;
  const RW = NOW + WOCHE / 2;
  /** Fenster für usage.json; observed_at nur, wenn angegeben. */
  const fenster = (pct: number | null, resets: number, observed?: number) => ({
    used_percentage: pct,
    resets_at: resets,
    ...(observed === undefined ? {} : { observed_at: observed }),
  });
  const usage = (rate_limits: Record<string, object>) => ({ written_at: NOW - 30, rate_limits });
  /** Vorige Sitzungsdatei von UUID. */
  const vorige = (inhalt: string | object) => ({ [`${UUID}.json`]: inhalt });
  /** Eingabe von UUID mit Merker (undefined: ohne) und einem 5h-Fenster. */
  const E5 = (api: number | undefined, pct: number, resets = R5) =>
    eingabe({ sessionId: UUID, api, limits: { five: { pct, resets } } });
  const fuenfDatei = (r: Lauf) => datei(r).rate_limits.five_hour;
  const wocheDatei = (r: Lauf) => datei(r).rate_limits.seven_day;
  /** Eingabe von UUID, einzelne Felder roh gesetzt (etwa cost ohne Objekt oder ein Prozent ohne Zahl). */
  const roh = (felder: Record<string, unknown>) => JSON.stringify({ ...JSON.parse(eingabe({ sessionId: UUID })), ...felder });

  it("Planwechsel: jüngere Beobachtung mit niedrigerem Wert gewinnt (gemessen 27.10.: Woche 0 % gegen 99 %)", () => {
    const r = lauf(eingabe({ sessionId: UUID, api: 1_060_000, limits: { week: { pct: 0, resets: RW } } }), {
      usage: usage({ seven_day: fenster(99, RW, NOW - 600) }),
      sitzungen: vorige(vorher(1_000_000, NOW - 900)),
    });
    expect(r.zeilen[1]).toContain(" 0% ");
    expect(wocheDatei(r)).toEqual({ used_percentage: 0, resets_at: RW, observed_at: NOW - 60 });
    expect(sitzung(r).api_ms).toBe(1_060_000);
    expect(sitzung(r).api_at).toBe(NOW - 60);
    expect(sitzung(r).written_at).toBe(NOW);
  });

  it("ruhiger Tab mit älterer Beobachtung setzt nichts zurück (gemessen 27.10.: 0 % gegen 15 %)", () => {
    const r = lauf(E5(5000, 0), {
      usage: usage({ five_hour: fenster(15, R5, NOW - 30) }),
      sitzungen: vorige(vorher(5000, NOW - 1320)),
    });
    expect(r.plain).toContain("5h 15%");
    expect(fuenfDatei(r)).toEqual(fenster(15, R5, NOW - 30));
    // neu geschrieben (vorher NOW - 30), der gleiche Merker behält seinen Stempel
    expect(sitzung(r).written_at).toBe(NOW);
    expect(sitzung(r).api_at).toBe(NOW - 1320);
  });

  it("jüngere Datei, 5 Punkte tiefer, löst den höheren eigenen Wert ab", () => {
    const r = lauf(E5(5000, 35), {
      usage: usage({ five_hour: fenster(30, R5, NOW - 10) }),
      sitzungen: vorige(vorher(5000, NOW - 20)),
    });
    expect(r.plain).toContain("5h 30%");
  });

  it("gleiche Beobachtungszeit: der höhere Wert, kein Pendeln", () => {
    const opts = { usage: usage({ five_hour: fenster(30, R5, NOW - 60) }), sitzungen: vorige(vorher(1_000_000, NOW - 600)) };
    const tiefer = lauf(E5(1_060_000, 20), opts);
    expect(tiefer.plain).toContain("5h 30%");
    expect(fuenfDatei(tiefer).observed_at).toBe(NOW - 60);
    const hoeher = lauf(E5(1_060_000, 35), opts);
    expect(hoeher.plain).toContain("5h 35%");
    // beide Seiten NOW - 60: das geschriebene Fenster trägt diese Zeit auch mit dem eigenen Wert
    expect(fuenfDatei(hoeher)).toEqual(fenster(35, R5, NOW - 60));
  });

  it("neue Sitzung: unbekannt verliert gegen bekannt, nach der nächsten Antwort gewinnt sie", () => {
    const lauf1 = lauf(E5(7000, 40), { usage: usage({ five_hour: fenster(15, R5, NOW - 3000) }) });
    expect(lauf1.plain).toContain("5h 15%");
    expect(sitzung(lauf1).api_ms).toBe(7000);
    expect(sitzung(lauf1).api_at).toBeNull();
    const lauf2 = lauf(E5(8000, 41), { usage: datei(lauf1), sitzungen: vorige(sitzung(lauf1)) });
    expect(lauf2.plain).toContain("5h 41%");
    expect(fuenfDatei(lauf2).observed_at).toBe(NOW - 1);
  });

  it("Merker ohne rate_limits wird fortgeschrieben", () => {
    const r = lauf(eingabe({ sessionId: UUID, api: 5000 }), { sitzungen: vorige(vorher(1000, NOW - 50)) });
    expect(sitzung(r).api_ms).toBe(5000);
    expect(sitzung(r).api_at).toBe(NOW - 4);
    expect(existsSync(join(r.home, ".claude", "cockpit", "usage.json"))).toBe(false);
  });

  it("Merker wächst schneller als die Uhr (etwa parallele Sub-Agents): Stempel nicht früher als der vorige", () => {
    // Zuwachs 4 s ergäbe NOW - 4, der vorige Stempel NOW - 2 ist später und gilt
    const r = lauf(eingabe({ sessionId: UUID, api: 5000 }), { sitzungen: vorige(vorher(1000, NOW - 2)) });
    expect(sitzung(r).api_at).toBe(NOW - 2);
  });

  it("observed_at der Datei bis OBS_SLACK in der Zukunft gilt, darüber nicht", () => {
    const sitzungen = vorige(vorher(1_000_000, NOW - 600));
    const grenze = lauf(E5(1_060_000, 20), { usage: usage({ five_hour: fenster(30, R5, NOW + 60) }), sitzungen });
    expect(grenze.plain).toContain("5h 30%");
    const darueber = lauf(E5(1_060_000, 20), { usage: usage({ five_hour: fenster(30, R5, NOW + 61) }), sitzungen });
    expect(darueber.plain).toContain("5h 20%");
    // ohne vorige Datei sind beide unbekannt: der höhere Wert, das geschriebene Fenster ohne observed_at
    const ohne = lauf(E5(1_060_000, 20), { usage: usage({ five_hour: fenster(30, R5, NOW + 61) }) });
    expect(ohne.plain).toContain("5h 30%");
    expect(fuenfDatei(ohne)).toEqual(fenster(30, R5));
  });

  it("kaputte, fremde oder zu große Sitzungsdatei: unbekannt, Datei wird neu geschrieben", () => {
    const e = E5(5000, 10);
    const u = usage({ five_hour: fenster(40, R5) });
    const ohne = lauf(e, { usage: u });
    const kaputt: Array<string | object> = [
      "kein json",
      "[]",
      "x".repeat(2_000_000),
      vorher("5000", NOW - 10),
      { ...vorher(5000, NOW - 10), session_id: "11111111-2222-4333-8444-555555555555" },
      vorher(5000, NOW + 61),
      vorher(5000, 0),
      vorher(5000, "x"),
      // Datei aus 43d ohne api_ms und api_at (Verteiltag): ohne Zahl api_ms würde sie sonst nie mehr erneuert
      { session_id: UUID, written_at: NOW - 30, context_tokens: 82_000, used_percentage: 41, model: "Opus 5.5" },
    ];
    for (const v of kaputt) {
      const name = typeof v === "string" ? `${v.slice(0, 20)} (${v.length} Zeichen)` : JSON.stringify(v);
      const r = lauf(e, { usage: u, sitzungen: vorige(v) });
      // beide unbekannt: der höhere Wert; ein fälschlich bekannter Stempel ließe die 10 als jüngere Seite gewinnen
      expect(r.plain, name).toContain("5h 40%");
      expect(r.out, name).toBe(ohne.out);
      expect(sitzung(r).written_at, name).toBe(NOW);
      expect(sitzung(r).api_ms, name).toBe(5000);
      expect(sitzung(r).api_at, name).toBeNull();
    }
  });

  it("ohne total_api_duration_ms: unbekannt", () => {
    const r = lauf(E5(undefined, 10), {
      usage: usage({ five_hour: fenster(40, R5) }),
      sitzungen: vorige(vorher(5000, NOW - 10)),
    });
    expect(r.plain).toContain("5h 40%");
    expect(sitzung(r).api_ms).toBeNull();
    expect(sitzung(r).api_at).toBeNull();
  });

  it("ungültige session_id: keine vorige Datei gelesen", () => {
    const r = lauf(eingabe({ sessionId: "keine-uuid", api: 2, limits: { five: { pct: 10, resets: R5 } } }), {
      usage: usage({ five_hour: fenster(40, R5) }),
      sitzungen: { "keine-uuid.json": { session_id: "keine-uuid", api_ms: 1, api_at: NOW - 5 } },
    });
    expect(r.plain).toContain("5h 40%");
  });

  it("Rauschen: jüngere Beobachtung 1 Punkt tiefer lässt den höheren Wert stehen und bringt ihre Zeit mit, 2 Punkte tiefer löst ihn ab (gemessen 27.10.: ohne Mischregel 14 Rückschritte um je 1 Punkt in 25 Minuten)", () => {
    const opts = { usage: usage({ five_hour: fenster(16, R5, NOW - 20) }), sitzungen: vorige(vorher(1, NOW - 60)) };
    const einPunkt = lauf(E5(2, 15), opts);
    expect(einPunkt.plain).toContain("5h 16%");
    expect(fuenfDatei(einPunkt)).toEqual(fenster(16, R5, NOW));
    const zweiPunkte = lauf(E5(2, 14), opts);
    expect(zweiPunkte.plain).toContain("5h 14%");
    expect(fuenfDatei(zweiPunkte)).toEqual(fenster(14, R5, NOW));
    // Gegenrichtung: die Datei ist jünger und 1 Punkt tiefer, der eigene höhere Wert bleibt
    const gegen = lauf(E5(5000, 16), {
      usage: usage({ five_hour: fenster(15, R5, NOW) }),
      sitzungen: vorige(vorher(5000, NOW - 60)),
    });
    expect(gegen.plain).toContain("5h 16%");
    expect(fuenfDatei(gegen)).toEqual(fenster(16, R5, NOW));
  });

  it("Merker sinkt (neuer Prozess unter derselben ID): unbekannt", () => {
    const r = lauf(E5(100, 10), {
      usage: usage({ five_hour: fenster(40, R5) }),
      sitzungen: vorige(vorher(5000, NOW - 10)),
    });
    expect(r.plain).toContain("5h 40%");
    expect(sitzung(r).api_ms).toBe(100);
    expect(sitzung(r).api_at).toBeNull();
  });

  it("langer Merkersprung: Wert vom Anfang der Anfrage löst die jüngere tiefere Beobachtung nicht ab (gemessen: bis 193 s)", () => {
    const r = lauf(E5(1_240_000, 95), {
      usage: usage({ five_hour: fenster(2, R5, NOW - 100) }),
      sitzungen: vorige(vorher(1_000_000, NOW - 900)),
    });
    expect(r.plain).toContain("5h 2%");
    expect(fuenfDatei(r).observed_at).toBe(NOW - 100);
    expect(sitzung(r).api_at).toBe(NOW - 240);
  });

  it("Fensterwechsel trägt die Beobachtungszeit", () => {
    const neu = lauf(E5(2000, 2, NOW + 5 * 3600 - 120), {
      usage: usage({ five_hour: fenster(80, NOW - 60, NOW - 100) }),
      sitzungen: vorige(vorher(1000, NOW - 200)),
    });
    expect(neu.plain).toContain("5h 2%");
    expect(fuenfDatei(neu).observed_at).toBe(NOW - 1);
    // Gegenrichtung ohne vorige Datei: das neuere Fenster der Datei, sein observed_at liegt zu weit in der Zukunft
    const alt = lauf(E5(2000, 80, NOW - 60), { usage: usage({ five_hour: fenster(3, NOW + 4 * 3600, NOW + 61) }) });
    expect(alt.plain).toContain("5h 3%");
    expect(fuenfDatei(alt)).toEqual(fenster(3, NOW + 4 * 3600));
  });

  it("used_percentage ohne Zahl: wie 43d, kein Absturz", () => {
    const r = lauf(E5(5000, 30), {
      usage: usage({ five_hour: fenster(null, R5, NOW - 10) }),
      sitzungen: vorige(vorher(5000, NOW - 20)),
    });
    expect(r.plain).toContain("5h 30%");
    // Datei 5h 30; die Datei ist jünger (NOW - 10 gegen NOW - 20), ihre Zeit kommt mit
    expect(fuenfDatei(r)).toEqual(fenster(30, R5, NOW - 10));
  });

  it("schreibgeschützter Sitzungsordner mit alter Datei: unbekannt", () => {
    const r = lauf(E5(2000, 10), {
      usage: usage({ five_hour: fenster(40, R5) }),
      sitzungen: vorige(vorher(1000, NOW - 600)),
      sitzungenGesperrt: true,
    });
    // ganze Zeile: kein Absturz; ein bekannter Stempel aus der alten Datei ließe die 10 gewinnen
    expect(r.plain).toBe("Opus 5.5 │ 82k (41%) │ 5h 40% · noch 1:00");
  });

  it("Verteiltag: Datei aus 43d ohne observed_at, bekannte tiefere Beobachtung löst den hängenden Wert ab", () => {
    const r = lauf(eingabe({ sessionId: UUID, api: 1_060_000, limits: { week: { pct: 2, resets: RW } } }), {
      usage: usage({ seven_day: fenster(99, RW) }),
      sitzungen: vorige(vorher(1_000_000, NOW - 900)),
    });
    expect(r.zeilen[1]).toContain(" 2% ");
    expect(wocheDatei(r).observed_at).toBe(NOW - 60);
  });

  // Gegenrichtungen und Schutzzweige: Fällt eine dieser Prüfungen im Skript weg, wird hier ein Test rot.
  it("Regel 1 (keine usage.json): das eigene Fenster trägt api_at als observed_at", () => {
    // fehlt die Datei nach einem Planwechsel, hält erst der Stempel den neuen Wert gegen ruhige Tabs
    const r = lauf(E5(2000, 10), { sitzungen: vorige(vorher(1000, NOW - 200)) });
    expect(fuenfDatei(r)).toEqual(fenster(10, R5, NOW - 1));
  });

  it("Regel 2 (eigenes Fenster fehlt): das Fenster der Datei behält sein observed_at", () => {
    const r = lauf(E5(2000, 30), {
      usage: usage({ seven_day: fenster(50, RW, NOW - 40) }),
      sitzungen: vorige(vorher(1000, NOW - 200)),
    });
    expect(wocheDatei(r)).toEqual(fenster(50, RW, NOW - 40));
  });

  it("eigenes used_percentage ohne Zahl, eigene Seite jünger: der Wert der Datei, kein Rückfall", () => {
    const r = lauf(roh({ cost: { total_api_duration_ms: 2000 }, rate_limits: { five_hour: fenster(null, R5) } }), {
      usage: usage({ five_hour: fenster(30, R5, NOW - 100) }),
      sitzungen: vorige(vorher(1000, NOW - 200)),
    });
    expect(r.plain).toContain("5h 30%");
    expect(fuenfDatei(r)).toEqual(fenster(30, R5, NOW - 1));
  });

  it("Gegenrichtung: jüngere Datei genau DROP_MIN (2) Punkte tiefer löst den höheren eigenen Wert ab", () => {
    const r = lauf(E5(5000, 16), {
      usage: usage({ five_hour: fenster(14, R5, NOW - 10) }),
      sitzungen: vorige(vorher(5000, NOW - 60)),
    });
    expect(r.plain).toContain("5h 14%");
    expect(fuenfDatei(r)).toEqual(fenster(14, R5, NOW - 10));
  });

  it("observed_at 0 in der Datei gilt als unbekannt (Zahl größer 0)", () => {
    // ohne vorige Sitzungsdatei sind dann beide unbekannt: der höhere Wert, ohne observed_at
    const r = lauf(E5(5000, 40), { usage: usage({ five_hour: fenster(15, R5, 0) }) });
    expect(r.plain).toContain("5h 40%");
    expect(fuenfDatei(r)).toEqual(fenster(40, R5));
  });

  it("Merker als String: unbekannt, die Sitzungsdatei wird trotzdem geschrieben", () => {
    // ohne Typprüfung bräche "5000" - 1000 den Sitzungs-jq, und die vorige Datei bliebe stehen
    const r = lauf(roh({ cost: { total_api_duration_ms: "5000" } }), { sitzungen: vorige(vorher(1000, NOW - 50)) });
    expect(sitzung(r).written_at).toBe(NOW);
    expect(sitzung(r).api_ms).toBeNull();
    expect(sitzung(r).api_at).toBeNull();
  });

  it("cost ist kein Objekt: kein Merker, die Sitzungsdatei wird trotzdem geschrieben", () => {
    const r = lauf(roh({ cost: 5 }), { sitzungen: vorige(vorher(1000, NOW - 50)) });
    expect(sitzung(r).written_at).toBe(NOW);
    expect(sitzung(r).api_ms).toBeNull();
    expect(sitzung(r).api_at).toBeNull();
  });

  it("mv der Sitzungsdatei scheitert: unbekannt, kein temporärer Rest", () => {
    // mv-Attrappe wie die jq-Attrappe im jq-Zähler; sie scheitert nur für Ziele */sessions/*.json
    const bin = temp();
    const echtes = spawnSync("bash", ["-c", "command -v mv"], { encoding: "utf8" }).stdout.trim();
    writeFileSync(join(bin, "mv"), `#!/bin/bash\nfor a in "$@"; do case "$a" in */sessions/*.json) exit 1 ;; esac; done\nexec "${echtes}" "$@"\n`);
    chmodSync(join(bin, "mv"), 0o755);
    const r = lauf(E5(2000, 10), {
      usage: usage({ five_hour: fenster(40, R5) }),
      sitzungen: vorige(vorher(1000, NOW - 600)),
      pfadVorn: bin,
    });
    // ein bekannter Stempel (NOW - 1) ließe die 10 als jüngere Seite gewinnen
    expect(r.plain).toContain("5h 40%");
    // die vorige Datei bleibt unverändert, die temporäre ist entfernt
    expect(readdirSync(join(r.dir, "sessions"))).toEqual([`${UUID}.json`]);
    expect(sitzung(r).api_ms).toBe(1000);
  });

  it("Merker +1600 ms ohne vorigen Stempel: der Zuwachs zählt in ganzen Sekunden, abgerundet (NOW - 1)", () => {
    // 1,6 s Zuwachs: abgerundet 1 s, gerundet wären es 2 s; ohne gültiges voriges api_at greift die Klemme nicht
    const r = lauf(eingabe({ sessionId: UUID, api: 2600 }), { sitzungen: vorige(vorher(1000, null)) });
    expect(sitzung(r).api_at).toBe(NOW - 1);
  });

  it("vorige Sitzungsdatei über 4096 Byte, sonst gültig (etwa ein langer Modellname): unbekannt, die Datei wird neu geschrieben", () => {
    // session_id bleibt das erste Feld, die Datei hat über 5000 Byte; ganz gelesen gälte sie, und api_at wäre NOW - 4
    const r = lauf(eingabe({ sessionId: UUID, api: 5000 }), {
      sitzungen: vorige({ ...vorher(1000, NOW - 50), model: "x".repeat(5000) }),
    });
    expect(sitzung(r).written_at).toBe(NOW);
    expect(sitzung(r).model).toBe("Opus 5.5");
    expect(sitzung(r).api_ms).toBe(5000);
    expect(sitzung(r).api_at).toBeNull();
  });

  it("Regel 3 (Fenster der Datei neuer): es behält sein observed_at, auch gegen eine jüngere eigene Zeit", () => {
    // eigene Seite NOW - 1 (Merker +1000 ms), ihr Fenster ist aber abgelaufen; nach Regel 3 trägt das gewählte
    // Fenster seine eigene Zeit, nicht die späteste beider Seiten
    const r = lauf(E5(2000, 80, NOW - 60), {
      usage: usage({ five_hour: fenster(3, NOW + 4 * 3600, NOW - 40) }),
      sitzungen: vorige(vorher(1000, NOW - 200)),
    });
    expect(r.plain).toContain("5h 3% · noch 4:00");
    expect(fuenfDatei(r)).toEqual(fenster(3, NOW + 4 * 3600, NOW - 40));
  });

  it("Gleichstand im selben Fenster ohne jüngere Seite: das eigene Fenster gilt, auch für die Restzeit", () => {
    // gleicher Merker: die eigene Seite behält ihren Stempel NOW - 10, die Datei trägt dieselbe Zeit;
    // resets_at liegen 100 s auseinander (unter WINDOW_SLACK)
    const r = lauf(E5(5000, 30), {
      usage: usage({ five_hour: fenster(30, R5 - 100, NOW - 10) }),
      sitzungen: vorige(vorher(5000, NOW - 10)),
    });
    expect(r.plain).toContain("5h 30% · noch 1:00");
    expect(fuenfDatei(r)).toEqual(fenster(30, R5, NOW - 10));
    // beide unbekannt (keine vorige Sitzungsdatei, kein observed_at): ebenso das eigene Fenster
    const unbekannt = lauf(E5(5000, 30), { usage: usage({ five_hour: fenster(30, R5 - 100) }) });
    expect(unbekannt.plain).toContain("5h 30% · noch 1:00");
    expect(fuenfDatei(unbekannt)).toEqual(fenster(30, R5));
  });
});
