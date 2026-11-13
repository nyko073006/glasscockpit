import { beforeEach, describe, expect, it, vi } from "vitest";
import { REMINDERS_LIST_SCRIPT, REMINDERS_SET_SCRIPT, type Reminder } from "../src/core/reminders";
import { DEFAULT_SETTINGS, type CockpitSettings } from "../src/core/settings";

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));
vi.mock("child_process", () => ({ execFile: execFileMock }));

import { RemindersController, type RemindersDeps, runOsascript } from "../src/host/reminders";

const FS = String.fromCharCode(31);
const RS = String.fromCharCode(30);

interface Offen { resolve: (v: string) => void; reject: (e: Error) => void }

/** run-Fake: jeder Aufruf wartet, bis der Test ihn auflöst oder ablehnt. */
function fakeRun() {
  const calls: Array<{ script: string; args: string[] }> = [];
  const offen: Offen[] = [];
  const run = vi.fn((script: string, args: string[]) => {
    calls.push({ script, args });
    return new Promise<string>((resolve, reject) => offen.push({ resolve, reject }));
  });
  return { run, calls, offen };
}

function setup(over: Partial<CockpitSettings> = {}, platform: RemindersDeps["platform"] = "darwin") {
  let settings: CockpitSettings = { ...DEFAULT_SETTINGS, remindersEnabled: true, remindersIntervalMin: 5, ...over };
  const listeners = new Set<(s: CockpitSettings) => void>();
  let now = 1_000_000;
  const fake = fakeRun();
  const ctl = new RemindersController({
    settings: () => settings,
    onSettingsChange: (cb) => {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
    platform,
    now: () => now,
    run: fake.run,
  });
  return {
    ctl,
    ...fake,
    advance: (ms: number) => { now += ms; },
    change: (s: Partial<CockpitSettings>) => {
      settings = { ...settings, ...s };
      for (const cb of [...listeners]) cb(settings);
    },
    listenerCount: () => listeners.size,
  };
}

const ausgabe = (...ids: string[]): string => ids.map((id) => [id, `Name ${id}`, "Arbeit", "2026", "11", "11"].join(FS)).join(RS);
const item = (id: string): Reminder => ({ id, name: `Name ${id}`, list: "Arbeit", due: "2026-11-11" });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("RemindersController: aus", () => {
  it.each([
    ["remindersEnabled aus", { remindersEnabled: false }, "darwin" as const],
    ["Windows", {}, "win32" as const],
  ])("%s: kein Aufruf, Zustand off", async (_name, over, platform) => {
    const t = setup(over, platform);
    expect(t.ctl.state.get()).toEqual({ kind: "off" });
    t.ctl.dashboardOpened();
    t.advance(10 * 60000);
    t.ctl.tick();
    await t.ctl.refresh();
    expect(await t.ctl.setCompleted("x", true)).toBe(false);
    expect(t.run).not.toHaveBeenCalled();
    expect(t.ctl.state.get()).toEqual({ kind: "off" });
  });
});

describe("RemindersController: refresh", () => {
  it("läuft nie doppelt, Fehler behält die alten Einträge, danach läuft refresh wieder", async () => {
    const t = setup();
    const erster = t.ctl.refresh();
    expect(t.ctl.state.get()).toEqual({ kind: "loading" });
    const zweiter = t.ctl.refresh();
    expect(t.run).toHaveBeenCalledTimes(1);
    expect(t.calls[0]).toEqual({ script: REMINDERS_LIST_SCRIPT, args: [] });
    await zweiter;
    t.offen[0].resolve(ausgabe("a"));
    await erster;
    expect(t.ctl.state.get()).toEqual({ kind: "ok", items: [item("a")] });

    const dritter = t.ctl.refresh();
    // Alter Zustand bleibt stehen, bis das Ergebnis da ist.
    expect(t.ctl.state.get()).toEqual({ kind: "ok", items: [item("a")] });
    t.offen[1].reject(new Error("execution error: kaputt (-1)"));
    await dritter;
    expect(t.ctl.state.get()).toEqual({ kind: "error", message: "Erinnerungen: execution error: kaputt (-1)", items: [item("a")] });

    const vierter = t.ctl.refresh();
    expect(t.run).toHaveBeenCalledTimes(3);
    t.offen[2].resolve(ausgabe("b"));
    await vierter;
    expect(t.ctl.state.get()).toEqual({ kind: "ok", items: [item("b")] });
  });
});

describe("RemindersController: tick", () => {
  it("läuft nie ohne offenes Dashboard", () => {
    const t = setup();
    t.advance(60 * 60000);
    t.ctl.tick();
    expect(t.run).not.toHaveBeenCalled();
  });

  it("läuft erst nach Ablauf des Abstands", async () => {
    const t = setup();
    t.ctl.dashboardOpened();
    expect(t.run).toHaveBeenCalledTimes(1);
    t.offen[0].resolve("");
    await flush();
    t.advance(4 * 60000);
    t.ctl.tick();
    expect(t.run).toHaveBeenCalledTimes(1);
    t.advance(60000);
    t.ctl.tick();
    expect(t.run).toHaveBeenCalledTimes(2);
  });

  it("läuft bei Abstand 0 nie und nach dem Schließen nicht mehr", async () => {
    const t = setup({ remindersIntervalMin: 0 });
    t.ctl.dashboardOpened();
    t.offen[0].resolve("");
    await flush();
    t.advance(60 * 60000);
    t.ctl.tick();
    expect(t.run).toHaveBeenCalledTimes(1);

    const u = setup();
    u.ctl.dashboardOpened();
    u.offen[0].resolve("");
    await flush();
    u.ctl.dashboardClosed();
    u.advance(60 * 60000);
    u.ctl.tick();
    expect(u.run).toHaveBeenCalledTimes(1);
  });
});

describe("RemindersController: setCompleted", () => {
  it("setzt den Zielzustand über argv, entfernt den Eintrag und sperrt die id während des Laufs", async () => {
    const t = setup();
    const r = t.ctl.refresh();
    t.offen[0].resolve(ausgabe("x", "y"));
    await r;

    const lauf = t.ctl.setCompleted("x", true);
    expect(t.ctl.isBusy("x")).toBe(true);
    expect(t.ctl.isBusy("y")).toBe(false);
    expect(await t.ctl.setCompleted("x", true)).toBe(false);
    expect(t.run).toHaveBeenCalledTimes(2);
    // Werte nur als argv: Skript unverändert, genau diese Argumente.
    expect(t.calls[1]).toEqual({ script: REMINDERS_SET_SCRIPT, args: ["x", "true"] });
    t.offen[1].resolve("");
    expect(await lauf).toBe(true);
    expect(t.ctl.isBusy("x")).toBe(false);
    expect(t.ctl.state.get()).toEqual({ kind: "ok", items: [item("y")] });
  });

  it("zurücksetzen liefert true und liest danach neu", async () => {
    const t = setup();
    const r = t.ctl.refresh();
    t.offen[0].resolve(ausgabe("x"));
    await r;
    const lauf = t.ctl.setCompleted("x", false);
    expect(t.calls[1]).toEqual({ script: REMINDERS_SET_SCRIPT, args: ["x", "false"] });
    t.offen[1].resolve("");
    expect(await lauf).toBe(true);
    expect(t.run).toHaveBeenCalledTimes(3);
  });

  it("Fehler setzt error und liefert false", async () => {
    const t = setup();
    const r = t.ctl.refresh();
    t.offen[0].resolve(ausgabe("x"));
    await r;
    const lauf = t.ctl.setCompleted("x", true);
    t.offen[1].reject(new Error("execution error: weg (-1728)"));
    expect(await lauf).toBe(false);
    expect(t.ctl.state.get()).toEqual({ kind: "error", message: "Erinnerungen: execution error: weg (-1728)", items: [item("x")] });
    expect(t.ctl.isBusy("x")).toBe(false);
  });
});

describe("RemindersController: Einstellungswechsel", () => {
  it("aus setzt off, an liest bei offenem Dashboard neu, dispose meldet ab", async () => {
    const t = setup();
    t.ctl.dashboardOpened();
    t.offen[0].resolve(ausgabe("a"));
    await flush();
    t.change({ remindersEnabled: false });
    expect(t.ctl.state.get()).toEqual({ kind: "off" });
    t.change({ remindersEnabled: true });
    expect(t.run).toHaveBeenCalledTimes(2);
    t.ctl.dispose();
    expect(t.listenerCount()).toBe(0);
  });
});

/** Controller mit einem Leselauf, der mit den angegebenen ids fertig ist. */
async function geladen(ids: string[], over: Partial<CockpitSettings> = {}) {
  const t = setup(over);
  const r = t.ctl.refresh();
  t.offen[0].resolve(ausgabe(...ids));
  await r;
  return t;
}

const leseLaeufe = (t: ReturnType<typeof setup>) => t.calls.filter((c) => c.script === REMINDERS_LIST_SCRIPT).length;

describe("RemindersController: Setzen während eines Leselaufs", () => {
  it("Fall A: erledigt während des Lesens, das alte Ergebnis wird verworfen und neu gelesen", async () => {
    const t = await geladen(["x", "y"]);
    const lesen = t.ctl.refresh(); // calls[1], hängt
    const setzen = t.ctl.setCompleted("x", true); // calls[2]
    t.offen[2].resolve("");
    expect(await setzen).toBe(true);
    t.offen[1].resolve(ausgabe("x", "y")); // Stand von vor dem Setzen
    await flush();
    expect(leseLaeufe(t)).toBe(3); // Anfang, veralteter Lauf, genau ein Nachlesen
    expect(t.calls[3]).toEqual({ script: REMINDERS_LIST_SCRIPT, args: [] });
    t.offen[3].resolve(ausgabe("y"));
    await lesen;
    expect(t.ctl.state.get()).toEqual({ kind: "ok", items: [item("y")] });
    expect(t.run).toHaveBeenCalledTimes(4);
  });

  it("Fall A mit Fehler: auch ein veralteter Fehler wird verworfen", async () => {
    const t = await geladen(["x", "y"]);
    const lesen = t.ctl.refresh();
    const setzen = t.ctl.setCompleted("x", true);
    t.offen[2].resolve("");
    await setzen;
    t.offen[1].reject(new Error("execution error: alt (-1)"));
    await flush();
    expect(t.ctl.state.get()).toEqual({ kind: "ok", items: [item("y")] });
    t.offen[3].resolve(ausgabe("y"));
    await lesen;
    expect(t.ctl.state.get()).toEqual({ kind: "ok", items: [item("y")] });
  });

  it("Fall B: zurückgesetzt während des Lesens, die wieder offene Erinnerung erscheint", async () => {
    const t = await geladen(["y"]);
    const lesen = t.ctl.refresh();
    const setzen = t.ctl.setCompleted("x", false);
    t.offen[2].resolve("");
    expect(await setzen).toBe(true);
    expect(t.run).toHaveBeenCalledTimes(3); // nie zwei Leseläufe zugleich
    t.offen[1].resolve(ausgabe("y")); // Stand von vor dem Zurücksetzen
    await flush();
    expect(leseLaeufe(t)).toBe(3); // das Nachlesen hängt am veralteten Lauf
    t.offen[3].resolve(ausgabe("x", "y"));
    await lesen;
    expect(t.ctl.state.get()).toEqual({ kind: "ok", items: [item("x"), item("y")] });
  });
});

describe("RemindersController: Zustände und Abbau", () => {
  it("der erste refresh meldet loading", async () => {
    const t = setup();
    const gemeldet: string[] = [];
    t.ctl.state.subscribe((s) => gemeldet.push(s.kind));
    const r = t.ctl.refresh();
    expect(gemeldet).toEqual(["loading"]);
    t.offen[0].resolve("");
    await r;
    expect(gemeldet).toEqual(["loading", "ok"]);
  });

  it("Einschalten ohne offenes Dashboard liest nicht", async () => {
    const t = setup({ remindersEnabled: false });
    t.change({ remindersEnabled: true });
    expect(t.run).not.toHaveBeenCalled();
    expect(t.ctl.state.get()).toEqual({ kind: "loading" });
  });

  it("Ausschalten leert items", async () => {
    const t = await geladen(["a"]);
    t.change({ remindersEnabled: false });
    t.change({ remindersEnabled: true });
    const r = t.ctl.refresh();
    t.offen[1].reject(new Error("kaputt"));
    await r;
    expect(t.ctl.state.get()).toEqual({ kind: "error", message: "Erinnerungen: kaputt", items: [] });
  });

  it("ein Leseergebnis oder -fehler nach dem Ausschalten überschreibt off nicht", async () => {
    const t = setup();
    const r = t.ctl.refresh();
    t.change({ remindersEnabled: false });
    t.offen[0].resolve(ausgabe("a"));
    await r;
    expect(t.ctl.state.get()).toEqual({ kind: "off" });

    const u = setup();
    const r2 = u.ctl.refresh();
    u.change({ remindersEnabled: false });
    u.offen[0].reject(new Error("kaputt"));
    await r2;
    expect(u.ctl.state.get()).toEqual({ kind: "off" });
  });

  it("ein Setzlauf nach dem Ausschalten überschreibt off nicht, weder bei Erfolg noch bei Fehler", async () => {
    for (const ende of ["gut", "schlecht"] as const) {
      const t = await geladen(["x"]);
      const setzen = t.ctl.setCompleted("x", true);
      t.change({ remindersEnabled: false });
      if (ende === "gut") t.offen[1].resolve("");
      else t.offen[1].reject(new Error("kaputt"));
      await setzen;
      expect(t.ctl.state.get()).toEqual({ kind: "off" });
    }
  });

  it("dashboardClosed zählt herunter: zwei offen, eines zu, tick läuft weiter", async () => {
    const t = setup();
    t.ctl.dashboardOpened();
    t.offen[0].resolve("");
    await flush();
    t.ctl.dashboardOpened(); // zweiter Lauf
    t.offen[1].resolve("");
    await flush();
    t.ctl.dashboardClosed();
    t.advance(5 * 60000);
    t.ctl.tick();
    expect(t.run).toHaveBeenCalledTimes(3);
  });

  it("Fehler beim Setzen: der Abonnent sieht die id schon frei", async () => {
    const t = await geladen(["x"]);
    const busyBeiMeldung: boolean[] = [];
    t.ctl.state.subscribe(() => busyBeiMeldung.push(t.ctl.isBusy("x")));
    const setzen = t.ctl.setCompleted("x", true);
    t.offen[1].reject(new Error("kaputt"));
    await setzen;
    expect(busyBeiMeldung).toEqual([false]);
  });

  it("Erfolg beim Setzen: der Abonnent sieht die id schon frei", async () => {
    const t = await geladen(["x"]);
    const busyBeiMeldung: boolean[] = [];
    t.ctl.state.subscribe(() => busyBeiMeldung.push(t.ctl.isBusy("x")));
    const setzen = t.ctl.setCompleted("x", true);
    t.offen[1].resolve("");
    await setzen;
    expect(busyBeiMeldung).toEqual([false]);
  });

  it("Abhaken bei Zustand error behält error und seine Meldung, ersetzt nur items", async () => {
    const t = await geladen(["x", "y"]);
    const r = t.ctl.refresh();
    t.offen[1].reject(new Error("kaputt"));
    await r;
    const setzen = t.ctl.setCompleted("x", true);
    t.offen[2].resolve("");
    expect(await setzen).toBe(true);
    expect(t.ctl.state.get()).toEqual({ kind: "error", message: "Erinnerungen: kaputt", items: [item("y")] });
  });

  it("nach dispose: kein Lauf mehr und keine späte Meldung", async () => {
    const t = setup();
    const r = t.ctl.refresh();
    const s = setup();
    const gemeldet: string[] = [];
    t.ctl.state.subscribe((x) => gemeldet.push(x.kind));
    t.ctl.dispose();
    t.offen[0].resolve(ausgabe("a"));
    await r;
    expect(gemeldet).toEqual([]);
    t.ctl.dashboardOpened();
    t.advance(60 * 60000);
    t.ctl.tick();
    await t.ctl.refresh();
    expect(await t.ctl.setCompleted("a", true)).toBe(false);
    expect(t.run).toHaveBeenCalledTimes(1);
    expect(gemeldet).toEqual([]);

    // Später Abschluss eines Setzlaufs nach dispose meldet ebenfalls nicht.
    const lr = s.ctl.refresh();
    s.offen[0].resolve(ausgabe("a"));
    await lr;
    const spaet: string[] = [];
    s.ctl.state.subscribe((x) => spaet.push(x.kind));
    const setzen = s.ctl.setCompleted("a", true);
    s.ctl.dispose();
    s.offen[1].resolve("");
    await setzen;
    expect(spaet).toEqual([]);
  });
});

type ExecCb = (e: Error | null, stdout: string, stderr: string) => void;

/** execFile-Fake: antwortet über den Callback (viertes Argument). */
function execAntwort(err: Error | null, stdout: string, stderr: string): void {
  execFileMock.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: ExecCb) => cb(err, stdout, stderr));
}

describe("runOsascript", () => {
  // Als Block: Ein zurückgegebener Mock würde von Vitest als Aufräumer aufgerufen.
  beforeEach(() => { execFileMock.mockReset(); });

  it("ruft /usr/bin/osascript mit Skript, Argumenten dahinter, Zeitlimit und windowsHide", async () => {
    execAntwort(null, "ausgabe\n", "");
    await expect(runOsascript("SKRIPT", ["a", "b"])).resolves.toBe("ausgabe");
    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = execFileMock.mock.calls[0];
    expect(cmd).toBe("/usr/bin/osascript");
    expect(args).toEqual(["-e", "SKRIPT", "a", "b"]);
    expect(opts).toMatchObject({ timeout: 20000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  });

  it("lehnt bei Fehler mit stderr statt der Befehlszeile ab, ohne stderr mit der Meldung", async () => {
    // Die Meldung von execFile beginnt mit „Command failed: <ganzes Skript>“; die erste Zeile wäre für die Karte wertlos.
    execAntwort(new Error("Command failed: /usr/bin/osascript -e SKRIPT\nexecution error: (-1743)"), "", "execution error: Not authorized (-1743)\n");
    await expect(runOsascript("SKRIPT", [])).rejects.toThrow(/^execution error: Not authorized \(-1743\)$/);
    execAntwort(new Error("spawn EACCES"), "", "");
    await expect(runOsascript("SKRIPT", [])).rejects.toThrow("spawn EACCES");
  });

  it("meldet ein Zeitlimit so, dass reminderErrorText es erkennt", async () => {
    execAntwort(Object.assign(new Error("Command failed: /usr/bin/osascript -e SKRIPT"), { killed: true, signal: "SIGTERM" }), "", "");
    await expect(runOsascript("SKRIPT", [])).rejects.toThrow(/killed/);
  });
});
