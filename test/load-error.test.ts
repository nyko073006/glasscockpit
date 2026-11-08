import { describe, expect, it } from "vitest";
import { classifyLoadError } from "../src/core/load-error";
import { windowsBuildProblem } from "../src/core/shell";

const PTY = "/Users/alex/Vault/.obsidian/plugins/glasscockpit/native/darwin-arm64/prebuilds/darwin-arm64/pty.node";
const INDEX = "/Users/alex/Vault/.obsidian/plugins/glasscockpit/native/darwin-arm64/lib/index.js";

// Echte Texte, am 04.10.2026 auf diesem Mac mit node-pty 1.1.0 erzeugt (nur die Pfade gekürzt).
// Ausnahme abi: Standardtext von Node, hier nicht erzeugbar, weil die Prebuilds N-API sind.
const ECHT = {
  // require auf pty.node mit gesetztem com.apple.quarantine. Enthält auch „(no such file)“.
  quarantine:
    `dlopen(${PTY}, 0x0001): tried: '${PTY}' (code signature in <333B9B8F-3DBD-3733-BBB3-BC6679A9760C> ` +
    `'${PTY}' not valid for use in process: library load disallowed by system policy), ` +
    `'/System/Volumes/Preboot/Cryptexes/OS${PTY}' (no such file), '${PTY}' (code signature in ` +
    `<333B9B8F-3DBD-3733-BBB3-BC6679A9760C> '${PTY}' not valid for use in process: library load disallowed by system policy)`,
  // pty.spawn mit spawn-helper ohne Ausführrecht.
  spawnHelper: "posix_spawnp failed.",
  abi:
    `The module '${PTY}'\nwas compiled against a different Node.js version using\nNODE_MODULE_VERSION 115. ` +
    "This version of Node.js requires\nNODE_MODULE_VERSION 136. Please try re-compiling or re-installing\n" +
    "the module (for instance, using `npm rebuild` or `npm install`).",
  // fs.accessSync auf die fehlende index.js.
  fehltEnoent: `ENOENT: no such file or directory, access '${INDEX}'`,
  // require auf die fehlende index.js.
  fehltModul: `Cannot find module '${INDEX}'\nRequire stack:\n- /Applications/Obsidian.app/Contents/Resources/app.asar/main.js`,
  unbekannt: "Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON",
};

describe("classifyLoadError", () => {
  it.each([
    ["quarantine", ECHT.quarantine],
    ["spawn-helper", ECHT.spawnHelper],
    ["abi", ECHT.abi],
    ["fehlt", ECHT.fehltEnoent],
    ["fehlt", ECHT.fehltModul],
    ["unbekannt", ECHT.unbekannt],
  ])("%s: %s", (kind, text) => {
    expect(classifyLoadError(text, "darwin").kind).toBe(kind);
  });

  it("Quarantäne schlägt „no such file“: der dlopen-Text nennt beides", () => {
    expect(ECHT.quarantine).toContain("(no such file)");
    expect(classifyLoadError(ECHT.quarantine, "darwin").kind).toBe("quarantine");
  });

  it("„code signature“ allein reicht für quarantine", () => {
    expect(classifyLoadError(`dlopen(${PTY}): code signature invalid`, "darwin").kind).toBe("quarantine");
  });

  it("„different Node.js version“ allein reicht für abi", () => {
    expect(classifyLoadError("was compiled against a different Node.js version", "darwin").kind).toBe("abi");
  });

  it("Groß- und Kleinschreibung zählt nicht", () => {
    expect(classifyLoadError("POSIX_SPAWNP FAILED", "darwin").kind).toBe("spawn-helper");
  });

  it.each(Object.entries(ECHT))("%s: Meldung enthält den Originaltext und einen Hinweis", (_, text) => {
    const { message } = classifyLoadError(text, "darwin");
    expect(message).toContain(text);
    expect(message).toMatch(/Hinweis: \S/);
  });

  it("jede Klasse hat einen eigenen Hinweis", () => {
    const meldungen = Object.values(ECHT).map((text) => {
      const { message } = classifyLoadError(text, "darwin");
      return message.slice(message.indexOf("Hinweis:"));
    });
    // fehltEnoent und fehltModul teilen sich die Klasse, also 5 statt 6.
    expect(new Set(meldungen).size).toBe(5);
  });
});

describe("Abend 26 (5): fehlendes node-pty verweist auf den Knopf", () => {
  it("die Meldung nennt „Binärdateien laden“ in den Einstellungen und weiter npm run deploy", () => {
    for (const roh of [ECHT.fehltEnoent, ECHT.fehltModul]) {
      const m = classifyLoadError(roh, "darwin").message;
      expect(m).toContain("node-pty fehlt im Plugin-Ordner");
      expect(m).toContain("Binärdateien laden");
      expect(m).toContain("Einstellungen");
      expect(m).toContain("npm run deploy");
    }
  });
});

// Windows (Abend 40). Der Pfad der Blockade trägt den \\?\-Vorsatz, wie Node ihn meldet; klassiert wird nur nach dem Muster.
describe("classifyLoadError unter Windows", () => {
  const WIN = {
    blockiert: "\\\\?\\C:\\x\\conpty.node: An Application Control policy has blocked this file.",
    fehlt: "The specified module could not be found.",
    unbekannt: "Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON",
  };

  it("Application Control policy: blockiert", () => {
    expect(classifyLoadError(WIN.blockiert, "win32").kind).toBe("blockiert");
  });

  it("Smart App Control allein reicht für blockiert", () => {
    expect(classifyLoadError("Smart App Control blocked it", "win32").kind).toBe("blockiert");
  });

  it("blockiert: Titel und Hinweis stehen wörtlich in der Meldung", () => {
    const { message } = classifyLoadError(WIN.blockiert, "win32");
    expect(message).toContain("Windows blockiert conpty.node (Smart App Control oder App-Steuerung).");
    expect(message).toContain(WIN.blockiert);
    expect(message).toContain(
      "Hinweis: Smart App Control lässt unsignierte Dateien wie conpty.node nicht zu. " +
        "In „Windows-Sicherheit“ unter „App- und Browsersteuerung“ prüfen, ob es eingeschaltet ist.",
    );
  });

  it("der Text aus windowsBuildProblem ist windows-alt", () => {
    const text = windowsBuildProblem("10.0.17763");
    expect(text).not.toBeNull();
    const klassiert = classifyLoadError(text as string, "win32");
    expect(klassiert.kind).toBe("windows-alt");
    expect(klassiert.message).toContain("Windows ist zu alt für das Terminal.");
    expect(klassiert.message).toContain("Hinweis: Glasscockpit braucht Windows 10 ab Version 1903 oder Windows 11.");
  });

  it("„The specified module could not be found“: fehlt", () => {
    expect(classifyLoadError(WIN.fehlt, "win32").kind).toBe("fehlt");
  });

  it("unbekannt: Windows nennt Strg+Umschalt+I, der Mac Cmd+Option+I", () => {
    const win = classifyLoadError(WIN.unbekannt, "win32");
    expect(win.kind).toBe("unbekannt");
    expect(win.message).toContain(
      "Hinweis: Unbekannte Ursache. Die Entwicklerkonsole (Strg+Umschalt+I) zeigt den vollständigen Fehler.",
    );
    expect(win.message).not.toContain("Cmd+Option+I");
    const mac = classifyLoadError(WIN.unbekannt, "darwin");
    expect(mac.message).toContain("Hinweis: Unbekannte Ursache. Die Entwicklerkonsole (Cmd+Option+I) zeigt den vollständigen Fehler.");
    expect(mac.message).not.toContain("Strg+Umschalt+I");
  });
});
