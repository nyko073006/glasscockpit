import { describe, expect, it } from "vitest";
import { applyDependencies, DEFAULT_SETTINGS, dependencyReason, expandHome, invalidMessage, normalizeSetting, parseNumberInput, parseSettings, validateSetting } from "../src/core/settings";
import { COCKPIT_CROPS, DEFAULT_COCKPIT_CROP, DEFAULT_IDE_BRIDGE, DEFAULT_IDE_DIFF } from "../src/core/constants";

describe("parseSettings", () => {
  it("trimmt Textwerte beim Laden", () => {
    const r = parseSettings({ projectsRoot: "  ~/x  ", soundFile: " /a.aiff " });
    expect(r.settings.projectsRoot).toBe("~/x");
    expect(r.settings.soundFile).toBe("/a.aiff");
    expect(r.invalid).toEqual([]);
  });
  it("fehlend ergibt Vorgaben", () => {
    expect(parseSettings(undefined)).toEqual({ settings: DEFAULT_SETTINGS, invalid: [] });
  });
  it("kein Objekt ergibt Vorgaben mit settings als ungültig", () => {
    for (const raw of [[], "x", 5, null]) {
      expect(parseSettings(raw)).toEqual({ settings: DEFAULT_SETTINGS, invalid: ["settings"] });
    }
  });
  it("ungültige Felder fallen einzeln auf die Vorgabe", () => {
    const r = parseSettings({ maxSessions: "0", alertGapMs: 1.5, alertSound: "ja", projectsRoot: 5 });
    expect(r.settings).toEqual(DEFAULT_SETTINGS);
    expect([...r.invalid].sort()).toEqual(["alertGapMs", "alertSound", "maxSessions", "projectsRoot"]);
  });
  it("gültige Werte bleiben", () => {
    const r = parseSettings({ maxSessions: 3, alertSound: false });
    expect(r.settings).toEqual({ ...DEFAULT_SETTINGS, maxSessions: 3, alertSound: false });
    expect(r.invalid).toEqual([]);
  });
  it("ganze Zahlen außerhalb der Grenzen werden beim Laden geklemmt, nicht verworfen", () => {
    const hoch = parseSettings({ maxSessions: 51, alertGapMs: 60001, fontSize: 99, scrollback: 10 ** 9 });
    expect(hoch.invalid).toEqual([]);
    expect(hoch.settings).toEqual({ ...DEFAULT_SETTINGS, maxSessions: 50, alertGapMs: 60000, fontSize: 32, scrollback: 100000 });
    const tief = parseSettings({ maxSessions: 0, alertGapMs: -5, fontSize: 7, scrollback: 499 });
    expect(tief.invalid).toEqual([]);
    expect(tief.settings).toEqual({ ...DEFAULT_SETTINGS, maxSessions: 1, alertGapMs: 0, fontSize: 8, scrollback: 500 });
  });
  it("die Grenzen selbst bleiben unverändert", () => {
    const r = parseSettings({ maxSessions: 50, alertGapMs: 0, fontSize: 8, scrollback: 100000 });
    expect(r.invalid).toEqual([]);
    expect(r.settings).toEqual({ ...DEFAULT_SETTINGS, maxSessions: 50, alertGapMs: 0, fontSize: 8, scrollback: 100000 });
  });
  it("falscher Typ bei Zahlen bleibt ungültig: Vorgabe und gemeldet", () => {
    const r = parseSettings({ maxSessions: "5", alertGapMs: 1.5, fontSize: NaN, scrollback: null, skillButtons: Infinity });
    expect(r.settings).toEqual(DEFAULT_SETTINGS);
    expect([...r.invalid].sort()).toEqual(["alertGapMs", "fontSize", "maxSessions", "scrollback", "skillButtons"]);
  });
  it("unbekannte Felder werden ignoriert und nicht gemeldet", () => {
    const r = parseSettings({ foo: 1, maxSessions: 4 });
    expect(r.invalid).toEqual([]);
    expect(r.settings).toEqual({ ...DEFAULT_SETTINGS, maxSessions: 4 });
    expect("foo" in r.settings).toBe(false);
  });
});

describe("fixedPrompt (Abend 19f)", () => {
  it("Vorgabe aus, an bleibt an, Unsinn fällt auf die Vorgabe", () => {
    expect(DEFAULT_SETTINGS.fixedPrompt).toBe(false);
    expect(parseSettings({ fixedPrompt: true }).settings.fixedPrompt).toBe(true);
    const kaputt = parseSettings({ fixedPrompt: "ja" });
    expect(kaputt.settings.fixedPrompt).toBe(false);
    expect(kaputt.invalid).toContain("fixedPrompt");
  });
});

describe("skipPermissions (Abend 20)", () => {
  it("Vorgabe aus, an bleibt an, fehlender Schlüssel in geladenen Daten ist aus", () => {
    expect(DEFAULT_SETTINGS.skipPermissions).toBe(false);
    expect(parseSettings({ skipPermissions: true }).settings.skipPermissions).toBe(true);
    expect(parseSettings({ fontSize: 14 }).settings.skipPermissions).toBe(false);
    expect(parseSettings(undefined).settings.skipPermissions).toBe(false);
  });
  it("Unsinn fällt auf aus und wird gemeldet", () => {
    const kaputt = parseSettings({ skipPermissions: "ja" });
    expect(kaputt.settings.skipPermissions).toBe(false);
    expect(kaputt.invalid).toContain("skipPermissions");
  });
});

describe("validateSetting", () => {
  it("nennt den Grund oder null", () => {
    expect(validateSetting("maxSessions", 0)).toBe("ganze Zahl von 1 bis 50");
    expect(validateSetting("maxSessions", "3")).toBe("ganze Zahl von 1 bis 50");
    expect(validateSetting("maxSessions", 3)).toBeNull();
    expect(validateSetting("alertGapMs", -1)).toBe("ganze Zahl von 0 bis 60000");
    expect(validateSetting("alertGapMs", 0)).toBeNull();
    expect(validateSetting("projectsRoot", " ")).toBeNull();
    expect(validateSetting("soundFile", 5)).toBe("darf nicht leer sein");
    expect(validateSetting("soundFile", "/a.aiff")).toBeNull();
    expect(validateSetting("markTab", "an")).toBe("muss an oder aus sein");
    expect(validateSetting("notifyOnDone", true)).toBeNull();
  });
});

describe("expandHome", () => {
  it("ersetzt Tilde", () => {
    expect(expandHome("~/x", "/h")).toBe("/h/x");
    expect(expandHome("~", "/h")).toBe("/h");
    expect(expandHome("/a", "/h")).toBe("/a");
    expect(expandHome("~x/y", "/h")).toBe("~x/y");
  });
});

describe("parseNumberInput", () => {
  it("leer und nur Leerzeichen ergeben NaN, nicht 0", () => {
    expect(parseNumberInput("")).toBeNaN();
    expect(parseNumberInput("  ")).toBeNaN();
  });
  it("Zahlen werden getrimmt gelesen", () => {
    expect(parseNumberInput(" 12 ")).toBe(12);
    expect(parseNumberInput("1.5")).toBe(1.5);
  });
  it("Text ergibt NaN", () => {
    expect(parseNumberInput("abc")).toBeNaN();
  });
  it("NaN wird von der Prüfung mit Grund abgelehnt, auch bei alertGapMs", () => {
    expect(validateSetting("alertGapMs", parseNumberInput(""))).not.toBeNull();
    expect(validateSetting("maxSessions", parseNumberInput("abc"))).not.toBeNull();
  });
});

describe("Dashboard-Einstellungen", () => {
  it("Vorgaben", () => {
    expect(DEFAULT_SETTINGS.briefingsDir).toBe("");
    expect(DEFAULT_SETTINGS.pullIntervalMin).toBe(5);
    expect(DEFAULT_SETTINGS.continuePrompt).toContain("{ordner}/");
  });
  it("alte data.json ohne die Felder lädt mit Vorgaben", () => {
    const r = parseSettings({ maxSessions: 4, projectsRoot: "~/x" });
    expect(r.invalid).toEqual([]);
    expect(r.settings.briefingsDir).toBe("");
    expect(r.settings.pullIntervalMin).toBe(5);
    expect(r.settings.continuePrompt).toBe(DEFAULT_SETTINGS.continuePrompt);
  });
  it("briefingsDir: nicht leer, kein .., Schrägstriche normalisiert", () => {
    expect(validateSetting("briefingsDir", "")).toBeNull();
    expect(validateSetting("briefingsDir", " / ")).toBeNull();
    expect(validateSetting("briefingsDir", "../x")).toBe("darf kein .. enthalten");
    expect(validateSetting("briefingsDir", "a/../b")).toBe("darf kein .. enthalten");
    expect(validateSetting("briefingsDir", "a..b")).toBeNull();
    expect(validateSetting("briefingsDir", "Briefings")).toBeNull();
    expect(normalizeSetting("briefingsDir", "/Briefings/")).toBe("Briefings");
    expect(normalizeSetting("briefingsDir", "  //a/b//  ")).toBe("a/b");
    expect(parseSettings({ briefingsDir: "/B/" }).settings.briefingsDir).toBe("B");
    expect(parseSettings({ briefingsDir: "../B" }).invalid).toEqual(["briefingsDir"]);
  });
  it("pullIntervalMin: ganze Zahl 0 bis 1440", () => {
    expect(validateSetting("pullIntervalMin", 0)).toBeNull();
    expect(validateSetting("pullIntervalMin", 1440)).toBeNull();
    expect(validateSetting("pullIntervalMin", 1441)).toBe("ganze Zahl von 0 bis 1440");
    expect(validateSetting("pullIntervalMin", -1)).toBe("ganze Zahl von 0 bis 1440");
    expect(validateSetting("pullIntervalMin", 2.5)).toBe("ganze Zahl von 0 bis 1440");
  });
  it("continuePrompt: nicht leer", () => {
    expect(validateSetting("continuePrompt", "  ")).toBe("darf nicht leer sein");
    expect(validateSetting("continuePrompt", "Hallo {ordner}")).toBeNull();
  });
});

describe("Tasks-Einstellungen (Abend 10)", () => {
  it("Vorgaben", () => {
    expect(DEFAULT_SETTINGS.tasksFile).toBe("Cockpit Tasks.md");
    expect(DEFAULT_SETTINGS.skillButtons).toBe(12);
  });
  it("alte data.json ohne die Felder lädt mit Vorgaben", () => {
    const r = parseSettings({ maxSessions: 4 });
    expect(r.invalid).toEqual([]);
    expect(r.settings.tasksFile).toBe("Cockpit Tasks.md");
    expect(r.settings.skillButtons).toBe(12);
  });
  it("tasksFile: nicht leer, kein .., endet auf .md, Schrägstriche normalisiert", () => {
    expect(validateSetting("tasksFile", "")).toBe("darf nicht leer sein");
    expect(validateSetting("tasksFile", " / ")).toBe("darf nicht leer sein");
    expect(validateSetting("tasksFile", "../x.md")).toBe("darf kein .. enthalten");
    expect(validateSetting("tasksFile", "a/../b.md")).toBe("darf kein .. enthalten");
    expect(validateSetting("tasksFile", "Aufgaben.txt")).toBe("muss auf .md enden");
    expect(validateSetting("tasksFile", "Ordner/")).toBe("muss auf .md enden");
    expect(validateSetting("tasksFile", "a..b.md")).toBeNull();
    expect(validateSetting("tasksFile", "Ordner/Tasks.md")).toBeNull();
    expect(validateSetting("tasksFile", 5)).toBe("darf nicht leer sein");
    expect(normalizeSetting("tasksFile", " /Ordner/Tasks.md ")).toBe("Ordner/Tasks.md");
    expect(parseSettings({ tasksFile: "/T.md" }).settings.tasksFile).toBe("T.md");
    expect(parseSettings({ tasksFile: "T.txt" }).invalid).toEqual(["tasksFile"]);
  });
  it("skillButtons: ganze Zahl 1 bis 30", () => {
    expect(validateSetting("skillButtons", 1)).toBeNull();
    expect(validateSetting("skillButtons", 30)).toBeNull();
    expect(validateSetting("skillButtons", 0)).toBe("ganze Zahl von 1 bis 30");
    expect(validateSetting("skillButtons", 31)).toBe("ganze Zahl von 1 bis 30");
    expect(validateSetting("skillButtons", 2.5)).toBe("ganze Zahl von 1 bis 30");
    expect(validateSetting("skillButtons", NaN)).toBe("ganze Zahl von 1 bis 30");
  });
});

describe("Terminal-Einstellungen (Abend 11)", () => {
  it("Vorgaben sind die bisherigen Werte", () => {
    expect(DEFAULT_SETTINGS.resumeConversations).toBe(true);
    expect(DEFAULT_SETTINGS.fontSize).toBe(13);
    expect(DEFAULT_SETTINGS.scrollback).toBe(5000);
  });
  it("alte data.json ohne die Felder lädt mit Vorgaben", () => {
    const r = parseSettings({ maxSessions: 4 });
    expect(r.invalid).toEqual([]);
    expect(r.settings.resumeConversations).toBe(true);
    expect(r.settings.fontSize).toBe(13);
    expect(r.settings.scrollback).toBe(5000);
  });
  it("gültige Werte werden gelesen", () => {
    const r = parseSettings({ resumeConversations: false, fontSize: 16, scrollback: 20000 });
    expect(r.invalid).toEqual([]);
    expect(r.settings).toMatchObject({ resumeConversations: false, fontSize: 16, scrollback: 20000 });
  });
  it("resumeConversations: nur an oder aus", () => {
    expect(parseSettings({ resumeConversations: "nein" }).invalid).toEqual(["resumeConversations"]);
    expect(validateSetting("resumeConversations", 1)).toBe("muss an oder aus sein");
    expect(validateSetting("resumeConversations", false)).toBeNull();
  });
  it("die Seite prüft streng: außerhalb der Grenzen ist ungültig, nur geladene Werte werden geklemmt", () => {
    expect(validateSetting("fontSize", 7)).toBe("ganze Zahl von 8 bis 32");
    expect(validateSetting("fontSize", 33)).toBe("ganze Zahl von 8 bis 32");
    expect(validateSetting("fontSize", 8)).toBeNull();
    expect(validateSetting("fontSize", 32)).toBeNull();
    expect(validateSetting("scrollback", 499)).toBe("ganze Zahl von 500 bis 100000");
    expect(validateSetting("scrollback", 100001)).toBe("ganze Zahl von 500 bis 100000");
    expect(validateSetting("scrollback", 500)).toBeNull();
    expect(validateSetting("scrollback", 12.5)).toBe("ganze Zahl von 500 bis 100000");
  });
  it("unbekannte Schlüssel fallen weg, auch Reste wie die alten Konstanten", () => {
    const r = parseSettings({ TERMINAL_FONT_SIZE: 20, alteKonstante: false, fontSize: 14 });
    expect(r.settings).toEqual({ ...DEFAULT_SETTINGS, fontSize: 14 });
    expect(Object.keys(r.settings).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
    expect("alteKonstante" in r.settings).toBe(false);
  });
});

describe("invalidMessage (Einstellungsseite)", () => {
  it("hängt den weiter geltenden Wert an den Grund", () => {
    expect(invalidMessage("ganze Zahl von 8 bis 32", 13)).toBe("ganze Zahl von 8 bis 32 (gilt weiter: 13)");
    expect(invalidMessage("darf nicht leer sein", "~/Projekte")).toBe("darf nicht leer sein (gilt weiter: ~/Projekte)");
  });
});

describe("Telegram-Einstellungen (Abend 11)", () => {
  it("Vorgaben: Arten aus, Standard-.env, Chat-ID leer, 2 Minuten", () => {
    expect(DEFAULT_SETTINGS.telegramOnDone).toBe(false);
    expect(DEFAULT_SETTINGS.telegramOnQuestion).toBe(false);
    expect(DEFAULT_SETTINGS.telegramEnvFile).toBe("~/.claude/channels/telegram/.env");
    expect(DEFAULT_SETTINGS.telegramChatId).toBe("");
    expect(DEFAULT_SETTINGS.telegramIdleMin).toBe(2);
  });
  it("telegramIdleMin: ganze Zahl 0 bis 240", () => {
    for (const ok of [0, 2, 240]) expect(validateSetting("telegramIdleMin", ok)).toBeNull();
    for (const bad of [-1, 241, 1.5, NaN, "2"]) expect(validateSetting("telegramIdleMin", bad)).toBe("ganze Zahl von 0 bis 240");
  });
  it("Schalter nur boolesch", () => {
    expect(validateSetting("telegramOnDone", true)).toBeNull();
    expect(validateSetting("telegramOnQuestion", "ja")).toBe("muss an oder aus sein");
  });
  it("telegramEnvFile nicht leer, Text getrimmt", () => {
    expect(validateSetting("telegramEnvFile", "  ")).toBe("darf nicht leer sein");
    expect(validateSetting("telegramEnvFile", 5)).toBe("darf nicht leer sein");
    expect(normalizeSetting("telegramEnvFile", " ~/x/.env ")).toBe("~/x/.env");
  });
  it("telegramChatId: leer erlaubt, Ziffern, - vorn; sonst Grund", () => {
    for (const ok of ["", "  ", "4711", "-100123", " 55 "]) expect(validateSetting("telegramChatId", ok)).toBeNull();
    for (const bad of ["abc", "12a", "--1", "-", "1 2", 5, null]) expect(validateSetting("telegramChatId", bad)).not.toBeNull();
    expect(normalizeSetting("telegramChatId", " 55 ")).toBe("55");
  });
  it("parseSettings: leere Chat-ID bleibt gültig, falsche Typen fallen auf die Vorgabe, Zahlen werden geklemmt", () => {
    const r = parseSettings({ telegramChatId: "", telegramOnDone: "an", telegramIdleMin: 999, telegramEnvFile: "" });
    expect(r.settings.telegramChatId).toBe("");
    expect([...r.invalid].sort()).toEqual(["telegramEnvFile", "telegramOnDone"]);
    expect(r.settings.telegramIdleMin).toBe(240);
  });
});

describe("usagePollSec (Abend 12)", () => {
  it("Vorgabe 60, Grenzen 10 bis 3600, beim Laden geklemmt", () => {
    expect(DEFAULT_SETTINGS.usagePollSec).toBe(60);
    expect(validateSetting("usagePollSec", 10)).toBeNull();
    expect(validateSetting("usagePollSec", 3600)).toBeNull();
    expect(validateSetting("usagePollSec", 9)).toBe("ganze Zahl von 10 bis 3600");
    expect(validateSetting("usagePollSec", 30.5)).toBe("ganze Zahl von 10 bis 3600");
    expect(parseSettings({ usagePollSec: 1 }).settings.usagePollSec).toBe(10);
    expect(parseSettings({ usagePollSec: 99999 }).settings.usagePollSec).toBe(3600);
    expect(parseSettings({ usagePollSec: "60" }).invalid).toEqual(["usagePollSec"]);
  });
});

describe("writeTokensFile (Abend 13)", () => {
  it("Vorgabe an, nur an oder aus erlaubt", () => {
    expect(DEFAULT_SETTINGS.writeTokensFile).toBe(true);
    expect(validateSetting("writeTokensFile", false)).toBeNull();
    expect(validateSetting("writeTokensFile", "an")).toBe("muss an oder aus sein");
    expect(parseSettings({ writeTokensFile: false }).settings.writeTokensFile).toBe(false);
    expect(parseSettings({ writeTokensFile: 1 }).invalid).toEqual(["writeTokensFile"]);
  });
});

describe("Research-Einstellungen (Abend 14)", () => {
  it("Vorgaben: drei Suchen, 120 Minuten Gültigkeit", () => {
    expect(DEFAULT_SETTINGS.researchSearches.split("\n")).toEqual([
      "claude-code stars:>8 | updated | 8",
      "claude skill OR claude subagent stars:>5 | stars | 8",
      "claude-code OR claude-agent stars:>30 | stars | 8",
    ]);
    expect(DEFAULT_SETTINGS.researchMaxAgeMin).toBe(120);
  });
  it("researchMaxAgeMin: ganze Zahl 10 bis 1440", () => {
    for (const ok of [10, 120, 1440]) expect(validateSetting("researchMaxAgeMin", ok)).toBeNull();
    for (const bad of [9, 1441, 1.5, NaN, "120"]) expect(validateSetting("researchMaxAgeMin", bad)).toBe("ganze Zahl von 10 bis 1440");
    expect(parseSettings({ researchMaxAgeMin: 9 }).settings.researchMaxAgeMin).toBe(10);
    expect(parseSettings({ researchMaxAgeMin: 1441 }).settings.researchMaxAgeMin).toBe(1440);
  });
  it("researchSearches: jeder Text gilt, auch leer oder mit ungültiger Zeile; Nicht-Text nicht", () => {
    for (const ok of ["", "   ", "kaputt", "a | stars | 5\nkaputt\nb | updated | 99"]) expect(validateSetting("researchSearches", ok)).toBeNull();
    for (const bad of [5, null, undefined, ["a"]]) expect(validateSetting("researchSearches", bad)).toBe("muss Text sein");
    const r = parseSettings({ researchSearches: "kaputt\na | stars | 5" });
    expect(r.invalid).toEqual([]);
    expect(r.settings.researchSearches).toBe("kaputt\na | stars | 5");
    expect(parseSettings({ researchSearches: 7 }).invalid).toEqual(["researchSearches"]);
  });
  it("researchSearches: nur am Ende gekürzt, führende Leerzeilen bleiben (Zeilennummern stabil)", () => {
    expect(normalizeSetting("researchSearches", "\n\na | stars | 5\n\n  ")).toBe("\n\na | stars | 5");
  });
});

describe("dashboardLayout (Abend 15)", () => {
  it("Vorgabe cockpit", () => {
    expect(DEFAULT_SETTINGS.dashboardLayout).toBe("cockpit");
    expect(parseSettings(undefined).settings.dashboardLayout).toBe("cockpit");
  });
  it("gültig sind cockpit und list, sonst ein Grund", () => {
    expect(validateSetting("dashboardLayout", "cockpit")).toBeNull();
    expect(validateSetting("dashboardLayout", "list")).toBeNull();
    expect(validateSetting("dashboardLayout", "grid")).toBe("cockpit oder list");
    expect(validateSetting("dashboardLayout", "")).toBe("cockpit oder list");
    expect(validateSetting("dashboardLayout", true)).toBe("cockpit oder list");
    expect(validateSetting("dashboardLayout", undefined)).toBe("cockpit oder list");
  });
  it("beim Laden bleibt list erhalten, Ungültiges fällt auf die Vorgabe und wird gemeldet", () => {
    expect(parseSettings({ dashboardLayout: "list" }).settings.dashboardLayout).toBe("list");
    const r = parseSettings({ dashboardLayout: "kachel" });
    expect(r.settings.dashboardLayout).toBe("cockpit");
    expect(r.invalid).toEqual(["dashboardLayout"]);
  });
});

describe("cockpitCrop (Abend 19b)", () => {
  it("Vorgabe crop (zugeschnitten)", () => {
    expect(DEFAULT_SETTINGS.cockpitCrop).toBe("crop");
    expect(parseSettings(undefined).settings.cockpitCrop).toBe("crop");
    expect(DEFAULT_COCKPIT_CROP).toBe("crop");
  });
  it("die zwei Werte stehen in dieser Reihenfolge fest: crop, full", () => {
    expect([...COCKPIT_CROPS]).toEqual(["crop", "full"]);
  });
  it("gültig sind crop und full, sonst ein Grund", () => {
    expect(validateSetting("cockpitCrop", "crop")).toBeNull();
    expect(validateSetting("cockpitCrop", "full")).toBeNull();
    expect(validateSetting("cockpitCrop", "zugeschnitten")).toBe("crop oder full");
    expect(validateSetting("cockpitCrop", "")).toBe("crop oder full");
    expect(validateSetting("cockpitCrop", true)).toBe("crop oder full");
    expect(validateSetting("cockpitCrop", undefined)).toBe("crop oder full");
  });
  it("beim Laden bleibt full erhalten, Ungültiges fällt auf die Vorgabe und wird gemeldet", () => {
    expect(parseSettings({ cockpitCrop: "full" }).settings.cockpitCrop).toBe("full");
    const r = parseSettings({ cockpitCrop: "klein" });
    expect(r.settings.cockpitCrop).toBe("crop");
    expect(r.invalid).toEqual(["cockpitCrop"]);
  });
  it("unabhängig von dashboardLayout: beide Werte bleiben, wie sie sind", () => {
    const r = parseSettings({ dashboardLayout: "list", cockpitCrop: "full" });
    expect([r.settings.dashboardLayout, r.settings.cockpitCrop, r.invalid]).toEqual(["list", "full", []]);
  });
});

describe("ideBridge (Abend 16)", () => {
  it("Vorgabe: an", () => {
    expect(DEFAULT_SETTINGS.ideBridge).toBe(true);
    expect(DEFAULT_IDE_BRIDGE).toBe(true);
  });
  it("aus dem Speicher gelesen, fehlend ergibt die Vorgabe", () => {
    expect(parseSettings({ ideBridge: false }).settings.ideBridge).toBe(false);
    expect(parseSettings({}).settings.ideBridge).toBe(true);
  });
  it("nur an oder aus", () => {
    expect(parseSettings({ ideBridge: "nein" }).invalid).toEqual(["ideBridge"]);
    expect(parseSettings({ ideBridge: "nein" }).settings.ideBridge).toBe(true);
    expect(validateSetting("ideBridge", 1)).toBe("muss an oder aus sein");
    expect(validateSetting("ideBridge", false)).toBeNull();
  });
});

describe("ideDiff (Abend 17)", () => {
  it("Vorgabe: aus", () => {
    expect(DEFAULT_SETTINGS.ideDiff).toBe(false);
    expect(DEFAULT_IDE_DIFF).toBe(false);
  });
  it("aus dem Speicher gelesen, fehlend ergibt die Vorgabe", () => {
    expect(parseSettings({ ideDiff: true }).settings.ideDiff).toBe(true);
    expect(parseSettings({}).settings.ideDiff).toBe(false);
  });
  it("nur an oder aus", () => {
    expect(parseSettings({ ideDiff: "ja" }).invalid).toEqual(["ideDiff"]);
    expect(parseSettings({ ideDiff: "ja" }).settings.ideDiff).toBe(false);
    expect(validateSetting("ideDiff", 1)).toBe("muss an oder aus sein");
    expect(validateSetting("ideDiff", true)).toBeNull();
  });
});

describe("ideDiff braucht ideBridge (06.10.2026)", () => {
  const aus = { ...DEFAULT_SETTINGS, ideBridge: false };
  it("geladen: Brücke aus heißt Diffs aus, ohne den Wert als ungültig zu melden", () => {
    const p = parseSettings({ ideBridge: false, ideDiff: true });
    expect(p.settings.ideDiff).toBe(false);
    expect(p.invalid).toEqual([]);
    expect(parseSettings({ ideBridge: true, ideDiff: true }).settings.ideDiff).toBe(true);
  });
  it("applyDependencies schaltet nur ideDiff ab und nur bei ausgeschalteter Brücke", () => {
    expect(applyDependencies({ ...aus, ideDiff: true })).toEqual({ ...aus, ideDiff: false });
    expect(applyDependencies({ ...DEFAULT_SETTINGS, ideDiff: true }).ideDiff).toBe(true);
  });
  it("dependencyReason: Einschalten bei ausgeschalteter Brücke hat einen Grund, alles andere nicht", () => {
    expect(dependencyReason(aus, "ideDiff", true)).toBe("braucht die IDE-Brücke");
    expect(dependencyReason(aus, "ideDiff", false)).toBeNull();
    expect(dependencyReason(DEFAULT_SETTINGS, "ideDiff", true)).toBeNull();
    expect(dependencyReason(aus, "ideBridge", true)).toBeNull();
  });
});

describe("Einstellungen Cockpit füllen (Abend 18)", () => {
  it("Vorgaben", () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      contextWarn: 150000, contextHandoff: 175000, tokensDayMedian: 340000, tokensDayP90: 870000,
      focusHeading: "Heute dran", inboxDir: "", indexFile: "", lintAfterDays: 7, dailyDir: "",
      nextEffort: "aus", radars: [], lintCommand: "",
    });
  });
  it("Zahlen werden geklemmt, nicht verworfen", () => {
    const hoch = parseSettings({ contextWarn: 999999, contextHandoff: 10 ** 9, tokensDayMedian: 99999999, tokensDayP90: 10 ** 12, lintAfterDays: 9999 });
    expect(hoch.invalid).toEqual([]);
    expect(hoch.settings).toMatchObject({ contextWarn: 999999, contextHandoff: 1000000, tokensDayMedian: 99999999, tokensDayP90: 100000000, lintAfterDays: 365 });
    const tief = parseSettings({ contextWarn: 1, contextHandoff: 2000, tokensDayMedian: 1, tokensDayP90: 2000, lintAfterDays: 0 });
    expect(tief.invalid).toEqual([]);
    expect(tief.settings).toMatchObject({ contextWarn: 1000, contextHandoff: 2000, tokensDayMedian: 1000, tokensDayP90: 2000, lintAfterDays: 1 });
  });
  it("validateSetting nennt die Grenzen", () => {
    expect(validateSetting("lintAfterDays", 0)).toBe("ganze Zahl von 1 bis 365");
    expect(validateSetting("lintAfterDays", 1)).toBeNull();
    expect(validateSetting("lintAfterDays", 365)).toBeNull();
    expect(validateSetting("lintAfterDays", 366)).toBe("ganze Zahl von 1 bis 365");
    expect(validateSetting("contextWarn", 999)).not.toBeNull();
    expect(validateSetting("contextWarn", 1000)).toBeNull();
  });
  it("warn >= handoff beim Laden: beide auf die Vorgabe, kein Absturz", () => {
    for (const [warn, handoff] of [[200000, 175000], [175000, 175000]]) {
      const r = parseSettings({ contextWarn: warn, contextHandoff: handoff, fontSize: 14 });
      expect(r.settings.contextWarn).toBe(150000);
      expect(r.settings.contextHandoff).toBe(175000);
      expect(r.settings.fontSize).toBe(14);
    }
  });
  it("median >= p90 beim Laden: beide auf die Vorgabe", () => {
    for (const [m, p] of [[900000, 870000], [870000, 870000]]) {
      const r = parseSettings({ tokensDayMedian: m, tokensDayP90: p });
      expect(r.settings.tokensDayMedian).toBe(340000);
      expect(r.settings.tokensDayP90).toBe(870000);
    }
  });
  it("gültige Paare bleiben, auch knapp darunter", () => {
    const r = parseSettings({ contextWarn: 100000, contextHandoff: 100001, tokensDayMedian: 5000, tokensDayP90: 5001 });
    expect(r.settings).toMatchObject({ contextWarn: 100000, contextHandoff: 100001, tokensDayMedian: 5000, tokensDayP90: 5001 });
  });
  it("nur ein Wert des Paars gesetzt: gegen die Vorgabe des anderen geprüft", () => {
    expect(parseSettings({ contextWarn: 180000 }).settings).toMatchObject({ contextWarn: 150000, contextHandoff: 175000 });
    expect(parseSettings({ contextHandoff: 140000 }).settings).toMatchObject({ contextWarn: 150000, contextHandoff: 175000 });
    expect(parseSettings({ contextWarn: 120000 }).settings.contextWarn).toBe(120000);
  });
  it("Handoff-Freigabe: Vorgabe 10 % Kontext und 2 Nachrichten, geklemmt auf 0–100 und 1–50", () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ clearableMinContextPct: 10, clearableMinPrompts: 2 });
    expect(parseSettings({ clearableMinContextPct: 250, clearableMinPrompts: 0 }).settings)
      .toMatchObject({ clearableMinContextPct: 100, clearableMinPrompts: 1 });
    expect(parseSettings({ clearableMinContextPct: 0, clearableMinPrompts: 5 }).settings)
      .toMatchObject({ clearableMinContextPct: 0, clearableMinPrompts: 5 });
    expect(validateSetting("clearableMinPrompts", 0)).toBe("ganze Zahl von 1 bis 50");
    expect(validateSetting("clearableMinContextPct", 101)).toBe("ganze Zahl von 0 bis 100");
    expect(validateSetting("clearableMinContextPct", 0)).toBeNull();
  });
  it("dependencyReason: Einzeländerung gegen das Paar", () => {
    const s = DEFAULT_SETTINGS;
    expect(dependencyReason(s, "contextWarn", 175000)).toBe("muss unter der Handoff-Schwelle liegen");
    expect(dependencyReason(s, "contextWarn", 174999)).toBeNull();
    expect(dependencyReason(s, "contextHandoff", 150000)).toBe("muss über der Warn-Schwelle liegen");
    expect(dependencyReason(s, "contextHandoff", 150001)).toBeNull();
    expect(dependencyReason(s, "tokensDayMedian", 870000)).toBe("muss unter dem p90 liegen");
    expect(dependencyReason(s, "tokensDayMedian", 869999)).toBeNull();
    expect(dependencyReason(s, "tokensDayP90", 340000)).toBe("muss über dem Median liegen");
    expect(dependencyReason(s, "tokensDayP90", 340001)).toBeNull();
  });
  it("Ordner und Datei wie briefingsDir und tasksFile", () => {
    expect(parseSettings({ inboxDir: " /Eingang/ ", dailyDir: "Tage/" }).settings).toMatchObject({ inboxDir: "Eingang", dailyDir: "Tage" });
    expect(parseSettings({ inboxDir: "../x" }).invalid).toEqual(["inboxDir"]);
    expect(parseSettings({ dailyDir: "  " }).invalid).toEqual([]);
    expect(parseSettings({ dailyDir: "  " }).settings.dailyDir).toBe("");
    expect(parseSettings({ indexFile: "Start.md" }).settings.indexFile).toBe("Start.md");
    expect(parseSettings({ indexFile: "Start.txt" }).invalid).toEqual(["indexFile"]);
    expect(parseSettings({ indexFile: "../Index.md" }).invalid).toEqual(["indexFile"]);
  });
  it("focusHeading: getrimmt, einzeilig, nicht leer", () => {
    expect(parseSettings({ focusHeading: "  Fokus " }).settings.focusHeading).toBe("Fokus");
    expect(parseSettings({ focusHeading: "  " }).invalid).toEqual(["focusHeading"]);
    expect(parseSettings({ focusHeading: "a\nb" }).invalid).toEqual(["focusHeading"]);
  });
  it("nextEffort nur gültige Stufe", () => {
    expect(parseSettings({ nextEffort: "xhigh" }).settings.nextEffort).toBe("xhigh");
    expect(parseSettings({ nextEffort: "ultra" })).toMatchObject({ invalid: ["nextEffort"], settings: { nextEffort: "aus" } });
    expect(parseSettings({ nextEffort: 3 }).invalid).toEqual(["nextEffort"]);
  });
  it("Radar-Pfade: getrimmt (Liste seit Abend 21, siehe vault-neutral.test.ts)", () => {
    expect(parseSettings({ radars: [{ name: "A", stateFile: " ~/x/state.json " }] }).settings.radars[0].stateFile).toBe("~/x/state.json");
  });
});

describe("handoffPrefix (Abend 19b)", () => {
  it("Vorgabe „Handoff:“", () => {
    expect(DEFAULT_SETTINGS.handoffPrefix).toBe("Handoff:");
  });
  it("alte data.json ohne das Feld lädt mit der Vorgabe, ohne Meldung", () => {
    const r = parseSettings({ maxSessions: 4 });
    expect(r.invalid).toEqual([]);
    expect(r.settings.handoffPrefix).toBe("Handoff:");
  });
  it("ein gültiger Text bleibt, getrimmt", () => {
    expect(parseSettings({ handoffPrefix: "Übergabe:" }).settings.handoffPrefix).toBe("Übergabe:");
    expect(parseSettings({ handoffPrefix: "  Übergabe: " }).settings.handoffPrefix).toBe("Übergabe:");
    expect(normalizeSetting("handoffPrefix", "  Start: ")).toBe("Start:");
  });
  it("leer oder nur Leerzeichen ist erlaubt (Knopf aus) und wird zu leer, nicht zur Vorgabe", () => {
    expect(validateSetting("handoffPrefix", "")).toBeNull();
    expect(validateSetting("handoffPrefix", "   ")).toBeNull();
    const r = parseSettings({ handoffPrefix: "   " });
    expect(r.invalid).toEqual([]);
    expect(r.settings.handoffPrefix).toBe("");
    expect(parseSettings({ handoffPrefix: "" }).settings.handoffPrefix).toBe("");
  });
  it("Nicht-Strings fallen auf die Vorgabe und werden gemeldet", () => {
    for (const v of [5, true, null, ["Handoff:"], { a: 1 }]) {
      const r = parseSettings({ handoffPrefix: v });
      expect([v, r.settings.handoffPrefix, r.invalid]).toEqual([v, "Handoff:", ["handoffPrefix"]]);
      expect([v, validateSetting("handoffPrefix", v)]).toEqual([v, "muss Text sein"]);
    }
  });
});

describe("Sitzungen nach dem Abschalten wieder öffnen (Abend 19c)", () => {
  it("Vorgabe an, alte data.json ohne das Feld lädt mit der Vorgabe", () => {
    expect(DEFAULT_SETTINGS.reopenAfterDisable).toBe(true);
    const r = parseSettings({ maxSessions: 4 });
    expect(r.invalid).toEqual([]);
    expect(r.settings.reopenAfterDisable).toBe(true);
  });
  it("nur an oder aus", () => {
    expect(parseSettings({ reopenAfterDisable: false }).settings.reopenAfterDisable).toBe(false);
    expect(parseSettings({ reopenAfterDisable: "ja" }).invalid).toEqual(["reopenAfterDisable"]);
    expect(validateSetting("reopenAfterDisable", 1)).toBe("muss an oder aus sein");
  });
});

describe("Handoff-Einstellungen (Abend 19h)", () => {
  it("Vorgaben: Ordner leer, Suffix und Vorlage gesetzt", () => {
    expect(DEFAULT_SETTINGS.hubsDir).toBe("");
    expect(DEFAULT_SETTINGS.handoffsDir).toBe("");
    expect(DEFAULT_SETTINGS.hubSuffix).toBe(" - PMO HUB.md");
    expect(DEFAULT_SETTINGS.handoffPrompt).toBe("Handoff: {datei}\nNächster Auftrag: {auftrag}");
  });
  it("hubsDir wie ein Vault-Ordner: leer erlaubt, .. verboten, Schrägstriche weg", () => {
    expect(validateSetting("hubsDir", "")).toBeNull();
    expect(validateSetting("hubsDir", "../x")).not.toBeNull();
    expect(normalizeSetting("hubsDir", "/Projekte/")).toBe("Projekte");
  });
  it("handoffsDir: ein Ordnername ohne Schrägstrich", () => {
    expect(validateSetting("handoffsDir", "")).toBeNull();
    expect(validateSetting("handoffsDir", "Handoffs")).toBeNull();
    expect(validateSetting("handoffsDir", "a/b")).not.toBeNull();
    expect(validateSetting("handoffsDir", "..")).not.toBeNull();
  });
  it("hubSuffix endet auf .md", () => {
    expect(validateSetting("hubSuffix", " - HUB.md")).toBeNull();
    expect(validateSetting("hubSuffix", "HUB")).not.toBeNull();
  });
  it("handoffPrompt: nicht leer, beginnt nicht mit -", () => {
    expect(validateSetting("handoffPrompt", "")).not.toBeNull();
    expect(validateSetting("handoffPrompt", "-p x")).not.toBeNull();
    expect(validateSetting("handoffPrompt", "Handoff: {datei}")).toBeNull();
  });
});

describe("Stille Zwischenstände (Abend 28)", () => {
  it("Vorgaben: Schalter an, Höchstalter 60 Minuten, Anzeige im Tab an", () => {
    expect(DEFAULT_SETTINGS.quietWhileAgents).toBe(true);
    expect(DEFAULT_SETTINGS.quietMaxAgeMin).toBe(60);
    expect(DEFAULT_SETTINGS.showOpenTasks).toBe(true);
  });
  it("quietWhileAgents und showOpenTasks: nur Wahrheitswerte, aus bleibt aus, Unsinn fällt auf die Vorgabe und wird gemeldet", () => {
    for (const key of ["quietWhileAgents", "showOpenTasks"] as const) {
      expect(validateSetting(key, true), key).toBeNull();
      expect(validateSetting(key, false), key).toBeNull();
      for (const unsinn of ["ja", 1, 0, null]) expect(validateSetting(key, unsinn), `${key} ${String(unsinn)}`).not.toBeNull();
      expect(parseSettings({ [key]: false }).settings[key], key).toBe(false);
      const r = parseSettings({ [key]: "ja" });
      expect(r.invalid, key).toEqual([key]);
      expect(r.settings[key], key).toBe(true);
    }
  });
  it("quietMaxAgeMin: ganze Zahl von 1 bis 1440", () => {
    for (const ok of [1, 60, 1440]) expect(validateSetting("quietMaxAgeMin", ok), String(ok)).toBeNull();
    for (const falsch of [0, -5, 1441, 1.5, "60", null, Number.NaN, Infinity]) {
      expect(validateSetting("quietMaxAgeMin", falsch), String(falsch)).not.toBeNull();
    }
  });
  it("quietMaxAgeMin beim Laden: gültige Werte bleiben, ganze Zahlen außerhalb werden geklemmt, Unsinn fällt auf die Vorgabe", () => {
    expect(parseSettings({ quietMaxAgeMin: 90 }).settings.quietMaxAgeMin).toBe(90);
    expect(parseSettings({ quietMaxAgeMin: 0 })).toMatchObject({ settings: { quietMaxAgeMin: 1 }, invalid: [] });
    expect(parseSettings({ quietMaxAgeMin: 99999 })).toMatchObject({ settings: { quietMaxAgeMin: 1440 }, invalid: [] });
    for (const unsinn of ["60", 1.5, null, Number.NaN]) {
      const r = parseSettings({ quietMaxAgeMin: unsinn });
      expect(r.settings.quietMaxAgeMin, String(unsinn)).toBe(60);
      expect(r.invalid, String(unsinn)).toEqual(["quietMaxAgeMin"]);
    }
  });
});
