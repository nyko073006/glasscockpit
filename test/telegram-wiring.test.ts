import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/core/settings";
import { ROOT } from "./helpers/files";

const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
// Ausnahme (Abend 13): writeTokensFile meint die Output-Tokens der Statuszeile, kein Geheimnis. Nur dieser Name ist ausgenommen.
// Output-Token-Zähler, keine Zugangsdaten: Tokendatei der Statuszeile und die Tageswerte (Median, p90) der Rundinstrumente.
const OUTPUT_TOKENS = /writeTokensFile|WRITE_TOKENS_FILE|tokensDayMedian|tokensDayP90|TOKENS_DAY_MEDIAN|TOKENS_DAY_P90/g;
const HOST = ["src/host/telegram-send.ts", "src/host/telegram-notify.ts", "src/host/idle-time.ts"];

describe("Secrets: das Token ist nie Einstellung oder Datenfeld", () => {
  it("kein Schlüssel in DEFAULT_SETTINGS heißt nach Token oder Secret", () => {
    for (const key of Object.keys(DEFAULT_SETTINGS)) expect(key.replace(OUTPUT_TOKENS, "").toLowerCase()).not.toMatch(/token|secret|password|passwort/);
  });
  it("Schema in settings.ts und data.json-Modell nennen kein Token", () => {
    for (const p of ["src/core/settings.ts", "src/core/session-model.ts", "src/core/session-store.ts"]) {
      expect(read(p).replace(OUTPUT_TOKENS, "")).not.toMatch(/token/i);
    }
  });
  it.each(HOST)("%s: kein saveData, kein adapter.write, kein Schreiben ins Dateisystem", (p) => {
    const src = read(p);
    expect(src).not.toMatch(/saveData|adapter\.write|writeFile|appendFile|createWriteStream/);
  });
});

describe("Versand nur über requestUrl", () => {
  const send = read("src/host/telegram-send.ts");
  it("requestUrl kommt vor, fetch und XMLHttpRequest nicht", () => {
    expect(send).toMatch(/requestUrl\(/);
    expect(send).toMatch(/throw:\s*false/);
    for (const p of [...HOST, "src/host/settings-tab.ts"]) {
      expect(read(p)).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|node:https?|from\s+["']https?["']/);
    }
  });
  it("die URL mit Token steht nur in telegram-send.ts", () => {
    for (const p of ["src/host/telegram-notify.ts", "src/host/idle-time.ts", "src/host/settings-tab.ts", "src/main.ts", "src/host/terminal-view.ts"]) {
      expect(read(p)).not.toMatch(/api\.telegram\.org/);
    }
  });
  it("Token und Chat-ID werden bei jedem Versand frisch gelesen, nicht auf Modulebene zwischengespeichert", () => {
    expect(send).toMatch(/readFile\(/);
    expect(send).not.toMatch(/^(let|var|const)\s+\w*(token|cred)\w*\s*[=:]/im);
    expect(send).not.toMatch(/this\.\w*token/i);
  });
});

describe("Fehlerausgabe läuft durch die Schwärzung", () => {
  it.each(HOST)("%s: jedes console.* mit Fehlertext nutzt redactToken oder ist eine feste Meldung", (p) => {
    const src = read(p);
    const calls = src.split("\n").filter((l) => /console\./.test(l));
    for (const line of calls) {
      // Erlaubt: Aufruf mit redactToken(...), oder die Meldung der ioreg-Messung (kein Token im Spiel).
      const ok = /redactToken\(/.test(line) || (p === "src/host/idle-time.ts" && !/token/i.test(line));
      expect(ok, `${p}: ${line.trim()}`).toBe(true);
    }
  });
  it("telegram-send.ts hat gar kein console.*, und der Netzfehler wird geschwärzt", () => {
    const send = read("src/host/telegram-send.ts");
    expect(send).not.toMatch(/console\./);
    expect(send).toMatch(/catch \(fehler\)[\s\S]*redactToken\(msg, cred\.token\)/);
  });
  it("die Notice der Seite zeigt nur das Ergebnis (r.reason), nie Token oder Rohfehler", () => {
    const tab = read("src/host/settings-tab.ts");
    expect(tab).toMatch(/Telegram: \$\{r\.reason\}/);
    for (const line of tab.split("\n").filter((l) => /new Notice\(/.test(l) && /Telegram/.test(l))) expect(line).not.toMatch(/token|cred/i);
    expect(tab).not.toMatch(/readFile/);
  });
});

describe("Verdrahtung", () => {
  it("TerminalView ruft den Telegram-Kanal vor der notifyOn*-Prüfung (unabhängig davon)", () => {
    const v = read("src/host/terminal-view.ts");
    const i = v.indexOf("this.deps.telegram(");
    const j = v.indexOf("s.notifyOnDone");
    expect(i).toBeGreaterThan(-1);
    expect(i).toBeLessThan(j);
    expect(v.slice(i, j)).not.toMatch(/react\(/);
  });
  it("Das Notifier-Objekt prüft Art, Leerlauf und Abstand über shouldSend", () => {
    const n = read("src/host/telegram-notify.ts");
    expect(n).toMatch(/shouldSend\(/);
    expect(n).toMatch(/settings\(\)/);
  });
});
