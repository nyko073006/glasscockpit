import { describe, expect, it } from "vitest";
import { MAX_BG_TASKS } from "../src/core/constants";
import { BackgroundTasks, scanBackgroundTasks } from "../src/core/background-tasks";

// Zeilen im echten Transkriptformat (gemessen 12.10.2026), mit neutralen Werten.
const T0 = Date.parse("2026-10-12T10:00:00.000Z");
const MIN = 60_000;
const iso = (ms: number): string => new Date(ms).toISOString();
const jsonl = (...zeilen: string[]): string => zeilen.join("\n") + "\n";
const zeile = (eintrag: unknown): string => JSON.stringify(eintrag);

const ID_A = "toolu_01AAAAAAAAAAAAAAAAAAAAAA";
const ID_B = "toolu_01BBBBBBBBBBBBBBBBBBBBBB";
const ID_C = "toolu_01CCCCCCCCCCCCCCCCCCCCCC";

/** Start-Eintrag: user mit tool_result-Block und dem Feld toolUseResult auf oberster Ebene. */
function start(id: string, toolUseResult: unknown, opts: { at?: number | null; text?: unknown } = {}): string {
  const at = opts.at === undefined ? T0 : opts.at;
  return zeile({
    type: "user",
    ...(at === null ? {} : { timestamp: iso(at) }),
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: opts.text ?? "Ergebnis" }] },
    toolUseResult,
  });
}

const agentAsync = (id: string, at?: number): string =>
  start(id, { isAsync: true, status: "async_launched", agentId: "a1b2c3d4", description: "Beispielaufgabe", outputFile: "/tmp/beispiel/agent.output", canReadOutputFile: true, canContinueAgent: true, resolvedModel: "modell", prompt: "Aufgabe" }, { at });
const workflow = (id: string, at?: number): string =>
  start(id, { status: "async_launched", taskId: "w1x2y3", taskType: "local_workflow", workflowName: "beispiel", runId: "wf_1", summary: "Beispiel", transcriptDir: "/tmp/beispiel/wf", scriptPath: "/tmp/beispiel/wf/script.js" }, { at });
const bashBg = (id: string, at?: number): string =>
  start(id, { stdout: "", stderr: "", interrupted: false, isImage: false, noOutputExpected: false, backgroundTaskId: "b2cy2wz5n" }, { at });
const bashTimeout = (id: string, at?: number): string =>
  start(id, { stdout: "", stderr: "", interrupted: false, isImage: false, noOutputExpected: false, backgroundTaskId: "b9zz", timedOutAfterMs: 120000 }, { at });
const MCP_TEXT = 'MCP tool "plugin:x:y/z" is still running after 120s. It was moved to the background as task kj3ql2yg7 and keeps running; you\'ll receive a notification with the result when it completes.';
const mcpBg = (id: string, at?: number): string => start(id, [{ type: "text", text: "..." }], { at, text: MCP_TEXT });

/** Die Fertig-Meldung, wie Claude Code sie in den Strom legt. */
const note = (id: string, status = "completed"): string =>
  `<task-notification>\n<task-id>b2cy2wz5n</task-id>\n<tool-use-id>${id}</tool-use-id>\n<output-file>/tmp/beispiel/tasks/b2cy2wz5n.output</output-file>\n<status>${status}</status>\n<summary>Hintergrund-Befehl beendet (exit code 0)</summary>\n</task-notification>`;
const endUser = (id: string, status?: string): string =>
  zeile({ type: "user", timestamp: iso(T0 + MIN), message: { role: "user", content: note(id, status) } });
const endUserBlocks = (id: string): string =>
  zeile({ type: "user", timestamp: iso(T0 + MIN), message: { role: "user", content: [{ type: "text", text: note(id) }] } });
const endQueue = (id: string, operation = "enqueue"): string =>
  zeile({ type: "queue-operation", operation, timestamp: iso(T0 + MIN), sessionId: "s1", content: note(id) });
const endAttachment = (id: string): string =>
  zeile({ type: "attachment", timestamp: iso(T0 + MIN), attachment: { type: "queued_command", prompt: note(id) } });

const offen = (text: string, now = T0 + 5 * MIN, maxAge = 60 * MIN): number => {
  const tasks = new BackgroundTasks();
  tasks.merge(scanBackgroundTasks(text));
  return tasks.open(now, maxAge);
};

describe("scanBackgroundTasks: Starts", () => {
  it("leerer Text: nichts", () => {
    expect(scanBackgroundTasks("")).toEqual({ starts: [], ends: [] });
  });
  it("Agent im Hintergrund (async_launched): Start mit ID und Zeitpunkt", () => {
    expect(scanBackgroundTasks(jsonl(agentAsync(ID_A)))).toEqual({ starts: [{ id: ID_A, at: T0 }], ends: [] });
  });
  it("Workflow (taskType local_workflow, async_launched): Start", () => {
    expect(scanBackgroundTasks(jsonl(workflow(ID_A))).starts).toEqual([{ id: ID_A, at: T0 }]);
  });
  it("Bash mit backgroundTaskId: Start", () => {
    expect(scanBackgroundTasks(jsonl(bashBg(ID_A))).starts).toEqual([{ id: ID_A, at: T0 }]);
  });
  it("Bash, der nach dem Zeitlimit in den Hintergrund ging (backgroundTaskId plus timedOutAfterMs): Start", () => {
    expect(scanBackgroundTasks(jsonl(bashTimeout(ID_A))).starts).toEqual([{ id: ID_A, at: T0 }]);
  });
  it("MCP-Werkzeug in den Hintergrund verschoben (toolUseResult ist ein Array): Start nur am Text, String und Textblöcke", () => {
    expect(scanBackgroundTasks(jsonl(mcpBg(ID_A))).starts).toEqual([{ id: ID_A, at: T0 }]);
    const alsBloecke = start(ID_B, [{ type: "text", text: "..." }], { text: [{ type: "text", text: MCP_TEXT }] });
    expect(scanBackgroundTasks(jsonl(alsBloecke)).starts).toEqual([{ id: ID_B, at: T0 }]);
  });
  it("SendMessage an einen beendeten Agenten (resumedAgentId): Start, er läuft wieder im Hintergrund", () => {
    const weiter = start(ID_A, { success: true, message: "Resuming agent a1b2c3d", resumedAgentId: "a1b2c3d4e5f6", pin: { id: "a1b2c3d4e5f6", name: "a1b2c3d4e5f6", ref: "r1" } });
    expect(scanBackgroundTasks(jsonl(weiter)).starts).toEqual([{ id: ID_A, at: T0 }]);
  });
  it("SendMessage ohne resumedAgentId (in die Warteschlange, an eine andere Sitzung, leer): kein Start, dafür kommt keine Meldung", () => {
    const warteschlange = start(ID_A, { success: true, message: "Message queued for delivery to a9ee7ce at its next tool round", pin: { id: "a9ee7ce", name: "a9ee7ce", ref: "r2" } });
    const andereSitzung = start(ID_B, { success: true, message: "Plan an andere Sitzung", display: "an claude gesendet", msg_id: "m1" });
    const leer = start(ID_C, { success: true, message: "Resuming agent", resumedAgentId: "" });
    expect(scanBackgroundTasks(jsonl(warteschlange, andereSitzung, leer)).starts).toEqual([]);
  });
  it("Vordergrund-Agent (toolUseResult ohne async_launched): kein Start", () => {
    const vordergrund = start(ID_A, { status: "completed", agentId: "a1b2", content: [{ type: "text", text: "fertig" }], totalDurationMs: 1200 });
    expect(scanBackgroundTasks(jsonl(vordergrund))).toEqual({ starts: [], ends: [] });
  });
  it("Bash ohne backgroundTaskId ist nie ein Start, auch nicht bei leerer oder fremd typisierter ID", () => {
    const ohne = start(ID_A, { stdout: "ok", stderr: "", interrupted: false, isImage: false, noOutputExpected: false });
    const leer = start(ID_B, { stdout: "", stderr: "", backgroundTaskId: "" });
    const zahl = start(ID_C, { stdout: "", stderr: "", backgroundTaskId: 42 });
    expect(scanBackgroundTasks(jsonl(ohne, leer, zahl)).starts).toEqual([]);
  });
  it("Bash-stdout, das 'Async agent launched successfully' enthält (grep-Ausgabe): weder Start noch Ende", () => {
    const grep = start(ID_A, { stdout: "Async agent launched successfully.\nagentId: a1b2", stderr: "", interrupted: false }, { text: "Async agent launched successfully." });
    expect(scanBackgroundTasks(jsonl(grep))).toEqual({ starts: [], ends: [] });
  });
  it("Bash-stdout mit einem task-notification-Block: weder Start noch Ende, eine fremde offene Aufgabe bleibt offen", () => {
    const grep = start(ID_B, { stdout: note(ID_A), stderr: "", interrupted: false }, { text: note(ID_A) });
    expect(scanBackgroundTasks(jsonl(grep))).toEqual({ starts: [], ends: [] });
    expect(offen(jsonl(agentAsync(ID_A), grep))).toBe(1);
  });
  it("MCP-Satz im Text, aber toolUseResult ist ein Objekt (etwa eine Bash-Ausgabe): kein Start", () => {
    expect(scanBackgroundTasks(jsonl(start(ID_A, { stdout: MCP_TEXT, stderr: "" }, { text: MCP_TEXT }))).starts).toEqual([]);
  });
  it("Eintrag ohne tool_use_id oder mit mehreren tool_result-Blöcken: kein Start (im Zweifel melden)", () => {
    const ohneId = zeile({ type: "user", timestamp: iso(T0), message: { content: [{ type: "tool_result", content: "x" }] }, toolUseResult: { status: "async_launched" } });
    const zwei = zeile({
      type: "user", timestamp: iso(T0),
      message: { content: [{ type: "tool_result", tool_use_id: ID_A, content: "a" }, { type: "tool_result", tool_use_id: ID_B, content: "b" }] },
      toolUseResult: { status: "async_launched" },
    });
    expect(scanBackgroundTasks(jsonl(ohneId, zwei)).starts).toEqual([]);
  });
  it("nur user-Einträge starten: dasselbe Feld in einem assistant-Eintrag zählt nicht", () => {
    const fremd = zeile({ type: "assistant", timestamp: iso(T0), message: { content: [{ type: "tool_result", tool_use_id: ID_A, content: "x" }] }, toolUseResult: { status: "async_launched" } });
    expect(scanBackgroundTasks(jsonl(fremd)).starts).toEqual([]);
  });
  it("fehlender, kaputter oder nicht textlicher timestamp: kein Start", () => {
    const ohne = agentAsync(ID_A).replace(/"timestamp":"[^"]*",/, "");
    expect(ohne).not.toContain("timestamp");
    const kaputt = start(ID_B, { status: "async_launched" }, { at: null }).replace("{", '{"timestamp":"gestern",');
    const zahl = start(ID_C, { status: "async_launched" }, { at: null }).replace("{", '{"timestamp":1760263200000,');
    expect(scanBackgroundTasks(jsonl(ohne, kaputt, zahl)).starts).toEqual([]);
  });
  it("derselbe Start mehrfach: einmal, der erste Zeitpunkt gewinnt", () => {
    const scan = scanBackgroundTasks(jsonl(agentAsync(ID_A, T0), agentAsync(ID_A, T0 + 10 * MIN)));
    expect(scan.starts).toEqual([{ id: ID_A, at: T0 }]);
  });
});

describe("scanBackgroundTasks: Enden", () => {
  it("Notification als user-String: Ende, jeder Status zählt", () => {
    expect(scanBackgroundTasks(jsonl(endUser(ID_A))).ends).toEqual([ID_A]);
    for (const status of ["completed", "failed", "killed", "stopped", "etwas-Neues"]) {
      expect(scanBackgroundTasks(jsonl(endUser(ID_A, status))).ends, status).toEqual([ID_A]);
    }
  });
  it("Notification als user-Array aus Textblöcken: Ende", () => {
    expect(scanBackgroundTasks(jsonl(endUserBlocks(ID_A))).ends).toEqual([ID_A]);
  });
  it("Notification als queue-operation (enqueue wie remove) oder attachment: Ende", () => {
    expect(scanBackgroundTasks(jsonl(endQueue(ID_A, "enqueue"))).ends).toEqual([ID_A]);
    expect(scanBackgroundTasks(jsonl(endQueue(ID_A, "remove"))).ends).toEqual([ID_A]);
    expect(scanBackgroundTasks(jsonl(endAttachment(ID_A))).ends).toEqual([ID_A]);
  });
  it("dieselbe Notification in user, queue-operation und attachment: eine ID, und der Start einmal", () => {
    const scan = scanBackgroundTasks(jsonl(agentAsync(ID_A), agentAsync(ID_A), endUser(ID_A), endQueue(ID_A), endAttachment(ID_A)));
    expect(scan.starts).toEqual([{ id: ID_A, at: T0 }]);
    expect(scan.ends).toEqual([ID_A]);
  });
  it("mehrere Notifications in einem Eintrag: alle IDs", () => {
    const eintrag = zeile({ type: "queue-operation", operation: "enqueue", content: `${note(ID_A)}\n${note(ID_B, "failed")}` });
    expect(scanBackgroundTasks(jsonl(eintrag)).ends).toEqual([ID_A, ID_B]);
  });
  it("assistant-Text mit task-notification und passender ID: kein Ende (Claude zitiert solche Blöcke)", () => {
    const zitat = zeile({ type: "assistant", timestamp: iso(T0), message: { content: [{ type: "text", text: note(ID_A) }] } });
    expect(scanBackgroundTasks(jsonl(zitat)).ends).toEqual([]);
    expect(offen(jsonl(agentAsync(ID_A), zitat))).toBe(1);
  });
  it("user-Eintrag mit tool_result-Block: kein Ende, auch wenn der Text eine Notification enthält", () => {
    const mitErgebnis = zeile({
      type: "user", timestamp: iso(T0),
      message: { content: [{ type: "text", text: note(ID_A) }, { type: "tool_result", tool_use_id: ID_B, content: note(ID_A) }] },
    });
    expect(scanBackgroundTasks(jsonl(mitErgebnis)).ends).toEqual([]);
  });
  it("andere Eintragstypen (system, summary) zählen nicht als Ende", () => {
    const system = zeile({ type: "system", content: note(ID_A) });
    const summary = zeile({ type: "summary", summary: note(ID_A) });
    expect(scanBackgroundTasks(jsonl(system, summary)).ends).toEqual([]);
  });
  it("tool-use-id ohne task-notification-Block drumherum: kein Ende", () => {
    const lose = zeile({ type: "queue-operation", operation: "enqueue", content: `<tool-use-id>${ID_A}</tool-use-id>` });
    expect(scanBackgroundTasks(jsonl(lose)).ends).toEqual([]);
  });
});

describe("scanBackgroundTasks: Zeilen", () => {
  it("kaputte und abgeschnittene Zeilen werden übersprungen, die übrigen zählen", () => {
    const abgeschnitten = agentAsync(ID_B).slice(40);
    const text = jsonl("{kein json", abgeschnitten, agentAsync(ID_A), '{"type":"user","message":', endUser(ID_C));
    const scan = scanBackgroundTasks(text);
    expect(scan.starts).toEqual([{ id: ID_A, at: T0 }]);
    expect(scan.ends).toEqual([ID_C]);
  });
  it("Einträge ohne Objekt oder ohne Typ stören nicht", () => {
    expect(scanBackgroundTasks(jsonl("null", "42", '"text"', "[]", "{}", zeile({ type: 5 })))).toEqual({ starts: [], ends: [] });
  });
});

describe("BackgroundTasks: offene Aufgaben", () => {
  it("Start und Notification als user-String: 0 offen", () => {
    expect(offen(jsonl(agentAsync(ID_A), endUser(ID_A)))).toBe(0);
  });
  it("Start ohne Ende: 1 offen; jede Startart zählt mit", () => {
    expect(offen(jsonl(agentAsync(ID_A)))).toBe(1);
    expect(offen(jsonl(agentAsync(ID_A), workflow(ID_B), bashBg(ID_C)))).toBe(3);
    expect(offen(jsonl(bashTimeout(ID_A), mcpBg(ID_B)))).toBe(2);
  });
  it("Ende nur als queue-operation zählt", () => {
    expect(offen(jsonl(bashBg(ID_A), endQueue(ID_A)))).toBe(0);
  });
  it("zwei Starts, ein Ende: 1 offen", () => {
    expect(offen(jsonl(agentAsync(ID_A), agentAsync(ID_B), endUser(ID_A)))).toBe(1);
  });
  it("Ende für eine unbekannte ID (Start vor dem gelesenen Ende der Datei): nie unter 0", () => {
    expect(offen(jsonl(endUser(ID_A), endQueue(ID_B)))).toBe(0);
  });
  it("Start älter als das Höchstalter: nicht mehr offen; genau an der Grenze: noch offen", () => {
    const text = jsonl(agentAsync(ID_A, T0));
    expect(offen(text, T0 + 60 * MIN + 1, 60 * MIN)).toBe(0);
    expect(offen(text, T0 + 60 * MIN, 60 * MIN)).toBe(1);
    expect(offen(text, T0 + 60 * MIN - 1, 60 * MIN)).toBe(1);
  });
  it("das Höchstalter wirkt je Start: der alte fällt weg, der junge bleibt", () => {
    const text = jsonl(agentAsync(ID_A, T0), agentAsync(ID_B, T0 + 50 * MIN));
    expect(offen(text, T0 + 70 * MIN, 60 * MIN)).toBe(1);
  });
  it("ungültiges Höchstalter (NaN): nichts gilt als offen, im Zweifel wird gemeldet", () => {
    expect(offen(jsonl(agentAsync(ID_A)), T0, Number.NaN)).toBe(0);
  });
  it("Start im ersten Scan, Ende im zweiten: 0 offen", () => {
    const tasks = new BackgroundTasks();
    tasks.merge(scanBackgroundTasks(jsonl(agentAsync(ID_A), agentAsync(ID_B))));
    expect(tasks.open(T0 + MIN, 60 * MIN)).toBe(2);
    tasks.merge(scanBackgroundTasks(jsonl(endQueue(ID_A))));
    expect(tasks.open(T0 + MIN, 60 * MIN)).toBe(1);
    tasks.merge(scanBackgroundTasks(jsonl(endUser(ID_B))));
    expect(tasks.open(T0 + MIN, 60 * MIN)).toBe(0);
  });
  it("derselbe Scan mehrfach gemerged (der Leser liest das Ende der Datei jedes Mal neu): ändert nichts", () => {
    const scan = scanBackgroundTasks(jsonl(agentAsync(ID_A), agentAsync(ID_B), endUser(ID_A)));
    const tasks = new BackgroundTasks();
    for (let i = 0; i < 5; i++) tasks.merge(scan);
    expect(tasks.open(T0 + MIN, 60 * MIN)).toBe(1);
    expect(tasks.counts()).toEqual({ starts: 2, ends: 1 });
  });
  it("beim erneuten Merge gewinnt der erste Zeitpunkt eines Starts", () => {
    const tasks = new BackgroundTasks();
    tasks.merge({ starts: [{ id: ID_A, at: T0 }], ends: [] });
    tasks.merge({ starts: [{ id: ID_A, at: T0 + 50 * MIN }], ends: [] });
    expect(tasks.open(T0 + 61 * MIN, 60 * MIN)).toBe(0);
  });
  it("Ende vor dem Start (umgekehrte Reihenfolge der Scans): 0 offen", () => {
    const tasks = new BackgroundTasks();
    tasks.merge({ starts: [], ends: [ID_A] });
    tasks.merge({ starts: [{ id: ID_A, at: T0 }], ends: [] });
    expect(tasks.open(T0, 60 * MIN)).toBe(0);
  });
  it("leerer Zustand: 0", () => {
    expect(new BackgroundTasks().open(T0, 60 * MIN)).toBe(0);
  });
});

describe("BackgroundTasks: Begrenzung auf MAX_BG_TASKS", () => {
  const id = (i: number): string => `toolu_${String(i).padStart(6, "0")}`;
  const viele = (n: number): { id: string; at: number }[] => Array.from({ length: n }, (_, i) => ({ id: id(i), at: T0 + i * 1000 }));

  it("MAX_BG_TASKS ist 256", () => {
    expect(MAX_BG_TASKS).toBe(256);
  });
  it("mehr Starts als erlaubt: die ältesten fallen zuerst raus, die neuesten bleiben offen", () => {
    const tasks = new BackgroundTasks();
    tasks.merge({ starts: viele(MAX_BG_TASKS + 44), ends: [] });
    expect(tasks.counts().starts).toBe(MAX_BG_TASKS);
    const jetzt = T0 + (MAX_BG_TASKS + 44) * 1000;
    expect(tasks.open(jetzt, 10 * 24 * 60 * MIN)).toBe(MAX_BG_TASKS);
    // Nur die ältesten 44 fehlen: Ein Ende für den neuesten Start wirkt, eines für einen der ältesten ändert nichts.
    tasks.merge({ starts: [], ends: [id(MAX_BG_TASKS + 43)] });
    expect(tasks.open(jetzt, 10 * 24 * 60 * MIN)).toBe(MAX_BG_TASKS - 1);
  });
  it("derselbe Überlauf in kleinen Scheiben und in anderer Reihenfolge: dieselben Neuesten bleiben (kein Hin- und Herspringen)", () => {
    const alle = viele(MAX_BG_TASKS + 44);
    const tasks = new BackgroundTasks();
    for (let runde = 0; runde < 3; runde++) {
      tasks.merge({ starts: alle.slice().reverse(), ends: [] });
      tasks.merge({ starts: alle.slice(0, 100), ends: [] });
    }
    expect(tasks.counts().starts).toBe(MAX_BG_TASKS);
    tasks.merge({ starts: [], ends: [id(0)] });
    // id(0) ist der älteste Start und längst raus: sein Ende hätte keinen Platz verdient.
    expect(tasks.open(T0 + (MAX_BG_TASKS + 44) * 1000, 10 * 24 * 60 * MIN)).toBe(MAX_BG_TASKS);
  });
  it("mehr Enden als erlaubt: Enden bekannter Starts bleiben, der Speicher wächst nicht", () => {
    const tasks = new BackgroundTasks();
    const starts = viele(MAX_BG_TASKS);
    tasks.merge({ starts, ends: [] });
    const fremd = Array.from({ length: 1000 }, (_, i) => `toolu_fremd${i}`);
    tasks.merge({ starts: [], ends: [...fremd, ...starts.map((s) => s.id)] });
    expect(tasks.counts().ends).toBeLessThanOrEqual(MAX_BG_TASKS);
    expect(tasks.open(T0 + MIN, 60 * MIN)).toBe(0);
  });
});
