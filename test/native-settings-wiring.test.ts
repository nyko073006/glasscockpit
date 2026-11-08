import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "./helpers/files";

const tab = readFileSync(join(ROOT, "src/host/settings-tab.ts"), "utf8");
const main = readFileSync(join(ROOT, "src/main.ts"), "utf8");

describe("Abend 26 (5): Einstellungen verdrahtet", () => {
  it("Abschnitt mit Status und Knopf „Binärdateien laden“, der downloadNative mit den echten Abhängigkeiten ruft", () => {
    expect(tab).toContain("Binärdateien laden");
    expect(tab).toContain("nativeStatusText(");
    expect(tab).toContain("nativeInstalled(");
    expect(tab).toMatch(/downloadNative\([^)]*realDownloadDeps\(platform\)/s);
    expect(tab).toContain("this.plugin.manifest.version");
  });
  it("der Knopf ist während des Ladens gesperrt und das Ergebnis erscheint als Notice", () => {
    expect(tab).toMatch(/setDisabled\(true\)[\s\S]*downloadNative[\s\S]*setDisabled\(false\)/);
    expect(tab).toMatch(/new Notice\([^;]*Binärdateien/);
  });
});

describe("Abend 40 (3): Aufräumen beim Laden verdrahtet", () => {
  it("onload räumt .native-download-* im Plugin-Ordner auf, auf allen Plattformen und ohne zu warten", () => {
    const onload = main.slice(main.indexOf("async onload()"), main.indexOf("onunload()"));
    expect(onload).toMatch(/const pluginDir = pluginDirOf\(this\.app, this\.manifest\);\s*if \(pluginDir\) \{\s*void cleanupStaleDownloads\(pluginDir\)/);
    expect(onload).toContain("r.inBenutzung > 0");
  });
});
