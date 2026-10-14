import { describe, expect, it } from "vitest";
import { alertDue, attentionSequence, bannerText, hookCommand, hookSettings, markedTitle, parseAttention, react } from "../src/core/attention";

describe("hookSettings", () => {
  it("Stop → done, AskUserQuestion und Rechtefrage → question", () => {
    const s = JSON.parse(hookSettings());
    expect(s.hooks.Stop[0].hooks[0]).toEqual({ type: "command", command: hookCommand("done") });
    expect(s.hooks.PreToolUse[0].matcher).toBe("AskUserQuestion");
    expect(s.hooks.PreToolUse[0].hooks[0].command).toBe(hookCommand("question"));
    expect(s.hooks.Notification[0].matcher).toBe("permission_prompt|elicitation_dialog");
    expect(s.hooks.Notification[0].hooks[0].command).toBe(hookCommand("question"));
  });
  it("der Befehl gibt nach Shell-Quoting genau die Sequenz aus", () => {
    for (const sig of ["done", "question"] as const) {
      const cmd = hookCommand(sig);
      const m = cmd.match(/^printf '%s\\n' '([^']*)'$/);
      expect(m).not.toBeNull();
      expect(JSON.parse(m![1]).terminalSequence).toBe(attentionSequence(sig));
    }
  });
  it("Sequenz hat das gemessene Format", () =>
    expect(attentionSequence("done")).toBe("\x1b]777;notify;Glasscockpit;cockpit:done\x07"));
});

describe("parseAttention", () => {
  it("erkennt beide Signale", () => {
    expect(parseAttention("notify;Glasscockpit;cockpit:done")).toBe("done");
    expect(parseAttention("notify;Glasscockpit;cockpit:question")).toBe("question");
  });
  it("fremde 777 ignorieren", () => {
    for (const d of ["notify;Build;fertig", "notify;x;cockpit:done2", "", "cockpit"]) expect(parseAttention(d)).toBeNull();
  });
});

describe("react", () => {
  it("sichtbar, aktiv, Fenster im Fokus: nichts", () => expect(react({ active: true, shown: true, windowFocused: true })).toEqual({ mark: false, alert: false }));
  it("verdeckter Tab: Markierung und Alarm", () => expect(react({ active: false, shown: false, windowFocused: true })).toEqual({ mark: true, alert: true }));
  it("sichtbar im Split, nicht aktiv: nur Markierung", () => expect(react({ active: false, shown: true, windowFocused: true })).toEqual({ mark: true, alert: false }));
  it("Obsidian im Hintergrund: Markierung und Alarm", () => expect(react({ active: true, shown: true, windowFocused: false })).toEqual({ mark: true, alert: true }));
});

describe("alertDue, markedTitle, bannerText", () => {
  it("Abstand", () => { expect(alertDue(null, 5, 3000)).toBe(true); expect(alertDue(1000, 3999, 3000)).toBe(false); expect(alertDue(1000, 4000, 3000)).toBe(true); });
  it("Titel", () => { expect(markedTitle("a · 1", "done")).toBe("● a · 1"); expect(markedTitle("a · 1", "question")).toBe("? a · 1"); expect(markedTitle("a · 1", null)).toBe("a · 1"); });
  it("Banner", () => { expect(bannerText("Briefing", "done")).toBe("Briefing ist fertig"); expect(bannerText("Briefing", "question")).toBe("Briefing hat eine Frage"); });
});

// ---- Abend 18: Sitzungswechsel (3b) und busy (3) ----
import { execFileSync } from "node:child_process";
import { claudeIdChange, parseSignal, repeatsQuestion, sessionHookCommand } from "../src/core/attention";
import { SessionStore } from "../src/core/session-store";
import { claudeIdOf, type SessionRecord } from "../src/core/session-model";
import { headerTitle, tabTitle } from "../src/core/claude-launch";
import { TranscriptReader } from "../src/host/transcript-reader";
import { DEFAULT_SETTINGS } from "../src/core/settings";
import { FakeTimers } from "./helpers/fakes";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OLD = "baf7f9fe-1111-4222-8333-444455556666";
const NEW = "90ef2efe-aaaa-4bbb-8ccc-0123456789ab";

function runHook(command: string, stdin: string): string {
  return execFileSync("/bin/sh", ["-c", command], { input: stdin, encoding: "utf8" });
}

describe("Hooks SessionStart und UserPromptSubmit", () => {
  it("SessionStart mit Matcher clear|resume|fork (/branch meldet seit v2.1.214 fork), UserPromptSubmit ohne Matcher", () => {
    const s = JSON.parse(hookSettings());
    expect(s.hooks.SessionStart).toEqual([{ matcher: "clear|resume|fork", hooks: [{ type: "command", command: sessionHookCommand() }] }]);
    expect(s.hooks.UserPromptSubmit).toEqual([{ hooks: [{ type: "command", command: hookCommand("busy") }] }]);
    expect(s.hooks.Stop[0].hooks[0].command).toBe(hookCommand("done"));
  });
  it("busy-Sequenz hat dasselbe Format wie done", () =>
    expect(attentionSequence("busy")).toBe("\x1b]777;notify;Glasscockpit;cockpit:busy\x07"));
  it("der busy-Befehl gibt in echter Shell die Sequenz aus", () => {
    const out = JSON.parse(runHook(hookCommand("busy"), "{}"));
    expect(out.terminalSequence).toBe(attentionSequence("busy"));
  });
  it("der Sitzungs-Befehl gibt aus stdin-JSON die Sequenz mit der session_id aus", () => {
    const out = runHook(sessionHookCommand(), JSON.stringify({ session_id: NEW, transcript_path: "/x/y.jsonl", source: "clear" }));
    expect(JSON.parse(out).terminalSequence).toBe(`\x1b]777;notify;Glasscockpit;cockpit:session:${NEW}\x07`);
  });
  it("auch bei mehrzeiligem JSON und anderer Feldreihenfolge", () => {
    const out = runHook(sessionHookCommand(), `{\n  "source": "resume",\n  "session_id": "${NEW}"\n}\n`);
    expect(JSON.parse(out).terminalSequence).toContain(`cockpit:session:${NEW}`);
  });
  it("zwei session_id-Felder (etwa verschachtelt): genau eine Zeile mit der ersten", () => {
    const out = runHook(sessionHookCommand(), `{"session_id": "${NEW}", "x": {"session_id": "${OLD}"}}`);
    expect(out.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(out).terminalSequence).toContain(NEW);
  });
  it("fehlende, kaputte oder fremde session_id: keine Ausgabe", () => {
    for (const stdin of ["", "{}", "kein json", '{"session_id": ""}', '{"session_id": "abc"}', `{"session_id": "${NEW}x"}`, '{"session_id": "../../etc;rm -rf"}', `{"session_id": 5}`]) {
      expect(runHook(sessionHookCommand(), stdin)).toBe("");
    }
  });
});

describe("Frage nur einmal je Rückfrage", () => {
  // Gemessen am 06.10.2026 (claude 2.1.291, Wegwerf-Sitzung mit protokollierenden Hooks): AskUserQuestion löst sofort
  // PreToolUse aus, 6 s später Notification mit genau diesem stdin – ohne Werkzeugnamen, ein Textfilter kann nicht greifen.
  const echt = JSON.stringify({ hook_event_name: "Notification", message: "Claude needs your permission", notification_type: "permission_prompt" });
  it("Notification meldet weiter question (echte Rechtefragen ohne PreToolUse gehen nicht verloren)", () => {
    expect(JSON.parse(hookSettings()).hooks.Notification[0].hooks[0].command).toBe(hookCommand("question"));
    expect(runHook(hookCommand("question"), echt)).toContain("cockpit:question");
  });
  it("PostToolUse für AskUserQuestion meldet busy: nach der Antwort darf die nächste Frage wieder melden", () => {
    expect(JSON.parse(hookSettings()).hooks.PostToolUse).toEqual([{ matcher: "AskUserQuestion", hooks: [{ type: "command", command: hookCommand("busy") }] }]);
  });
  it("repeatsQuestion: question nach question ist eine Wiederholung, sonst nicht", () => {
    expect(repeatsQuestion("question", "question")).toBe(true);
    expect([repeatsQuestion(undefined, "question"), repeatsQuestion("busy", "question"), repeatsQuestion("done", "question"), repeatsQuestion("question", "done")]).toEqual([false, false, false, false]);
  });
});

describe("parseSignal", () => {
  it("done, question, busy", () => {
    expect(parseSignal("notify;Glasscockpit;cockpit:done")).toEqual({ kind: "activity", signal: "done" });
    expect(parseSignal("notify;Glasscockpit;cockpit:question")).toEqual({ kind: "activity", signal: "question" });
    expect(parseSignal("notify;Glasscockpit;cockpit:busy")).toEqual({ kind: "activity", signal: "busy" });
  });
  it("cockpit:session:<uuid>", () => expect(parseSignal(`notify;Glasscockpit;cockpit:session:${NEW}`)).toEqual({ kind: "session", id: NEW }));
  it("session ohne gültige UUID oder fremd: null", () => {
    for (const d of ["notify;x;cockpit:session:", "notify;x;cockpit:session:abc", `notify;x;cockpit:session:${NEW}x`, `notify;x;cockpit:session: ${NEW}`, `notify;x;session:${NEW}`, "notify;Build;fertig", ""])
      expect(parseSignal(d)).toBeNull();
  });
  it("parseAttention ändert sich nicht: busy und session sind dort null", () => {
    expect(parseAttention("notify;Glasscockpit;cockpit:busy")).toBeNull();
    expect(parseAttention(`notify;Glasscockpit;cockpit:session:${NEW}`)).toBeNull();
  });
});

describe("Sitzungswechsel nach /clear", () => {
  it("claudeIdChange: gleiche ID oder Unsinn → nichts, neue UUID → die neue", () => {
    expect(claudeIdChange(OLD, OLD)).toBeNull();
    expect(claudeIdChange(OLD, "kaputt")).toBeNull();
    expect(claudeIdChange(OLD, NEW)).toBe(NEW);
    expect(claudeIdChange(OLD, NEW.toUpperCase())).toBe(NEW.toUpperCase());
  });
  it("alte ID rein, Signal, neue ID in Speicher, claudeIdOf, Titel und Leser-Ziel", () => {
    const rec: SessionRecord = { id: "c1", name: "claude 4", kind: "claude", cwd: "/v", createdAt: "x", claudeSessionId: OLD };
    const store = new SessionStore({ schemaVersion: 1, sessions: [rec], settings: DEFAULT_SETTINGS, recentSkills: [], openAtUnload: [], dashboardAtUnload: null }, async () => {}, new FakeTimers(), 300);
    const parsed = parseSignal(`notify;Glasscockpit;cockpit:session:${NEW}`);
    expect(parsed?.kind).toBe("session");
    const next = claudeIdChange(claudeIdOf(store.get("c1")!), (parsed as { id: string }).id);
    expect(next).toBe(NEW);
    expect(store.setClaudeSessionId("c1", next!).ok).toBe(true);
    const now = store.get("c1")!;
    expect(now.id).toBe("c1");
    expect(store.all()[0].claudeSessionId).toBe(NEW);
    expect(claudeIdOf(now)).toBe(NEW);
    expect(tabTitle(now.name, claudeIdOf(now))).toBe("90ef2efe · claude 4");
    expect(headerTitle(now.name, claudeIdOf(now), now.cwd, "/h")).toBe("90ef2efe · claude 4 · /v");
  });
  it("der Leser mit der neuen ID findet nur die neue Datei, nicht die alte", async () => {
    const root = mkdtempSync(join(tmpdir(), "cockpit-sw-"));
    mkdirSync(join(root, "p"));
    const text = (t: string) => JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: t }] } }) + "\n";
    writeFileSync(join(root, "p", `${OLD}.jsonl`), text("alt\n```sh\nalt-code\n```"));
    writeFileSync(join(root, "p", `${NEW}.jsonl`), text("neu\n```sh\nneu-code\n```"));
    const alt = await new TranscriptReader(OLD, root).read(true);
    const neu = await new TranscriptReader(NEW, root).read(true);
    expect(alt.blocks.map((b) => b.code)).toEqual(["alt-code"]);
    expect(neu.blocks.map((b) => b.code)).toEqual(["neu-code"]);
  });
});

// ---- Abend 28: stille Zwischenstände ----
import { type AttentionSignal, doneIsQuiet } from "../src/core/attention";

describe("markedTitle mit offenen Hintergrundaufgaben (Abend 28)", () => {
  it("ohne Aufgaben bleibt alles wie bisher, auch ohne dritten Parameter", () => {
    expect(markedTitle("Name", null)).toBe("Name");
    expect(markedTitle("Name", "done")).toBe("● Name");
    expect(markedTitle("Name", "question")).toBe("? Name");
    expect(markedTitle("Name", "done", 0)).toBe("● Name");
  });
  it("offene Aufgaben: ⏳ und Zahl direkt vor dem Titel, eine Markierung davor", () => {
    expect(markedTitle("Name", null, 2)).toBe("⏳ 2 Name");
    expect(markedTitle("Name", "question", 1)).toBe("? ⏳ 1 Name");
    expect(markedTitle("Name", "done", 3)).toBe("● ⏳ 3 Name");
  });
  it("Marken und Zahl stehen vor der ID, nie dazwischen (Abend 29: ID · Name)", () => {
    const titel = tabTitle("claude 4", "90ef2efe-1111-4222-8333-444455556666");
    expect(markedTitle(titel, null, 2)).toBe("⏳ 2 90ef2efe · claude 4");
    expect(markedTitle(titel, "question", 1)).toBe("? ⏳ 1 90ef2efe · claude 4");
    expect(markedTitle(titel, "done")).toBe("● 90ef2efe · claude 4");
  });
  it("Null, negative und ungültige Zahlen zeigen nichts an", () => {
    for (const open of [0, -1, Number.NaN]) expect(markedTitle("Name", null, open), String(open)).toBe("Name");
  });
});

describe("doneIsQuiet (Abend 28): wann ein Antwortende nichts meldet", () => {
  const faelle: Array<[AttentionSignal, boolean, number, boolean]> = [
    // Signal, Schalter, offene Aufgaben, still?
    ["done", true, 2, true],
    ["done", true, 1, true],
    ["done", true, 0, false],
    ["done", false, 2, false],
    ["done", false, 0, false],
    ["question", true, 2, false],
    ["question", true, 0, false],
    ["question", false, 2, false],
    ["question", false, 0, false],
  ];
  it.each(faelle)("%s, Schalter %s, %i offen: still = %s", (signal, an, offen, still) => {
    expect(doneIsQuiet(signal, an, offen)).toBe(still);
  });
  it("eine Frage ist nie still, egal wie viele Aufgaben laufen", () => {
    for (const offen of [0, 1, 2, 256]) for (const an of [true, false]) expect(doneIsQuiet("question", an, offen)).toBe(false);
  });
  it("negative oder ungültige Zahl: nicht still (im Zweifel melden)", () => {
    expect(doneIsQuiet("done", true, -1)).toBe(false);
    expect(doneIsQuiet("done", true, Number.NaN)).toBe(false);
  });
});

describe("hookSettings mit Zusatz (Abend 33)", () => {
  it("Zusatzschlüssel stehen neben den Hooks", () => {
    const s = JSON.parse(hookSettings({ permissions: { deny: ["Read(//v/x/**)"] } }));
    expect(s.permissions).toEqual({ deny: ["Read(//v/x/**)"] });
    expect(s.hooks.Stop[0].hooks[0].type).toBe("command");
  });
  it("ein Zusatz namens hooks verdrängt die echten Hooks nicht", () => {
    expect(JSON.parse(hookSettings({ hooks: {} })).hooks).toEqual(JSON.parse(hookSettings()).hooks);
  });
  it("ohne Zusatz genau wie vorher", () => {
    expect(Object.keys(JSON.parse(hookSettings()))).toEqual(["hooks"]);
  });
});
