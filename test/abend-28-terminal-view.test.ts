import { mkdir, mkdtemp, rm, appendFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type CockpitSettings } from "../src/core/settings";
import type { SessionRecord } from "../src/core/session-model";
import type { TerminalDeps } from "../src/host/terminal-view";
import { TranscriptReader } from "../src/host/transcript-reader";

// Obsidian und alles mit DOM oder xterm ersetzen; die Entscheidungen der View laufen echt, mit echtem Leser auf einer Temp-Datei.
vi.mock("obsidian", () => ({
  ItemView: class {
    leaf: unknown;
    app = { workspace: { getActiveViewOfType: () => null } };
    contentEl = { isShown: () => false, doc: { hasFocus: () => false }, win: {} };
    constructor(leaf: unknown) {
      this.leaf = leaf;
    }
  },
  Notice: class {},
  Modal: class {},
}));
vi.mock("../src/host/attention-alert", () => ({ playSound: vi.fn(), showBanner: vi.fn() }));
vi.mock("../src/host/code-block-bar", () => ({ CodeBlockBar: class {}, copyCodeBlock: vi.fn() }));
vi.mock("../src/host/terminal-pane", () => ({ TerminalPane: class {} }));
vi.mock("../src/host/file-links", () => ({ FileLinkProvider: class {} }));
vi.mock("../src/host/file-viewer-fs", () => ({ isDirSync: () => false, isFileSync: () => false }));
vi.mock("../src/host/rename-modal", () => ({ RenameModal: class {} }));

const { TerminalView } = await import("../src/host/terminal-view");
const { playSound, showBanner } = await import("../src/host/attention-alert");

const COCKPIT_ID = "cockpit-1";
const ID = "11111111-2222-3333-4444-555555555555";
const OTHER_ID = "99999999-2222-3333-4444-555555555555";
const MIN = 60_000;
const AGENT = "toolu_01AAAAAAAAAAAAAAAAAAAAAA";
const BASH = "toolu_01BBBBBBBBBBBBBBBBBBBBBB";

// Transkriptzeilen im gemessenen Format, Zeitpunkte relativ zu jetzt (die View rechnet mit Date.now()).
const vor = (min: number): string => new Date(Date.now() - min * MIN).toISOString();
const start = (id: string, toolUseResult: unknown, min: number): string =>
  JSON.stringify({
    type: "user", timestamp: vor(min),
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "Ergebnis" }] },
    toolUseResult,
  });
const agentStart = (id: string, min = 5): string => start(id, { isAsync: true, status: "async_launched", agentId: "a1b2c3", description: "Beispiel" }, min);
const bashStart = (id: string, min = 5): string => start(id, { stdout: "", stderr: "", backgroundTaskId: "b2cy2wz5n" }, min);
const ende = (id: string): string =>
  JSON.stringify({
    type: "queue-operation", operation: "enqueue", timestamp: vor(0),
    content: `<task-notification>\n<task-id>b1</task-id>\n<tool-use-id>${id}</tool-use-id>\n<status>completed</status>\n</task-notification>`,
  });

/** Was von der View aus dem Test heraus erreichbar sein muss. */
interface Intern {
  sessionId: string | null;
  reader: TranscriptReader | null;
  readerId: string | null;
  attention: string | null;
  openTasks: number;
  onAttention(signal: "done" | "question"): void;
  doneAfterCheck(): Promise<void>;
  updateOpenTasks(): void;
  pollTranscript(): Promise<void>;
  leave(): void;
  getDisplayText(): string;
  refreshTitle(): void;
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cockpit-abend28-"));
  vi.mocked(playSound).mockClear();
  vi.mocked(showBanner).mockClear();
});
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

async function schreibe(zeilen: string[]): Promise<void> {
  await mkdir(join(root, "proj"), { recursive: true });
  await writeFile(join(root, "proj", `${ID}.jsonl`), zeilen.join("\n") + "\n");
}
const haenge = (zeilen: string[]): Promise<void> => appendFile(join(root, "proj", `${ID}.jsonl`), zeilen.join("\n") + "\n");

function aufbau(overrides: Partial<CockpitSettings> = {}, mitLeser = true, recordOverrides: Partial<SessionRecord> = {}) {
  const settings: CockpitSettings = { ...DEFAULT_SETTINGS, ...overrides };
  const deps = {
    settings: () => settings,
    home: "/home/beispiel",
    record: () => ({ id: COCKPIT_ID, name: "Sitzung", kind: "claude", cwd: "/tmp/beispiel", createdAt: "2026-10-12T10:00:00Z", claudeSessionId: ID, ...recordOverrides }),
    telegram: vi.fn(),
    activity: { record: vi.fn(), markSeen: vi.fn(), lastSignal: vi.fn(() => undefined) },
    alertGate: vi.fn(() => true),
    handoffs: { keep: vi.fn(), get: vi.fn(() => null) },
  };
  const leaf = { updateHeader: vi.fn(), tabHeaderEl: { toggleClass: vi.fn(), setAttr: vi.fn() } };
  const view = new TerminalView(leaf as never, deps as unknown as TerminalDeps);
  const intern = view as unknown as Intern;
  intern.sessionId = COCKPIT_ID;
  const reader = new TranscriptReader(ID, root);
  if (mitLeser) {
    intern.reader = reader;
    intern.readerId = ID;
  }
  return { deps, intern, reader, leaf };
}

/** Wartet, bis der asynchrone Teil von onAttention durch ist (er meldet entweder oder setzt die Lampe auf busy). */
async function fertig(deps: ReturnType<typeof aufbau>["deps"]): Promise<void> {
  await vi.waitFor(() => {
    const signale = deps.activity.record.mock.calls.map((c) => c[1]);
    expect(signale.some((s) => s === "busy" || s === "done")).toBe(true);
  });
}

function gemeldet(deps: ReturnType<typeof aufbau>["deps"], intern: Intern): void {
  expect(deps.telegram).toHaveBeenCalledTimes(1);
  expect(deps.telegram).toHaveBeenCalledWith(COCKPIT_ID, "done");
  expect(deps.activity.record).toHaveBeenCalledWith(COCKPIT_ID, "done");
  expect(playSound).toHaveBeenCalledTimes(1);
  expect(showBanner).toHaveBeenCalledTimes(1);
  expect(intern.attention).toBe("done");
}

function still(deps: ReturnType<typeof aufbau>["deps"], intern: Intern): void {
  expect(deps.telegram).not.toHaveBeenCalled();
  expect(playSound).not.toHaveBeenCalled();
  expect(showBanner).not.toHaveBeenCalled();
  expect(deps.activity.markSeen).not.toHaveBeenCalled();
  expect(deps.activity.record).toHaveBeenCalledTimes(1);
  expect(deps.activity.record).toHaveBeenCalledWith(COCKPIT_ID, "busy");
  expect(intern.attention).toBeNull();
}

describe("Abend 28 (Verhalten der View): Antwortende bei laufenden Hintergrundaufgaben", () => {
  it("done mit laufendem Agent: nichts geht raus (kein Telegram, Ton, Banner, Markierung), die Lampe bleibt auf arbeitet", async () => {
    await schreibe([agentStart(AGENT)]);
    const { deps, intern } = aufbau();
    intern.onAttention("done");
    await fertig(deps);
    still(deps, intern);
  });

  it("jede Startart hält das Antwortende still: Workflow, Bash, MCP", async () => {
    const workflow = start("toolu_01WWWWWWWWWWWWWWWWWWWWWW", { status: "async_launched", taskType: "local_workflow", workflowName: "beispiel" }, 5);
    const mcp = JSON.stringify({
      type: "user", timestamp: vor(5),
      message: { content: [{ type: "tool_result", tool_use_id: "toolu_01MMMMMMMMMMMMMMMMMMMMMM", content: 'MCP tool "x" is still running after 120s. It was moved to the background as task k1 and keeps running.' }] },
      toolUseResult: [{ type: "text", text: "..." }],
    });
    for (const zeile of [workflow, bashStart(BASH), mcp]) {
      await schreibe([zeile]);
      const { deps, intern } = aufbau();
      intern.onAttention("done");
      await fertig(deps);
      still(deps, intern);
    }
  });

  it("done ohne Hintergrundaufgaben: meldet wie bisher (Telegram, Ton, Banner, Markierung)", async () => {
    await schreibe([JSON.stringify({ type: "assistant", message: { id: "m", content: [{ type: "text", text: "fertig" }] } })]);
    const { deps, intern } = aufbau();
    intern.onAttention("done");
    await fertig(deps);
    gemeldet(deps, intern);
  });

  it("done, nachdem alle Aufgaben fertig gemeldet haben: meldet", async () => {
    await schreibe([agentStart(AGENT), bashStart(BASH), ende(AGENT), ende(BASH)]);
    const { deps, intern } = aufbau();
    intern.onAttention("done");
    await fertig(deps);
    gemeldet(deps, intern);
  });

  it("erst still, dann gemeldet: das done, nach dem nichts mehr läuft, meldet genau einmal", async () => {
    await schreibe([agentStart(AGENT), bashStart(BASH)]);
    const { deps, intern } = aufbau();
    intern.onAttention("done");
    await fertig(deps);
    still(deps, intern);
    // Ein Agent ist fertig, der Chat schreibt einen Zwischenstand: wieder still.
    await haenge([ende(AGENT)]);
    deps.activity.record.mockClear();
    intern.onAttention("done");
    await fertig(deps);
    expect(deps.telegram).not.toHaveBeenCalled();
    expect(intern.openTasks).toBe(1);
    // Der letzte ist fertig: jetzt meldet es.
    await haenge([ende(BASH)]);
    deps.activity.record.mockClear();
    intern.onAttention("done");
    await fertig(deps);
    gemeldet(deps, intern);
    expect(intern.openTasks).toBe(0);
  });

  it("ein Start über dem Höchstalter hält nicht mehr still (sonst schaltete ein verlorenes Ende für immer stumm)", async () => {
    await schreibe([agentStart(AGENT, 61)]);
    const { deps, intern } = aufbau({ quietMaxAgeMin: 60 });
    intern.onAttention("done");
    await fertig(deps);
    gemeldet(deps, intern);
  });

  it("das Höchstalter kommt aus den Einstellungen: dieselbe Aufgabe ist mit 120 Minuten noch offen", async () => {
    await schreibe([agentStart(AGENT, 61)]);
    const { deps, intern } = aufbau({ quietMaxAgeMin: 120 });
    intern.onAttention("done");
    await fertig(deps);
    still(deps, intern);
  });

  it("Schalter aus: auch mit laufender Aufgabe meldet das done sofort, ohne das Transkript zu lesen", async () => {
    await schreibe([agentStart(AGENT)]);
    const { deps, intern, reader } = aufbau({ quietWhileAgents: false });
    const lesen = vi.spyOn(reader, "read");
    intern.onAttention("done");
    gemeldet(deps, intern);
    expect(lesen).not.toHaveBeenCalled();
  });

  it("eine Frage meldet immer, sofort und ohne zu lesen, auch bei laufender Aufgabe", async () => {
    await schreibe([agentStart(AGENT)]);
    const { deps, intern, reader } = aufbau();
    const lesen = vi.spyOn(reader, "read");
    intern.onAttention("question");
    expect(deps.telegram).toHaveBeenCalledTimes(1);
    expect(deps.telegram).toHaveBeenCalledWith(COCKPIT_ID, "question");
    expect(deps.activity.record).toHaveBeenCalledWith(COCKPIT_ID, "question");
    expect(intern.attention).toBe("question");
    expect(lesen).not.toHaveBeenCalled();
  });

  it("ohne Leser (Shell, kein Transkript): done meldet sofort", async () => {
    const { deps, intern } = aufbau({}, false);
    intern.onAttention("done");
    gemeldet(deps, intern);
  });

  it("Lesefehler: das done wird gemeldet statt verschluckt", async () => {
    await schreibe([agentStart(AGENT)]);
    const { deps, intern, reader } = aufbau();
    const fehler = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(reader, "read").mockRejectedValue(new Error("nicht lesbar"));
    intern.onAttention("done");
    await fertig(deps);
    gemeldet(deps, intern);
    expect(fehler).toHaveBeenCalled();
  });

  it("Sitzungswechsel während des Lesens (neuer Leser nach /clear): das done wird gemeldet", async () => {
    await schreibe([agentStart(AGENT)]);
    const { deps, intern, reader } = aufbau();
    const echt = reader.read.bind(reader);
    vi.spyOn(reader, "read").mockImplementation(async (...args) => {
      intern.reader = new TranscriptReader(OTHER_ID, root);
      intern.readerId = OTHER_ID;
      return echt(...args);
    });
    intern.onAttention("done");
    await fertig(deps);
    gemeldet(deps, intern);
  });

  it("wiederholte Frage bleibt still wie bisher (repeatsQuestion gilt nur in notifyAttention)", async () => {
    const { deps, intern } = aufbau({}, false);
    deps.activity.lastSignal.mockReturnValue("question" as never);
    intern.onAttention("question");
    expect(deps.telegram).not.toHaveBeenCalled();
  });
});

describe("Abend 28 (Verhalten der View): Zahl im Tab-Titel", () => {
  it("offene Aufgaben stehen als ⏳ <Zahl> vor dem Titel, wenn showOpenTasks an ist", async () => {
    await schreibe([agentStart(AGENT), bashStart(BASH)]);
    const { intern, reader, leaf } = aufbau();
    await reader.read();
    expect(intern.getDisplayText()).not.toContain("⏳");
    intern.updateOpenTasks();
    expect(intern.openTasks).toBe(2);
    expect(intern.getDisplayText()).toMatch(/^⏳ 2 11111111 · Sitzung$/);
    expect(leaf.updateHeader).toHaveBeenCalled();
  });

  it("showOpenTasks aus: die Zahl wird gezählt, aber nicht gezeigt", async () => {
    await schreibe([agentStart(AGENT)]);
    const { intern, reader } = aufbau({ showOpenTasks: false });
    await reader.read();
    intern.updateOpenTasks();
    expect(intern.openTasks).toBe(1);
    expect(intern.getDisplayText()).not.toContain("⏳");
  });

  it("die Zahl sinkt, wenn Aufgaben enden, und fehlt ohne Leser", async () => {
    await schreibe([agentStart(AGENT), bashStart(BASH)]);
    const { intern, reader } = aufbau();
    await reader.read();
    intern.updateOpenTasks();
    await haenge([ende(AGENT)]);
    await reader.read();
    intern.updateOpenTasks();
    expect(intern.getDisplayText()).toMatch(/^⏳ 1 11111111 · Sitzung$/);
    intern.reader = null;
    intern.updateOpenTasks();
    expect(intern.openTasks).toBe(0);
    expect(intern.getDisplayText()).not.toContain("⏳");
  });

  it("Markierung und Zahl zusammen: ● ⏳ 1 vor dem Titel", async () => {
    await schreibe([agentStart(AGENT)]);
    const { intern, reader } = aufbau();
    await reader.read();
    intern.updateOpenTasks();
    intern.attention = "done";
    expect(intern.getDisplayText()).toMatch(/^● ⏳ 1 11111111 · Sitzung$/);
  });

  it("der Poll zählt nach jedem Durchlauf neu, auch bei unveränderter Datei: ein abgelaufener Start verschwindet aus dem Titel", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T12:00:00.000Z"));
    await schreibe([agentStart(AGENT, 59)]);
    const { intern } = aufbau({ quietMaxAgeMin: 60 });
    await intern.pollTranscript();
    expect(intern.getDisplayText()).toMatch(/^⏳ 1 11111111 · Sitzung$/);
    // Zwei Minuten später, die Datei ist dieselbe: der Start ist 61 Minuten alt und zählt nicht mehr.
    vi.setSystemTime(new Date("2026-10-12T12:02:00.000Z"));
    await intern.pollTranscript();
    expect(intern.openTasks).toBe(0);
    expect(intern.getDisplayText()).not.toContain("⏳");
  });

  it("auch wenn das Lesen im Poll dauerhaft wirft, altert die Zahl aus: ein abgelaufener Start verschwindet aus dem Titel (Abend 29)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T12:00:00.000Z"));
    await schreibe([agentStart(AGENT, 59)]);
    const { intern, reader } = aufbau({ quietMaxAgeMin: 60 });
    await intern.pollTranscript();
    expect(intern.getDisplayText()).toMatch(/^⏳ 1 11111111 · Sitzung$/);
    // Ab jetzt ist das Transkript nicht mehr lesbar; der Leser behält seinen letzten Stand.
    const fehler = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(reader, "read").mockRejectedValue(new Error("nicht lesbar"));
    // Zwei Minuten später ist der Start 61 Minuten alt und zählt nicht mehr.
    vi.setSystemTime(new Date("2026-10-12T12:02:00.000Z"));
    await intern.pollTranscript();
    expect(fehler).toHaveBeenCalled();
    expect(intern.openTasks).toBe(0);
    expect(intern.getDisplayText()).not.toContain("⏳");
  });

  it("Sitzungswechsel während des Lesens (Fehler oder nicht): der alte Poll zählt die Zahl des neuen Lesers nicht um (Abend 29)", async () => {
    await schreibe([agentStart(AGENT)]);
    const { intern, reader } = aufbau();
    await intern.pollTranscript();
    expect(intern.openTasks).toBe(1);
    const fehler = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(reader, "read").mockImplementation(async () => {
      intern.reader = null; // /clear oder leave während des Lesens
      throw new Error("nicht lesbar");
    });
    const update = vi.spyOn(intern as unknown as { updateOpenTasks(): void }, "updateOpenTasks");
    await intern.pollTranscript();
    expect(fehler).toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("verlässt die View die Sitzung (leave), steht keine Zahl mehr im Titel", async () => {
    await schreibe([agentStart(AGENT)]);
    const { intern, leaf } = aufbau();
    await intern.pollTranscript();
    expect(intern.openTasks).toBe(1);
    leaf.updateHeader.mockClear();
    intern.leave();
    expect(intern.openTasks).toBe(0);
    expect(intern.reader).toBeNull();
    expect(leaf.updateHeader).toHaveBeenCalled();
    expect(intern.getDisplayText()).not.toContain("⏳");
  });
});

describe("Abend 29: Tab-Titel „ID · Name“ und Tooltip", () => {
  const ID8 = ID.slice(0, 8);

  it("der Tab zeigt die Kurz-ID vorn, dann den Namen; Marken stehen davor", () => {
    const { intern } = aufbau({}, false);
    expect(intern.getDisplayText()).toBe(`${ID8} · Sitzung`);
    intern.attention = "question";
    expect(intern.getDisplayText()).toBe(`? ${ID8} · Sitzung`);
  });

  it("Wächter: refreshTitle schreibt ID, Name und Ordner als aria-label an den Tab-Kopf, genau wie in der Kopfzeile", () => {
    const { intern, leaf } = aufbau({}, false, { name: "claude 4", cwd: "/home/beispiel/projekt-a" });
    const titleEl = { setText: vi.fn() };
    (intern as unknown as { titleEl: typeof titleEl }).titleEl = titleEl;
    intern.refreshTitle();
    const erwartet = `${ID8} · claude 4 · ~/projekt-a`;
    expect(leaf.updateHeader).toHaveBeenCalled();
    expect(leaf.tabHeaderEl.setAttr).toHaveBeenCalledWith("aria-label", erwartet);
    expect(titleEl.setText).toHaveBeenCalledWith(erwartet);
  });

  it("Wächter: das aria-label ist nie leer und nennt immer ID, Name und Ordner", () => {
    const { intern, leaf } = aufbau({}, false);
    intern.refreshTitle();
    const aufrufe = leaf.tabHeaderEl.setAttr.mock.calls.filter((c) => c[0] === "aria-label");
    expect(aufrufe).toHaveLength(1);
    const label = String(aufrufe[0][1]);
    expect(label).not.toBe("");
    for (const teil of [ID8, "Sitzung", "/tmp/beispiel"]) expect(label, teil).toContain(teil);
  });
});
