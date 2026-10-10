import { describe, expect, it } from "vitest";
import { classifyLoadError } from "../src/core/load-error";

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
    expect(classifyLoadError(text).kind).toBe(kind);
  });

  it("Quarantäne schlägt „no such file“: der dlopen-Text nennt beides", () => {
    expect(ECHT.quarantine).toContain("(no such file)");
    expect(classifyLoadError(ECHT.quarantine).kind).toBe("quarantine");
  });

  it("„code signature“ allein reicht für quarantine", () => {
    expect(classifyLoadError(`dlopen(${PTY}): code signature invalid`).kind).toBe("quarantine");
  });

  it("„different Node.js version“ allein reicht für abi", () => {
    expect(classifyLoadError("was compiled against a different Node.js version").kind).toBe("abi");
  });

  it("Groß- und Kleinschreibung zählt nicht", () => {
    expect(classifyLoadError("POSIX_SPAWNP FAILED").kind).toBe("spawn-helper");
  });

  it.each(Object.entries(ECHT))("%s: Meldung enthält den Originaltext und einen Hinweis", (_, text) => {
    const { message } = classifyLoadError(text);
    expect(message).toContain(text);
    expect(message).toMatch(/Hinweis: \S/);
  });

  it("jede Klasse hat einen eigenen Hinweis", () => {
    const meldungen = Object.values(ECHT).map((text) => {
      const { message } = classifyLoadError(text);
      return message.slice(message.indexOf("Hinweis:"));
    });
    // fehltEnoent und fehltModul teilen sich die Klasse, also 5 statt 6.
    expect(new Set(meldungen).size).toBe(5);
  });
});
