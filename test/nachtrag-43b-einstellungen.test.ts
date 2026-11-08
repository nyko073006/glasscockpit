import { describe, expect, it } from "vitest";
import { DEFAULT_FILE_VIEWER_MD_COMMANDS } from "../src/core/constants";
import { DEFAULT_SETTINGS, parseSettings, validateSetting } from "../src/core/settings";

// Nachtrag 43b, Task 2: Einstellungen für die Markdown-Farben im Datei-Viewer.
const FARBEN = ["fileViewerMdText", "fileViewerMdCode", "fileViewerMdCommand", "fileViewerMdHeading", "fileViewerMdLink", "fileViewerMdMarker", "fileViewerMdFrontmatter"] as const;

describe("Markdown-Farben: Einstellungen", () => {
  it("Vorgaben: Schalter an, Farben leer, Befehlsliste wörtlich", () => {
    expect(DEFAULT_SETTINGS.fileViewerMarkdown).toBe(true);
    for (const key of FARBEN) expect(DEFAULT_SETTINGS[key], key).toBe("");
    expect(DEFAULT_FILE_VIEWER_MD_COMMANDS).toBe(
      "npm npx node git gh cd ls cat grep rg find mkdir rm mv cp curl brew claude obsidian codex agy python python3 pip make sed awk open ssh chmod echo export source xcodebuild swift",
    );
    expect(DEFAULT_SETTINGS.fileViewerMdCommands).toBe(DEFAULT_FILE_VIEWER_MD_COMMANDS);
  });

  for (const key of FARBEN) {
    describe(key, () => {
      it.each(["", "#ff6b6b", "#FF6B6B"])("nimmt %j", (v) => {
        expect(validateSetting(key, v)).toBeNull();
        expect(parseSettings({ [key]: v }).settings[key]).toBe(v);
      });
      it.each(["red", "#fff", "ff6b6b", "#ff6b6bb", 5, null])("lehnt %j ab", (v) => {
        expect(validateSetting(key, v)).toBe("leer oder Farbe wie #ff6b6b");
        const r = parseSettings({ [key]: v });
        expect([...r.invalid]).toEqual([key]);
        expect(r.settings[key]).toBe("");
      });
    });
  }

  it("fileViewerMarkdown nimmt nur Wahrheitswerte", () => {
    expect(parseSettings({ fileViewerMarkdown: false }).settings.fileViewerMarkdown).toBe(false);
    const r = parseSettings({ fileViewerMarkdown: "ja" });
    expect([...r.invalid]).toEqual(["fileViewerMarkdown"]);
    expect(r.settings.fileViewerMarkdown).toBe(true);
  });

  it("fileViewerMdCommands nimmt jeden Text (auch leer), keine Zahl", () => {
    expect(validateSetting("fileViewerMdCommands", "")).toBeNull();
    expect(validateSetting("fileViewerMdCommands", "npm  git")).toBeNull();
    expect(validateSetting("fileViewerMdCommands", 3)).not.toBeNull();
  });
});
