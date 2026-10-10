import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager";
import { KILL_ESCALATION_MS } from "../src/core/constants";
import { FakeTimers, fakeFactory, spec } from "./helpers/fakes";

function setup() {
  const factory = fakeFactory();
  const manager = new SessionManager(factory.create);
  return { manager, created: factory.created };
}

describe("SessionManager.spawn", () => {
  it("erzeugt eine PTY mit den Werten aus der Spec", () => {
    const { manager, created } = setup();
    const s = spec("a", { cols: 100, rows: 40 });
    expect(manager.spawn(s)).toEqual({ ok: true, created: true });
    expect(created).toHaveLength(1);
    expect(created[0].spec).toEqual(s);
    expect(manager.has("a")).toBe(true);
    expect(manager.isRunning("a")).toBe(true);
  });

  it("idempotent: eine laufende Sitzung bleibt, keine zweite PTY", () => {
    const { manager, created } = setup();
    manager.spawn(spec("a"));
    expect(manager.spawn(spec("a"))).toEqual({ ok: true, created: false });
    expect(created).toHaveLength(1);
    expect(created[0].killed).toBe(0);
  });

  it("eine beendete Sitzung wird ersetzt", () => {
    const { manager, created } = setup();
    manager.spawn(spec("a"));
    created[0].exit(0);
    expect(manager.isRunning("a")).toBe(false);
    expect(manager.has("a")).toBe(true);

    expect(manager.spawn(spec("a"))).toEqual({ ok: true, created: true });
    expect(created).toHaveLength(2);
    expect(manager.isRunning("a")).toBe(true);
    // Die alte PTY hört nichts mehr: keine Listener übrig.
    expect(created[0].listenerCount).toBe(0);
  });

  it("die Ersatz-Sitzung beginnt mit leerem Ring", () => {
    const { manager, created } = setup();
    manager.spawn(spec("a"));
    created[0].emit("alt");
    created[0].exit(0);
    manager.spawn(spec("a"));
    expect(manager.handle("a")?.replay()).toBe("");
  });

  it("wirft die Factory, meldet spawn den Fehler und legt nichts an", () => {
    const manager = new SessionManager(() => {
      throw new Error("posix_spawnp failed.");
    });
    expect(manager.spawn(spec("a"))).toEqual({ ok: false, error: "posix_spawnp failed." });
    expect(manager.has("a")).toBe(false);
  });

  it("verschiedene ids: getrennte Sitzungen", () => {
    const { manager, created } = setup();
    manager.spawn(spec("a"));
    manager.spawn(spec("b"));
    expect(created).toHaveLength(2);
    expect(manager.ids().sort()).toEqual(["a", "b"]);
  });
});

describe("SessionManager.handle: Replay und Abonnenten", () => {
  it("unbekannte id: null", () => {
    expect(setup().manager.handle("fehlt")).toBeNull();
  });

  it("attach ruft cb sofort einmal mit dem ganzen Ring, danach live", () => {
    const { manager, created } = setup();
    manager.spawn(spec("a"));
    created[0].emit("eins ");
    created[0].emit("zwei ");

    const empfangen: string[] = [];
    manager.handle("a")!.attach((d) => empfangen.push(d));
    expect(empfangen).toEqual(["eins zwei "]);

    created[0].emit("drei");
    expect(empfangen).toEqual(["eins zwei ", "drei"]);
  });

  it("attach bei leerem Ring: cb trotzdem genau einmal, mit leerem Text", () => {
    const { manager } = setup();
    manager.spawn(spec("a"));
    const empfangen: string[] = [];
    manager.handle("a")!.attach((d) => empfangen.push(d));
    expect(empfangen).toEqual([""]);
  });

  it("replay liefert den Ring, auch nach dem Exit", () => {
    const { manager, created } = setup();
    manager.spawn(spec("a"));
    created[0].emit("prompt$ ");
    created[0].exit(1);
    expect(manager.handle("a")!.replay()).toBe("prompt$ ");
  });

  it("zwei Abonnenten bekommen beide live, Abmelden trennt nur einen", () => {
    const { manager, created } = setup();
    manager.spawn(spec("a"));
    const erster: string[] = [];
    const zweiter: string[] = [];
    const abmelden = manager.handle("a")!.attach((d) => erster.push(d));
    manager.handle("a")!.attach((d) => zweiter.push(d));

    created[0].emit("x");
    abmelden();
    created[0].emit("y");

    expect(erster).toEqual(["", "x"]);
    expect(zweiter).toEqual(["", "x", "y"]);
  });

  it("Ring ist bei Überlauf gekürzt (Maximum vom Konstruktor)", () => {
    const factory = fakeFactory();
    const manager = new SessionManager(factory.create, 10);
    manager.spawn(spec("a"));
    factory.created[0].emit("abcdefghij\nxyz");
    expect(manager.handle("a")!.replay()).toBe("xyz");
  });

  it("Vorspann mit den Modi, die der gekürzte Ring verloren hat (Abend 19f)", () => {
    const factory = fakeFactory();
    const manager = new SessionManager(factory.create, 10);
    manager.spawn(spec("a"));
    factory.created[0].emit("\x1b[?1049h\x1b[?1000h");
    factory.created[0].emit("abcdefghij\nxyz");
    expect(manager.handle("a")!.replay()).toBe("\x1b[?1049h\x1b[?1000hxyz");
    const empfangen: string[] = [];
    manager.handle("a")!.attach((d) => empfangen.push(d));
    expect(empfangen).toEqual(["\x1b[?1049h\x1b[?1000hxyz"]);
  });
});

describe("SessionManager: write, resize, Exit", () => {
  it("write geht an die PTY, solange sie läuft", () => {
    const { manager, created } = setup();
    manager.spawn(spec("a"));
    manager.handle("a")!.write("ls\r");
    expect(created[0].written).toEqual(["ls\r"]);
  });

  it("write nach dem Exit wird ignoriert", () => {
    const { manager, created } = setup();
    manager.spawn(spec("a"));
    const handle = manager.handle("a")!;
    created[0].exit(0);
    handle.write("ls\r");
    expect(created[0].written).toEqual([]);
  });

  it.each([
    [0, 24],
    [80, 0],
    [-1, 24],
    [Number.NaN, 24],
  ])("resize(%s, %s) wird ignoriert", (cols, rows) => {
    const { manager, created } = setup();
    manager.spawn(spec("a"));
    manager.handle("a")!.resize(cols, rows);
    expect(created[0].resizes).toEqual([]);
    expect(manager.stats("a")).toMatchObject({ cols: 80, rows: 24 });
  });

  it("resize mit positiven Maßen geht durch, der letzte Aufrufer gewinnt", () => {
    const { manager, created } = setup();
    manager.spawn(spec("a"));
    manager.handle("a")!.resize(100, 30);
    manager.handle("a")!.resize(90, 20);
    expect(created[0].resizes).toEqual([
      [100, 30],
      [90, 20],
    ]);
    expect(manager.stats("a")).toMatchObject({ cols: 90, rows: 20 });
  });

  it("resize nach dem Exit wird ignoriert", () => {
    const { manager, created } = setup();
    manager.spawn(spec("a"));
    created[0].exit(0);
    manager.handle("a")!.resize(100, 30);
    expect(created[0].resizes).toEqual([]);
  });

  it("onExit meldet den Exit-Code, auch einem späten Abonnenten sofort", () => {
    const { manager, created } = setup();
    manager.spawn(spec("a"));
    const frueh: number[] = [];
    manager.handle("a")!.onExit((code) => frueh.push(code));
    created[0].exit(130);

    const spaet: number[] = [];
    manager.handle("a")!.onExit((code) => spaet.push(code));
    expect(frueh).toEqual([130]);
    expect(spaet).toEqual([130]);
  });

  it("onExit-Abmeldung wirkt", () => {
    const { manager, created } = setup();
    manager.spawn(spec("a"));
    const codes: number[] = [];
    const abmelden = manager.handle("a")!.onExit((code) => codes.push(code));
    abmelden();
    created[0].exit(0);
    expect(codes).toEqual([]);
  });
});

describe("SessionManager: kill und killAll", () => {
  it("kill beendet eine Sitzung, die andere läuft weiter", () => {
    const { manager, created } = setup();
    manager.spawn(spec("a"));
    manager.spawn(spec("b"));
    manager.kill("a");
    expect(created[0].killed).toBe(1);
    expect(created[1].killed).toBe(0);
    expect(manager.has("a")).toBe(false);
    expect(manager.isRunning("b")).toBe(true);
  });

  it("nach kill erreichen späte Daten der alten PTY keinen Abonnenten", () => {
    const { manager, created } = setup();
    manager.spawn(spec("a"));
    const empfangen: string[] = [];
    manager.handle("a")!.attach((d) => empfangen.push(d));
    manager.kill("a");
    created[0].emit("spät");
    expect(empfangen).toEqual([""]);
    // Übrig bleibt nur der Exit-Wächter der Eskalation (er muss den Exit der toten Sitzung noch sehen).
    expect(created[0].listenerCount).toBe(1);
    created[0].exit(129);
    expect(created[0].listenerCount).toBe(0);
  });

  it("kill einer unbekannten id tut nichts", () => {
    expect(() => setup().manager.kill("fehlt")).not.toThrow();
  });

  it("killAll beendet alle laufenden, beendete werden nicht erneut getötet", () => {
    const { manager, created } = setup();
    manager.spawn(spec("a"));
    manager.spawn(spec("b"));
    manager.spawn(spec("c"));
    created[2].exit(0);
    manager.killAll();
    expect(created.map((p) => p.killed)).toEqual([1, 1, 0]);
    expect(manager.ids()).toEqual([]);
  });

  it("wirft pty.kill, laufen die übrigen kills trotzdem", () => {
    const factory = fakeFactory();
    const manager = new SessionManager((s) => {
      const pty = factory.create(s);
      if (s.id === "a") pty.kill = () => {
        throw new Error("ESRCH");
      };
      return pty;
    });
    manager.spawn(spec("a"));
    manager.spawn(spec("b"));
    expect(() => manager.killAll()).not.toThrow();
    expect(factory.created[1].killed).toBe(1);
    expect(manager.ids()).toEqual([]);
  });
});

describe("SessionManager.stats (Diagnose leere Pane)", () => {
  it("zählt Datenportionen und Zeichen, Ringlänge und Abonnenten", () => {
    const { manager, created } = setup();
    manager.spawn(spec("a"));
    manager.handle("a")!.attach(() => {});
    created[0].emit("abc");
    created[0].emit("de");
    expect(manager.stats("a")).toEqual({
      running: true,
      exitCode: null,
      chunks: 2,
      chars: 5,
      ringChars: 5,
      cols: 80,
      rows: 24,
      subscribers: 1,
    });
  });

  it("nach dem Exit: running false und Exit-Code", () => {
    const { manager, created } = setup();
    manager.spawn(spec("a"));
    created[0].exit(2);
    expect(manager.stats("a")).toMatchObject({ running: false, exitCode: 2 });
  });

  it("unbekannte id: null", () => {
    expect(setup().manager.stats("fehlt")).toBeNull();
  });
});

describe("SessionManager.meta: Art und Titel der Sitzung", () => {
  it("liefert, was spawn mitbekam", () => {
    const { manager } = setup();
    manager.spawn({ ...spec("a"), meta: { kind: "claude", title: "Vault 09:05 · 0f4b7c1e" } });
    expect(manager.meta("a")).toEqual({ kind: "claude", title: "Vault 09:05 · 0f4b7c1e" });
  });

  it("ohne meta beim spawn, unbekannte id und nach kill: null", () => {
    const { manager } = setup();
    manager.spawn(spec("a"));
    expect(manager.meta("a")).toBeNull();
    expect(manager.meta("fehlt")).toBeNull();
    manager.spawn({ ...spec("b"), meta: { kind: "shell", title: "Shell" } });
    manager.kill("b");
    expect(manager.meta("b")).toBeNull();
  });

  it("bleibt nach dem Exit erhalten, solange die Sitzung bekannt ist", () => {
    const { manager, created } = setup();
    manager.spawn({ ...spec("a"), meta: { kind: "claude", title: "T" } });
    created[0].exit(0);
    expect(manager.meta("a")).toEqual({ kind: "claude", title: "T" });
  });
});

describe("SessionManager: Beenden mit Eskalation", () => {
  function esc(options: { signalGroup?: (pid: number, signal: string) => void } = {}) {
    const timers = new FakeTimers();
    const factory = fakeFactory();
    const manager = new SessionManager(factory.create, undefined, { timers, ...options });
    return { manager, created: factory.created, timers };
  }

  it("kill sendet SIGHUP an die PTY, SIGKILL folgt nach 2000 ms, wenn sie noch lebt", () => {
    const { manager, created, timers } = esc();
    manager.spawn(spec("a"));
    void manager.kill("a");
    expect(created[0].signals).toEqual(["SIGHUP"]);
    timers.advance(KILL_ESCALATION_MS - 1);
    expect(created[0].signals).toEqual(["SIGHUP"]);
    timers.advance(1);
    expect(created[0].signals).toEqual(["SIGHUP", "SIGKILL"]);
  });

  it("stirbt die PTY nach dem SIGHUP, gibt es kein SIGKILL und keinen Timer mehr", () => {
    const { manager, created, timers } = esc();
    manager.spawn(spec("a"));
    void manager.kill("a");
    created[0].exit(129);
    expect(timers.pendingCount).toBe(0);
    timers.advance(10 * KILL_ESCALATION_MS);
    expect(created[0].signals).toEqual(["SIGHUP"]);
  });

  it("der SIGKILL-Timer feuert auch nach dem Entladen (Sitzungen sind dann längst vergessen)", () => {
    const { manager, created, timers } = esc();
    manager.spawn(spec("a"));
    manager.spawn(spec("b"));
    void manager.killAll();
    expect(manager.ids()).toEqual([]);
    expect(created.map((p) => p.signals)).toEqual([["SIGHUP"], ["SIGHUP"]]);
    created[1].exit(129);
    timers.advance(KILL_ESCALATION_MS);
    expect(created.map((p) => p.signals)).toEqual([["SIGHUP", "SIGKILL"], ["SIGHUP"]]);
  });

  it("SIGKILL geht an die Prozessgruppe, wenn die PTY eine pid hat; SIGHUP bleibt an der PTY", () => {
    const calls: Array<[number, string]> = [];
    const { manager, created, timers } = esc({ signalGroup: (pid, signal) => void calls.push([pid, signal]) });
    manager.spawn(spec("a"));
    created[0].pid = 4711;
    void manager.kill("a");
    timers.advance(KILL_ESCALATION_MS);
    expect(calls).toEqual([[4711, "SIGKILL"]]);
    expect(created[0].signals).toEqual(["SIGHUP"]);
  });

  it("scheitert das Gruppensignal, fällt SIGKILL auf die PTY zurück", () => {
    const { manager, created, timers } = esc({ signalGroup: () => { throw new Error("ESRCH"); } });
    manager.spawn(spec("a"));
    created[0].pid = 4711;
    void manager.kill("a");
    timers.advance(KILL_ESCALATION_MS);
    expect(created[0].signals).toEqual(["SIGHUP", "SIGKILL"]);
  });

  it("das Versprechen von kill löst bei Exit oder nach der Eskalation auf", async () => {
    const { manager, created, timers } = esc();
    manager.spawn(spec("a"));
    manager.spawn(spec("b"));
    let a = false;
    let b = false;
    void manager.kill("a").then(() => (a = true));
    void manager.kill("b").then(() => (b = true));
    created[0].exit(129);
    await Promise.resolve();
    await Promise.resolve();
    expect([a, b]).toEqual([true, false]);
    timers.advance(KILL_ESCALATION_MS);
    await Promise.resolve();
    await Promise.resolve();
    expect(b).toBe(true);
  });

  it("zweimal kill derselben id sendet nichts doppelt", () => {
    const { manager, created, timers } = esc();
    manager.spawn(spec("a"));
    void manager.kill("a");
    void manager.kill("a");
    timers.advance(KILL_ESCALATION_MS);
    expect(created[0].signals).toEqual(["SIGHUP", "SIGKILL"]);
  });

  it("eine schon beendete Sitzung bekommt kein Signal", () => {
    const { manager, created, timers } = esc();
    manager.spawn(spec("a"));
    created[0].exit(0);
    void manager.kill("a");
    expect(created[0].signals).toEqual([]);
    expect(timers.pendingCount).toBe(0);
  });

  it("wirft das Signal, läuft die Eskalation trotzdem weiter", () => {
    const { manager, created, timers } = esc();
    manager.spawn(spec("a"));
    created[0].kill = () => { throw new Error("ESRCH"); };
    expect(() => void manager.kill("a")).not.toThrow();
    expect(timers.pendingCount).toBe(1);
  });
});

describe("SessionManager.onChange (Abend 15, Sitzungsradar der Cockpit-Ansicht)", () => {
  it("meldet Start, Ende und Entfernen", () => {
    const { manager, created } = setup();
    let calls = 0;
    manager.onChange(() => calls++);

    manager.spawn(spec("a"));
    manager.spawn(spec("b"));
    expect(calls).toBe(2);

    created[0].exit(0);
    expect(calls).toBe(3);

    void manager.kill("b");
    expect(calls).toBe(4);
  });

  it("ein idempotenter Spawn und ein misslungener melden nichts", () => {
    const { manager } = setup();
    let calls = 0;
    manager.spawn(spec("a"));
    manager.onChange(() => calls++);
    manager.spawn(spec("a"));
    expect(calls).toBe(0);
    const boom = new SessionManager(() => { throw new Error("kaputt"); });
    boom.onChange(() => calls++);
    expect(boom.spawn(spec("x")).ok).toBe(false);
    expect(calls).toBe(0);
  });

  it("Abmelden wirkt; ein werfender Abonnent stört weder Manager noch andere", () => {
    const { manager } = setup();
    let a = 0;
    let b = 0;
    const off = manager.onChange(() => a++);
    manager.onChange(() => { b++; throw new Error("kaputt"); });
    off();
    expect(() => manager.spawn(spec("a"))).not.toThrow();
    expect(a).toBe(0);
    expect(b).toBe(1);
  });
});

describe("SessionManager.pidOf (IDE-Brücke, Abend 16)", () => {
  it("pid der laufenden PTY", () => {
    const { manager, created } = setup();
    manager.spawn(spec("a"));
    created[0].pid = 4711;
    expect(manager.pidOf("a")).toBe(4711);
  });
  it("beendet, unbekannt oder ohne pid: undefined", () => {
    const { manager, created } = setup();
    manager.spawn(spec("a"));
    expect(manager.pidOf("a")).toBeUndefined();
    created[0].pid = 4711;
    created[0].exit(0);
    expect(manager.pidOf("a")).toBeUndefined();
    expect(manager.pidOf("gibt-es-nicht")).toBeUndefined();
  });
});
