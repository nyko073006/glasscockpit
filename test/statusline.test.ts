import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// Statuszeile (Abend 13, Teil B): das Skript statusline/statusline-command.sh wird als Prozess
// mit fester Eingabe per stdin aufgerufen. Uhr, Ordner und HOME sind überschrieben.

const SKRIPT = resolve(__dirname, "..", "statusline", "statusline-command.sh");
// Fassung vor Abend 13 (Kopie aus ~/.claude/_archiv/2026-10-05-abend-13/), damit der Test ohne diesen Mac läuft.
const ARCHIV = resolve(__dirname, "fixtures", "statusline-vor-abend-13.sh");

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

function eingabe(opts: { kontext?: number; limits?: Limits | null; sessionId?: unknown } = {}): string {
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
  opts: { now?: number; tokens?: string | object | null; homeBlockiert?: boolean; thresholds?: string | object | null } = {},
): Lauf {
  const dir = temp();
  const home = temp();
  if (opts.homeBlockiert) writeFileSync(join(home, ".claude"), "ich bin eine Datei");
  const t = opts.tokens;
  if (t !== undefined && t !== null) {
    writeFileSync(join(dir, "tokens-today.json"), typeof t === "string" ? t : JSON.stringify(t));
  }
  const th = opts.thresholds;
  if (th !== undefined && th !== null) {
    writeFileSync(join(dir, "thresholds.json"), typeof th === "string" ? th : JSON.stringify(th));
  }
  const r = spawnSync("bash", [SKRIPT], {
    input: stdin,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      HOME: home,
      TZ: "Europe/Berlin",
      LANG: "de_DE.UTF-8",
      COCKPIT_NOW: String(opts.now ?? NOW),
      COCKPIT_DIR: dir,
    },
  });
  const out = r.stdout;
  // eslint-disable-next-line no-control-regex
  const plain = out.replace(/\u001b\[[0-9;]*m/g, "");
  return { out, plain, zeilen: plain.split("\n"), dir, home };
}

const heute = (n: number, alterSek = 30, day = "2026-10-05") => ({
  written_at: NOW - alterSek,
  day,
  output_tokens: n,
  skipped: 0,
  lines: 100,
});

describe("Statuszeile: Zeile 1 und 2", () => {
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

describe("Statuszeile: Empfehlung", () => {
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

describe("Statuszeile: Farben", () => {
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

describe("Statuszeile: Kontextmarken", () => {
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

describe("Statuszeile: Output-Tokens heute (tokens-today.json)", () => {
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
  const block = (text: string) => {
    const z = text.split("\n");
    const i = z.findIndex((l) => l.trim() === "input=$(cat)");
    return { i, vor: z.slice(0, i), nach: z.slice(i + 1, i + 1 + 16) };
  };

  it("Schnappschuss-Block steht bytegleich zum Archiv direkt nach input=$(cat)", () => {
    expect(existsSync(ARCHIV), `Archiv fehlt: ${ARCHIV}`).toBe(true);
    const alt = block(readFileSync(ARCHIV, "utf8"));
    const neu = block(readFileSync(SKRIPT, "utf8"));
    expect(alt.i).toBeGreaterThan(0);
    // Blockzeilen des Archivs: Zeilen 5 bis 19 (Leerzeile, Kommentar, if ... fi)
    const altZeilen = readFileSync(ARCHIV, "utf8").split("\n").slice(4, 19);
    expect(altZeilen[0]).toContain("Schnappschuss der Limits");
    expect(altZeilen[altZeilen.length - 1]).toBe("fi");
    expect(neu.i).toBeGreaterThanOrEqual(0);
    const nachInput = readFileSync(SKRIPT, "utf8").split("\n").slice(neu.i + 2, neu.i + 2 + altZeilen.length);
    expect(nachInput).toEqual(altZeilen);
  });

  it("Schnappschuss wird mit rate_limits geschrieben, ohne rate_limits nicht", () => {
    const mit = lauf(eingabe({ limits: { five: fuenf(42), week: woche(38, 43) } }));
    const datei = join(mit.home, ".claude", "cockpit", "usage.json");
    expect(existsSync(datei)).toBe(true);
    expect(JSON.parse(readFileSync(datei, "utf8")).rate_limits.five_hour.used_percentage).toBe(42);
    const ohne = lauf(eingabe());
    expect(existsSync(join(ohne.home, ".claude", "cockpit", "usage.json"))).toBe(false);
  });

  it("Ausgabe ist gleich, ob der Schnappschuss geschrieben werden konnte oder nicht", () => {
    const e = eingabe({ limits: { five: fuenf(42), week: woche(38, 43) } });
    const gut = lauf(e, { tokens: heute(340_000) });
    const blockiert = lauf(e, { tokens: heute(340_000), homeBlockiert: true });
    expect(blockiert.out).toBe(gut.out);
    expect(blockiert.out).not.toBe("");
    expect(existsSync(join(blockiert.home, ".claude", "cockpit"))).toBe(false);
  });

  it("Schnappschuss-Ordner schreibgeschützt: Ausgabe unverändert", () => {
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

  it("ein jq-Aufruf für die Statuszeile (Schnappschuss-Block und Sitzungsdatei zählen nicht mit; Schwellen werden im selben Aufruf gelesen)", () => {
    const bin = temp();
    const log = join(bin, "aufrufe.log");
    const echtes = spawnSync("bash", ["-c", "command -v jq"], { encoding: "utf8" }).stdout.trim();
    writeFileSync(join(bin, "jq"), `#!/bin/bash\necho x >> "${log}"\nexec "${echtes}" "$@"\n`);
    chmodSync(join(bin, "jq"), 0o755);
    const zaehle = (stdin: string) => {
      rmSync(log, { force: true });
      const dir = temp();
      const home = temp();
      spawnSync("bash", [SKRIPT], {
        input: stdin,
        encoding: "utf8",
        env: { PATH: `${bin}:${process.env.PATH}`, HOME: home, TZ: "Europe/Berlin", COCKPIT_NOW: String(NOW), COCKPIT_DIR: dir },
      });
      return readFileSync(log, "utf8").trim().split("\n").length;
    };
    // ohne rate_limits: 1 (Prüfung im Block) + 1 (Sitzungsdatei) + 1 (Statuszeile)
    expect(zaehle(eingabe())).toBe(3);
    // mit rate_limits: 2 (Block) + 1 (Sitzungsdatei) + 1 (Statuszeile)
    expect(zaehle(eingabe({ limits: { five: fuenf(42), week: woche(38, 43) } }))).toBe(4);
  });
});

describe("Statuszeile: Vorgaben", () => {
  it("ohne COCKPIT_NOW und COCKPIT_DIR läuft das Skript mit echter Uhr und liest HOME/.claude/cockpit", () => {
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
    for (const v of ["TEMPO_MARGIN=10", "FIVE_HOUR_WARN=90", "CTX_WARN=150000", "CTX_HANDOFF=175000", "PCT_YELLOW=70", "PCT_RED=90"]) {
      expect(s).toContain(v);
    }
  });
});

describe("deploy:statusline", () => {
  it("npm-Skript vorhanden", () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "..", "package.json"), "utf8"));
    expect(pkg.scripts["deploy:statusline"]).toBe("node scripts/deploy-statusline.mjs");
  });

  it("kopiert atomar mit Modus 755, ohne temporäre Reste, und ersetzt eine bestehende Datei", async () => {
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

describe("Statuszeile: Farbe endet mit dem Wert", () => {
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

describe("Statuszeile: Sitzungsdatei (Abend 18)", () => {
  const sdir = (r: Lauf) => join(r.dir, "sessions");
  const datei = (r: Lauf) => join(sdir(r), `${UUID}.json`);
  const E = (extra: { kontext?: number; limits?: Limits | null } = {}) => eingabe({ ...extra, sessionId: UUID });

  it("schreibt <COCKPIT_DIR>/sessions/<id>.json mit allen Feldern (written_at in Unix-Sekunden wie usage.json)", () => {
    const r = lauf(E({ kontext: 82_000 }));
    expect(existsSync(datei(r))).toBe(true);
    expect(JSON.parse(readFileSync(datei(r), "utf8"))).toEqual({
      session_id: UUID,
      written_at: NOW,
      context_tokens: 82_000,
      used_percentage: 41,
      model: "Opus 5.5",
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

describe("Statuszeile: thresholds.json (Festlegung 1)", () => {
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
