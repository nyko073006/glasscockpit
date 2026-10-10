import { describe, expect, it } from "vitest";
import {
  TEST_TEXT, describeResponse, parseChatId, parseIdleSeconds, parseToken, redactToken, resolveCredentials, shouldSend, telegramText,
} from "../src/core/telegram";

const TOKEN = "123456789:AAFexampleTokenValue_abc-DEF1234567";

describe("parseToken", () => {
  it("liest Wert ohne Anführungszeichen", () => expect(parseToken(`TELEGRAM_BOT_TOKEN=${TOKEN}\n`)).toBe(TOKEN));
  it("liest Wert in doppelten Anführungszeichen", () => expect(parseToken(`TELEGRAM_BOT_TOKEN="${TOKEN}"`)).toBe(TOKEN));
  it("liest Wert in einfachen Anführungszeichen", () => expect(parseToken(`TELEGRAM_BOT_TOKEN='${TOKEN}'`)).toBe(TOKEN));
  it("fehlender Schlüssel ergibt null", () => expect(parseToken("ANDERER=1\n")).toBeNull());
  it("leerer Text und leere Zeile ergeben null", () => {
    expect(parseToken("")).toBeNull();
    expect(parseToken("\n\n")).toBeNull();
  });
  it("leerer Wert ergibt null", () => {
    expect(parseToken("TELEGRAM_BOT_TOKEN=")).toBeNull();
    expect(parseToken('TELEGRAM_BOT_TOKEN=""')).toBeNull();
  });
  it("andere Schlüssel davor und danach stören nicht", () =>
    expect(parseToken(`A=1\nTELEGRAM_BOT_TOKEN=${TOKEN}\nB=2`)).toBe(TOKEN));
  it("Kommentarzeile wird ignoriert", () => {
    expect(parseToken(`# TELEGRAM_BOT_TOKEN=alt\nTELEGRAM_BOT_TOKEN=${TOKEN}`)).toBe(TOKEN);
    expect(parseToken("# TELEGRAM_BOT_TOKEN=alt")).toBeNull();
  });
  it("CRLF-Zeilenenden", () => expect(parseToken(`A=1\r\nTELEGRAM_BOT_TOKEN=${TOKEN}\r\nB=2\r\n`)).toBe(TOKEN));
  it("Schlüssel mit Präfix zählt nicht", () => expect(parseToken(`XTELEGRAM_BOT_TOKEN=${TOKEN}`)).toBeNull());
  it("export-Präfix und Leerraum", () => expect(parseToken(`export TELEGRAM_BOT_TOKEN = ${TOKEN}  `)).toBe(TOKEN));
});

describe("parseChatId", () => {
  it("erstes Element von allowFrom", () => expect(parseChatId('{"allowFrom":["4711","9"]}')).toBe("4711"));
  it("fehlende Datei (null) ergibt null", () => expect(parseChatId(null)).toBeNull());
  it("kaputtes JSON ergibt null", () => expect(parseChatId("{")).toBeNull());
  it("allowFrom fehlt, leer oder kein Array ergibt null", () => {
    expect(parseChatId("{}")).toBeNull();
    expect(parseChatId('{"allowFrom":[]}')).toBeNull();
    expect(parseChatId('{"allowFrom":"4711"}')).toBeNull();
    expect(parseChatId("[]")).toBeNull();
  });
  it("Zahl statt String wird zu String", () => expect(parseChatId('{"allowFrom":[4711]}')).toBe("4711"));
  it("ungültiges erstes Element ergibt null", () => {
    expect(parseChatId('{"allowFrom":["abc"]}')).toBeNull();
    expect(parseChatId('{"allowFrom":[null]}')).toBeNull();
  });
  it("negative Gruppen-ID bleibt", () => expect(parseChatId('{"allowFrom":["-100123"]}')).toBe("-100123"));
});

describe("resolveCredentials", () => {
  const env = `TELEGRAM_BOT_TOKEN=${TOKEN}`;
  const access = '{"allowFrom":["4711"]}';
  it("Einstellung hat Vorrang vor access.json", () =>
    expect(resolveCredentials(env, access, "55")).toEqual({ ok: true, token: TOKEN, chatId: "55" }));
  it("leere Einstellung nimmt access.json", () =>
    expect(resolveCredentials(env, access, "  ")).toEqual({ ok: true, token: TOKEN, chatId: "4711" }));
  it("Einstellung genügt ohne access.json", () =>
    expect(resolveCredentials(env, null, "55")).toEqual({ ok: true, token: TOKEN, chatId: "55" }));
  it("fehlende .env", () => {
    const r = resolveCredentials(null, access, "");
    expect(r).toEqual({ ok: false, reason: "Datei mit dem Token fehlt" });
  });
  it("kein Token in der Datei", () => {
    const r = resolveCredentials("A=1", access, "");
    expect(r).toEqual({ ok: false, reason: "kein TELEGRAM_BOT_TOKEN in der Datei" });
  });
  it("keine Chat-ID", () => {
    const r = resolveCredentials(env, null, "");
    expect(r).toEqual({ ok: false, reason: "keine Chat-ID (Einstellung leer, access.json ohne allowFrom)" });
  });
  it("Grund nennt nie das Token", () => {
    for (const r of [resolveCredentials(env, null, ""), resolveCredentials(null, access, ""), resolveCredentials("A=1", access, "")]) {
      expect(JSON.stringify(r)).not.toContain(TOKEN);
    }
  });
});

describe("telegramText", () => {
  it("fertig, Ordner mit ~", () =>
    expect(telegramText("done", "Notizen", "/Users/alex/Documents/x", "/Users/alex")).toBe("✅ Notizen ist fertig\n~/Documents/x"));
  it("Frage", () =>
    expect(telegramText("question", "Notizen", "/Users/alex/Documents/x", "/Users/alex")).toBe("❓ Notizen hat eine Frage\n~/Documents/x"));
  it("Ordner außerhalb von Home bleibt absolut", () =>
    expect(telegramText("done", "A", "/opt/x", "/Users/alex")).toBe("✅ A ist fertig\n/opt/x"));
  it("ohne Ordner nur die erste Zeile", () => expect(telegramText("done", "A", "", "/Users/alex")).toBe("✅ A ist fertig"));
  it("Testtext", () => expect(TEST_TEXT).toBe("🧪 Glasscockpit: Testnachricht"));
});

describe("shouldSend", () => {
  const base = { enabled: true, idleMin: 2, idleSec: 300, lastAt: null as number | null, now: 1_000_000, gapMs: 3000 };
  it("alles erfüllt: senden", () => expect(shouldSend(base)).toBe(true));
  it("Art aus: nicht senden", () => expect(shouldSend({ ...base, enabled: false })).toBe(false));
  it("Leerlauf zu kurz: nicht senden", () => expect(shouldSend({ ...base, idleSec: 119 })).toBe(false));
  it("Leerlauf genau auf der Grenze: senden", () => expect(shouldSend({ ...base, idleSec: 120 })).toBe(true));
  it("idleMin 0: immer, auch bei Leerlauf 0", () => expect(shouldSend({ ...base, idleMin: 0, idleSec: 0 })).toBe(true));
  it("Leerlauf unbekannt bei idleMin 0: senden", () => expect(shouldSend({ ...base, idleMin: 0, idleSec: null })).toBe(true));
  it("Leerlauf unbekannt bei idleMin > 0: nicht senden", () => expect(shouldSend({ ...base, idleSec: null })).toBe(false));
  it("Abstand unterschritten: nicht senden", () => expect(shouldSend({ ...base, lastAt: base.now - 2999 })).toBe(false));
  it("Abstand erreicht: senden", () => expect(shouldSend({ ...base, lastAt: base.now - 3000 })).toBe(true));
  it("Abstand 0: nie gesperrt", () => expect(shouldSend({ ...base, gapMs: 0, lastAt: base.now })).toBe(true));
  it("Sitzung ohne eigenen Zeitpunkt (lastAt null) ist unabhängig von einer anderen", () => {
    const a = shouldSend({ ...base, lastAt: base.now - 10 });
    const b = shouldSend({ ...base, lastAt: null });
    expect([a, b]).toEqual([false, true]);
  });
});

describe("parseIdleSeconds", () => {
  it("echte Form der Ausgabe von ioreg", () =>
    expect(parseIdleSeconds('    | |   "HIDIdleTime" = 21088312125\n')).toBeCloseTo(21.088312125, 6));
  it("0 ist gültig", () => expect(parseIdleSeconds('"HIDIdleTime" = 0')).toBe(0));
  it("Feld fehlt: null", () => expect(parseIdleSeconds('| |   "Other" = 5\n')).toBeNull());
  it("leer: null", () => expect(parseIdleSeconds("")).toBeNull());
  it("mehrere Treffer: der kleinste gilt (jüngste Eingabe)", () =>
    expect(parseIdleSeconds('"HIDIdleTime" = 90000000000\n"HIDIdleTime" = 5000000000\n"HIDIdleTime" = 7000000000')).toBe(5));
  it("kein Zahlenwert: null", () => expect(parseIdleSeconds('"HIDIdleTime" = abc')).toBeNull());
});

describe("redactToken", () => {
  it("schneidet das Token aus der URL im Fehlertext", () => {
    const out = redactToken(`Request failed https://api.telegram.org/bot${TOKEN}/sendMessage`, TOKEN);
    expect(out).not.toContain(TOKEN);
    expect(out).toContain("bot***/sendMessage");
  });
  it("alle Vorkommen", () => expect(redactToken(`${TOKEN} und ${TOKEN}`, TOKEN)).not.toContain(TOKEN));
  it("auch ohne bekanntes Token: Form nnn:xxx wird geschwärzt", () =>
    expect(redactToken(`bot${TOKEN}/x`, null)).not.toContain("AAFexample"));
  it("Text ohne Token bleibt", () => expect(redactToken("Zeitüberschreitung", TOKEN)).toBe("Zeitüberschreitung"));
});

describe("describeResponse", () => {
  it("200 ok", () => expect(describeResponse(200, '{"ok":true,"result":{}}')).toEqual({ ok: true }));
  it("HTTP-Status mit description", () =>
    expect(describeResponse(400, '{"ok":false,"error_code":400,"description":"Bad Request: chat not found"}')).toEqual({
      ok: false, reason: "HTTP 400: Bad Request: chat not found",
    }));
  it("ohne lesbaren Body nur der Status", () => expect(describeResponse(502, "<html>")).toEqual({ ok: false, reason: "HTTP 502" }));
  it("200 mit ok:false gilt als Fehler", () =>
    expect(describeResponse(200, '{"ok":false,"description":"x"}')).toEqual({ ok: false, reason: "HTTP 200: x" }));
});
