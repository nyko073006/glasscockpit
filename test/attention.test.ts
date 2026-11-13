import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { alertDue, attentionSequence, bannerText, hookCommand, hookSettings, markedTitle, parseAttention, react, windowsHookArgs, windowsSessionScript, windowsSettings, windowsSignalScript } from "../src/core/attention";
import { system32Path } from "../src/core/platform-path";

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
import { ON_WINDOWS } from "./helpers/platform";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
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
  // Windows: führt den Hook-Befehl in /bin/sh aus (Inventur H14)
  it.skipIf(ON_WINDOWS)("der busy-Befehl gibt in echter Shell die Sequenz aus", () => {
    const out = JSON.parse(runHook(hookCommand("busy"), "{}"));
    expect(out.terminalSequence).toBe(attentionSequence("busy"));
  });
  // Windows: führt den Hook-Befehl in /bin/sh aus (Inventur H14)
  it.skipIf(ON_WINDOWS)("der Sitzungs-Befehl gibt aus stdin-JSON die Sequenz mit der session_id aus", () => {
    const out = runHook(sessionHookCommand(), JSON.stringify({ session_id: NEW, transcript_path: "/x/y.jsonl", source: "clear" }));
    expect(JSON.parse(out).terminalSequence).toBe(`\x1b]777;notify;Glasscockpit;cockpit:session:${NEW}\x07`);
  });
  // Windows: führt den Hook-Befehl in /bin/sh aus (Inventur H14)
  it.skipIf(ON_WINDOWS)("auch bei mehrzeiligem JSON und anderer Feldreihenfolge", () => {
    const out = runHook(sessionHookCommand(), `{\n  "source": "resume",\n  "session_id": "${NEW}"\n}\n`);
    expect(JSON.parse(out).terminalSequence).toContain(`cockpit:session:${NEW}`);
  });
  // Windows: führt den Hook-Befehl in /bin/sh aus (Inventur H14)
  it.skipIf(ON_WINDOWS)("zwei session_id-Felder (etwa verschachtelt): genau eine Zeile mit der ersten", () => {
    const out = runHook(sessionHookCommand(), `{"session_id": "${NEW}", "x": {"session_id": "${OLD}"}}`);
    expect(out.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(out).terminalSequence).toContain(NEW);
  });
  // Windows: führt den Hook-Befehl in /bin/sh aus (Inventur H14)
  it.skipIf(ON_WINDOWS)("fehlende, kaputte oder fremde session_id: keine Ausgabe", () => {
    for (const stdin of ["", "{}", "kein json", '{"session_id": ""}', '{"session_id": "abc"}', `{"session_id": "${NEW}x"}`, '{"session_id": "../../etc;rm -rf"}', `{"session_id": 5}`]) {
      expect(runHook(sessionHookCommand(), stdin)).toBe("");
    }
  });
});

describe("Frage nur einmal je Rückfrage", () => {
  // Gemessen am 06.10.2026 (claude 2.1.291, Wegwerf-Sitzung mit protokollierenden Hooks): AskUserQuestion löst sofort
  // PreToolUse aus, 6 s später Notification mit genau diesem stdin – ohne Werkzeugnamen, ein Textfilter kann nicht greifen.
  const echt = JSON.stringify({ hook_event_name: "Notification", message: "Claude needs your permission", notification_type: "permission_prompt" });
  // Windows: führt den Hook-Befehl in /bin/sh aus (Inventur H14)
  it.skipIf(ON_WINDOWS)("Notification meldet weiter question (echte Rechtefragen ohne PreToolUse gehen nicht verloren)", () => {
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
    const store = new SessionStore({ schemaVersion: 1, sessions: [rec], settings: DEFAULT_SETTINGS, recentSkills: [], openAtUnload: [], dashboardAtUnload: null, briefingDone: null, remindersDone: null }, async () => {}, new FakeTimers(), 300);
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
    const alt = await new TranscriptReader(OLD, root, homedir(), "darwin").read(true);
    const neu = await new TranscriptReader(NEW, root, homedir(), "darwin").read(true);
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

const MAC_OHNE_ZUSATZ = "{\"hooks\":{\"Stop\":[{\"hooks\":[{\"type\":\"command\",\"command\":\"printf '%s\\\\n' '{\\\"terminalSequence\\\":\\\"\\\\u001b]777;notify;Glasscockpit;cockpit:done\\\\u0007\\\"}'\"}]}],\"PreToolUse\":[{\"matcher\":\"AskUserQuestion\",\"hooks\":[{\"type\":\"command\",\"command\":\"printf '%s\\\\n' '{\\\"terminalSequence\\\":\\\"\\\\u001b]777;notify;Glasscockpit;cockpit:question\\\\u0007\\\"}'\"}]}],\"PostToolUse\":[{\"matcher\":\"AskUserQuestion\",\"hooks\":[{\"type\":\"command\",\"command\":\"printf '%s\\\\n' '{\\\"terminalSequence\\\":\\\"\\\\u001b]777;notify;Glasscockpit;cockpit:busy\\\\u0007\\\"}'\"}]}],\"Notification\":[{\"matcher\":\"permission_prompt|elicitation_dialog\",\"hooks\":[{\"type\":\"command\",\"command\":\"printf '%s\\\\n' '{\\\"terminalSequence\\\":\\\"\\\\u001b]777;notify;Glasscockpit;cockpit:question\\\\u0007\\\"}'\"}]}],\"UserPromptSubmit\":[{\"hooks\":[{\"type\":\"command\",\"command\":\"printf '%s\\\\n' '{\\\"terminalSequence\\\":\\\"\\\\u001b]777;notify;Glasscockpit;cockpit:busy\\\\u0007\\\"}'\"}]}],\"SessionStart\":[{\"matcher\":\"clear|resume|fork\",\"hooks\":[{\"type\":\"command\",\"command\":\"id=$(grep -Eo '\\\"session_id\\\" *: *\\\"[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\\\"' | head -n 1 | grep -Eo '[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}'); [ -n \\\"$id\\\" ] && printf '%s%s%s\\\\n' '{\\\"terminalSequence\\\":\\\"\\\\u001b]777;notify;Glasscockpit;cockpit:session:' \\\"$id\\\" '\\\\u0007\\\"}'; true\"}]}]}}";
const MAC_MIT_ZUSATZ = "{\"permissions\":{\"deny\":[\"Read(//a/**)\"]},\"hooks\":{\"Stop\":[{\"hooks\":[{\"type\":\"command\",\"command\":\"printf '%s\\\\n' '{\\\"terminalSequence\\\":\\\"\\\\u001b]777;notify;Glasscockpit;cockpit:done\\\\u0007\\\"}'\"}]}],\"PreToolUse\":[{\"matcher\":\"AskUserQuestion\",\"hooks\":[{\"type\":\"command\",\"command\":\"printf '%s\\\\n' '{\\\"terminalSequence\\\":\\\"\\\\u001b]777;notify;Glasscockpit;cockpit:question\\\\u0007\\\"}'\"}]}],\"PostToolUse\":[{\"matcher\":\"AskUserQuestion\",\"hooks\":[{\"type\":\"command\",\"command\":\"printf '%s\\\\n' '{\\\"terminalSequence\\\":\\\"\\\\u001b]777;notify;Glasscockpit;cockpit:busy\\\\u0007\\\"}'\"}]}],\"Notification\":[{\"matcher\":\"permission_prompt|elicitation_dialog\",\"hooks\":[{\"type\":\"command\",\"command\":\"printf '%s\\\\n' '{\\\"terminalSequence\\\":\\\"\\\\u001b]777;notify;Glasscockpit;cockpit:question\\\\u0007\\\"}'\"}]}],\"UserPromptSubmit\":[{\"hooks\":[{\"type\":\"command\",\"command\":\"printf '%s\\\\n' '{\\\"terminalSequence\\\":\\\"\\\\u001b]777;notify;Glasscockpit;cockpit:busy\\\\u0007\\\"}'\"}]}],\"SessionStart\":[{\"matcher\":\"clear|resume|fork\",\"hooks\":[{\"type\":\"command\",\"command\":\"id=$(grep -Eo '\\\"session_id\\\" *: *\\\"[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\\\"' | head -n 1 | grep -Eo '[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}'); [ -n \\\"$id\\\" ] && printf '%s%s%s\\\\n' '{\\\"terminalSequence\\\":\\\"\\\\u001b]777;notify;Glasscockpit;cockpit:session:' \\\"$id\\\" '\\\\u0007\\\"}'; true\"}]}]}}";

describe("hookSettings: Mac byte-gleich (Abend 42, Charakterisierung vom unveränderten Stand 57838ba)", () => {
  it("hookSettings({}) ist genau dieses Literal", () => {
    expect(hookSettings({})).toBe(MAC_OHNE_ZUSATZ);
  });
  it("hookSettings mit permissions-Zusatz: Zusatz zuerst, dann hooks, genau dieses Literal", () => {
    expect(hookSettings({ permissions: { deny: ["Read(//a/**)"] } })).toBe(MAC_MIT_ZUSATZ);
  });
});

const PS = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const decode = (b64: string) => Buffer.from(b64, "base64").toString("utf16le");
interface WinEntry { type: string; command: string; args: string[] }
interface HookGroup { matcher?: string; hooks: WinEntry[] }
const groupsOf = (json: string) => (JSON.parse(json) as { hooks: Record<string, HookGroup[]> }).hooks;
const scriptOf = (entry: WinEntry) => decode(entry.args[4]);
const allEntries = (json: string) => Object.values(groupsOf(json)).flatMap((groups) => groups.flatMap((g) => g.hooks));
const SEQ_JSON_DONE = String.raw`{"terminalSequence":"\u001b]777;notify;Glasscockpit;cockpit:done\u0007"}`;
const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("windowsHookArgs (Abend 42)", () => {
  it("vier feste Schalter, dann das Skript als Base64 von UTF-16LE (festes Literal)", () => {
    expect(windowsHookArgs("exit 0")).toEqual(["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", "ZQB4AGkAdAAgADAA"]);
  });
  it("Umlaute und Zeichen außerhalb von ASCII überstehen die Kodierung", () => {
    const script = "Write 'äöü€'";
    expect(decode(windowsHookArgs(script)[4])).toBe(script);
  });
});

describe("windowsSignalScript (Abend 42)", () => {
  it("ist genau [Console]::Out.Write('<JSON>'); exit 0", () => {
    expect(windowsSignalScript("done")).toBe(`[Console]::Out.Write('${SEQ_JSON_DONE}'); exit 0`);
  });
  it("das JSON steht mit \\u001b und \\u0007 als Text darin, keine echten Steuerzeichen", () => {
    const s = windowsSignalScript("done");
    expect(s).toContain(SEQ_JSON_DONE);
    expect(s).toContain("\\u001b");
    expect(s).toContain("\\u0007");
    expect(s).not.toMatch(/[\x00-\x1f]/);
  });
  it("genau zwei einfache Anführungszeichen (das JSON enthält keins)", () => {
    for (const sig of ["done", "question", "busy"] as const) expect(windowsSignalScript(sig).split("'").length - 1).toBe(2);
  });
  it("das JSON trägt die Sequenz des jeweiligen Signals", () => {
    for (const sig of ["done", "question", "busy"] as const) {
      const m = windowsSignalScript(sig).match(/^\[Console\]::Out\.Write\('([^']*)'\); exit 0$/);
      expect(m).not.toBeNull();
      expect(JSON.parse(m![1]).terminalSequence).toBe(attentionSequence(sig));
    }
  });
});

describe("windowsSessionScript (Abend 42)", () => {
  const script = windowsSessionScript();
  it("liest stdin mit [Console]::In.ReadToEnd(), sucht mit [regex]::Match, schreibt mit [Console]::Out.Write, endet mit exit 0", () => {
    expect(script).toContain("[Console]::In.ReadToEnd()");
    expect(script).toContain("[regex]::Match(");
    expect(script).toContain("[Console]::Out.Write(");
    expect(script.endsWith("exit 0")).toBe(true);
    expect(script).not.toMatch(/[\x00-\x1f]/);
  });
  it("Muster aus dem Skript: trifft nur eine echte UUID hinter session_id", () => {
    const pattern = script.match(/\[regex\]::Match\(\$\w+, '([^']*)'\)/)?.[1];
    expect(pattern).toBeDefined();
    const re = new RegExp(pattern!);
    expect(`{"session_id":"${UUID}","x":1}`.match(re)?.[1]).toBe(UUID);
    expect(`{"a":2, "session_id" :\n "${UUID.toUpperCase()}"}`.match(re)?.[1]).toBe(UUID.toUpperCase());
    expect("{}".match(re)).toBeNull();
    expect("".match(re)).toBeNull();
    expect('{"session_id":"nicht-gueltig"}'.match(re)).toBeNull();
    expect(`{"session_id":"${UUID}x"}`.match(re)).toBeNull();
    expect(`{"other_session_id":"${UUID}"}`.match(re)).toBeNull();
  });
  it("Ausgabe bei Treffer = start + id + end: ergibt die Sitzungs-Sequenz, die parseSignal versteht", () => {
    const m = script.match(/\[Console\]::Out\.Write\('([^']*)' \+ \$\w+\.Groups\[1\]\.Value \+ '([^']*)'\)/);
    expect(m).not.toBeNull();
    const out = m![1] + UUID + m![2];
    expect(JSON.parse(out).terminalSequence).toBe(`\x1b]777;notify;Glasscockpit;cockpit:session:${UUID}\x07`);
    expect(m![1]).toContain("\\u001b");
    expect(m![2]).toContain("\\u0007");
    expect(script.split("'").length - 1).toBe(6);
  });
});

describe("windowsSettings (Abend 42, ersetzt Abend 41)", () => {
  const json = windowsSettings({}, PS);
  const mac = JSON.parse(hookSettings({})).hooks as Record<string, HookGroup[]>;
  it("gleiche Ereignisse, Matcher und Anzahl Einträge wie hookSettings({})", () => {
    const shape = (hooks: Record<string, HookGroup[]>) =>
      Object.entries(hooks).map(([event, groups]) => [event, groups.map((g) => [g.matcher ?? null, g.hooks.length])]);
    expect(shape(groupsOf(json))).toEqual(shape(mac));
    expect(Object.keys(groupsOf(json))).toEqual(["Stop", "PreToolUse", "PostToolUse", "Notification", "UserPromptSubmit", "SessionStart"]);
  });
  it("jeder Eintrag: type command, command = PS, args = vier Schalter plus Skript, sonst nichts (kein shell, kein onFailure)", () => {
    const entries = allEntries(json);
    expect(entries.length).toBe(6);
    for (const e of entries) {
      expect(Object.keys(e)).toEqual(["type", "command", "args"]);
      expect(e.type).toBe("command");
      expect(e.command).toBe(PS);
      expect(e.args.slice(0, 4)).toEqual(["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand"]);
      expect(e.args.length).toBe(5);
      expect("shell" in e).toBe(false);
      expect("onFailure" in e).toBe(false);
    }
  });
  it("die dekodierten Skripte: Stop → done, PreToolUse → question, PostToolUse → busy, Notification → question, UserPromptSubmit → busy, SessionStart → Sitzungs-Skript", () => {
    const g = groupsOf(json);
    expect(scriptOf(g.Stop[0].hooks[0])).toBe(windowsSignalScript("done"));
    expect(scriptOf(g.PreToolUse[0].hooks[0])).toBe(windowsSignalScript("question"));
    expect(scriptOf(g.PostToolUse[0].hooks[0])).toBe(windowsSignalScript("busy"));
    expect(scriptOf(g.Notification[0].hooks[0])).toBe(windowsSignalScript("question"));
    expect(scriptOf(g.UserPromptSubmit[0].hooks[0])).toBe(windowsSignalScript("busy"));
    expect(scriptOf(g.SessionStart[0].hooks[0])).toBe(windowsSessionScript());
  });
  it("kein Skript enthält ConvertFrom-Json oder Start-Sleep; jedes endet mit exit 0", () => {
    for (const e of allEntries(json)) {
      const s = scriptOf(e);
      expect(s).not.toContain("ConvertFrom-Json");
      expect(s).not.toContain("Start-Sleep");
      expect(s.endsWith("exit 0")).toBe(true);
    }
  });
  it("Zusatz zuerst, hooks zuletzt; ein Zusatz namens hooks verdrängt die echten Hooks nicht", () => {
    const extra = { permissions: { deny: ["Read(//c/x/**)"] }, sandbox: { enabled: false }, hooks: { Stop: [{ hooks: [{ type: "command", command: "printf x" }] }] } };
    const s = JSON.parse(windowsSettings(extra, PS));
    expect(Object.keys(s)).toEqual(["permissions", "sandbox", "hooks"]);
    expect(s.permissions).toEqual(extra.permissions);
    expect(s.sandbox).toEqual(extra.sandbox);
    expect(s.hooks).toEqual(JSON.parse(json).hooks);
  });
  it("ohne Zusatz nur hooks", () => {
    expect(Object.keys(JSON.parse(json))).toEqual(["hooks"]);
  });
  it("der übergebene powershell-Pfad kommt unverändert in jeden Eintrag", () => {
    for (const e of allEntries(windowsSettings({}, "D:\\Win\\System32\\x.exe"))) expect(e.command).toBe("D:\\Win\\System32\\x.exe");
  });
});

describe("Hook-Skripte in echtem Windows PowerShell (Abend 42, nur unter Windows)", () => {
  const ps = system32Path(process.env.SystemRoot, "WindowsPowerShell", "v1.0", "powershell.exe");
  const g = groupsOf(windowsSettings({}, ps));
  const run = (entry: WinEntry, input: string) => spawnSync(entry.command, entry.args, { input, encoding: "utf8", windowsHide: true });
  const [start, end] = (() => {
    const m = windowsSessionScript().match(/Write\('([^']*)' \+ \$\w+\.Groups\[1\]\.Value \+ '([^']*)'\)/);
    return [m?.[1] ?? "", m?.[2] ?? ""];
  })();
  it.runIf(ON_WINDOWS)("Session-Hook mit session_id: stdout genau start + uuid + end, Status 0", () => {
    const r = run(g.SessionStart[0].hooks[0], `{"session_id":"${UUID}","x":1}`);
    expect(r.stdout).toBe(start + UUID + end);
    expect(r.status).toBe(0);
  });
  it.runIf(ON_WINDOWS)("Session-Hook mit {} : stdout leer, Status 0", () => {
    const r = run(g.SessionStart[0].hooks[0], "{}");
    expect(r.stdout).toBe("");
    expect(r.status).toBe(0);
  });
  it.runIf(ON_WINDOWS)("Session-Hook mit leerem stdin: stdout leer, Status 0", () => {
    const r = run(g.SessionStart[0].hooks[0], "");
    expect(r.stdout).toBe("");
    expect(r.status).toBe(0);
  });
  it.runIf(ON_WINDOWS)("Signal-Hook: stdout genau das JSON, Status 0", () => {
    const r = run(g.Stop[0].hooks[0], "");
    expect(r.stdout).toBe(SEQ_JSON_DONE);
    expect(r.status).toBe(0);
  });
});
