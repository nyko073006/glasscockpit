import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listFilesRecursive, relativeToRoot, ROOT } from "./helpers/files";

const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");
const srcFiles = (): string[] => listFilesRecursive(join(ROOT, "src")).filter((f) => /\.ts$/.test(f));
/** Quelltext ohne Kommentare: Erwähnungen in Doku zählen nicht. */
const code = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
/** Rumpf einer Klassenmethode: ab der Signatur bis zur schließenden Klammer in der Einrückung der Klasse. */
function method(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start, `Methode ${signature} fehlt`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf("\n  }\n", start);
  expect(end, `Ende von ${signature} nicht gefunden`).toBeGreaterThan(start);
  return source.slice(start, end);
}

// Nachtrag 43f: Weich scrollen. Was nur in Obsidian läuft (echtes Trackpad, Claude im Vollbild), prüft die Abnahme; hier die Verkabelung.
describe("Nachtrag 43f: Weich scrollen verkabelt", () => {
  it("der xterm-Handler wird nur in src/host/smooth-wheel.ts angemeldet", () => {
    const treffer = srcFiles().filter((f) => code(readFileSync(f, "utf8")).includes("attachCustomWheelEventHandler")).map(relativeToRoot);
    expect(treffer).toEqual(["src/host/smooth-wheel.ts"]);
    expect(code(read("src/host/smooth-wheel.ts")).split(".attachCustomWheelEventHandler(").length - 1).toBe(1);
  });

  it("TerminalPane.write füttert den ModeTracker vor term.write", () => {
    const write = code(method(read("src/host/terminal-pane.ts"), "  write(data: string"));
    const feed = write.indexOf("this.modes.feed(data)");
    expect(feed).toBeGreaterThanOrEqual(0);
    expect(feed).toBeLessThan(write.indexOf("this.term.write("));
  });

  it("die View liest Schalter, Meta, Tempo und Höchsttempo je Ereignis und meldet in onClose ab", () => {
    const view = code(read("src/host/terminal-view.ts"));
    expect(view).toMatch(/this\.unbindWheel = pane\.attachSmoothWheel\(/);
    expect(view).toMatch(/settings\(\)\.smoothScroll/);
    expect(view).toMatch(/manager\.meta\([^)]*\)\?\.smoothScroll === true/);
    expect(view).toMatch(/settings\(\)\.scrollSpeed/);
    expect(view).toMatch(/settings\(\)\.scrollMaxPerFrame/);
    const close = view.slice(view.indexOf("async onClose()"));
    expect(close).toMatch(/this\.unbindWheel\?\.\(\);\s*this\.unbindWheel = null;/);
    expect(close.indexOf("this.unbindWheel?.()")).toBeLessThan(close.indexOf("this.pane?.dispose()"));
  });

  const launcher = code(read("src/host/launcher.ts"));
  const shellZweig = launcher.slice(launcher.indexOf('record.kind === "shell"'), launcher.indexOf("isDirectory(record.cwd)"));

  it("der Launcher ruft smoothScrollStart genau einmal und reicht das Ergebnis an alle drei Stellen", () => {
    expect(launcher.split("smoothScrollStart(").length - 1).toBe(1);
    expect(launcher).toMatch(/windowsSettings\(\{ \.\.\.start\.exclusion\?\.settings, \.\.\.smooth\.settings \}/);
    expect(launcher).toMatch(/hookSettings\(\{ \.\.\.start\.exclusion\?\.settings, \.\.\.smooth\.settings \}\)/);
    expect(launcher).toMatch(/buildEnv\([^;]*\.\.\.smooth\.env \}/);
  });

  it("der Shell-Zweig kennt weder smooth noch smoothScrollStart", () => {
    expect(shellZweig.length).toBeGreaterThan(50);
    expect(shellZweig).not.toMatch(/smooth/);
  });

  it("main reicht smoothScroll aus den Einstellungen an launcher.plan", () => {
    expect(code(read("src/main.ts"))).toMatch(/launcher\.plan\(record, \{[^}]*smoothScroll: store\.settings\(\)\.smoothScroll/);
  });
});
