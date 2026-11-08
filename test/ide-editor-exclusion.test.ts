import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";

const { MarkdownView, FileView } = vi.hoisted(() => {
  class FileView {}
  class MarkdownView extends FileView {
    file: { path: string; name: string } | null = null;
    editor = { getCursor: () => ({ line: 0, ch: 0 }), getSelection: () => "geheimer Satz" };
    getMode() { return "source"; }
  }
  return { MarkdownView, FileView };
});
vi.mock("obsidian", () => ({ MarkdownView, FileView }));

import { IdeEditor } from "../src/host/ide-editor";

function view(path: string): InstanceType<typeof MarkdownView> {
  const v = new MarkdownView();
  v.file = { path, name: path.split("/").pop() ?? path };
  return v;
}
function appWith(active: InstanceType<typeof MarkdownView>, all: Array<InstanceType<typeof MarkdownView>> = [active]): App {
  return {
    workspace: {
      getActiveViewOfType: () => active,
      getLeavesOfType: () => all.map((v) => ({ view: v })),
    },
  } as unknown as App;
}
const excludedPrefix = (prefix: string) => (p: string) => p.toLowerCase().startsWith(prefix);

describe("IdeEditor mit Ausschluss (Abend 33)", () => {
  it("ausgeschlossene aktive Notiz: keine Auswahl, keine Meldung, kein Erwähnen", async () => {
    const emitted: unknown[] = [];
    const ed = new IdeEditor(appWith(view("Vertraulich/a.md")), () => "/V", (p) => emitted.push(p), excludedPrefix("vertraulich/"), "darwin");
    expect(ed.current()).toBeNull();
    ed.check();
    expect(emitted).toEqual([]);
    expect(ed.mention()).toBeNull();
    expect(JSON.stringify(await ed.handlers().getCurrentSelection())).toContain("No active editor found");
  });
  it("andere Notiz: Auswahl mit absolutem Pfad wie bisher", () => {
    const emitted: Array<{ filePath: string }> = [];
    const ed = new IdeEditor(appWith(view("Offen/a.md")), () => "/V", (p) => emitted.push(p), excludedPrefix("vertraulich/"), "darwin");
    expect(ed.current()?.filePath).toBe("/V/Offen/a.md");
    ed.check();
    expect(emitted.map((p) => p.filePath)).toEqual(["/V/Offen/a.md"]);
  });
  it("offene Editoren ohne ausgeschlossene Notizen", async () => {
    const offen = view("Offen/a.md");
    const ed = new IdeEditor(appWith(offen, [offen, view("Vertraulich/b.md")]), () => "/V", () => undefined, excludedPrefix("vertraulich/"), "darwin");
    const text = JSON.stringify(await ed.handlers().getOpenEditors());
    expect(text).toContain("Offen/a.md");
    expect(text).not.toContain("Vertraulich");
  });
  it("Schalter aus bei laufender Brücke: sofort wieder gemeldet, ohne Neustart (Review Focus)", () => {
    let an = true;
    const ed = new IdeEditor(appWith(view("Vertraulich/a.md")), () => "/V", () => undefined, (p) => an && p.startsWith("Vertraulich/"), "darwin");
    expect(ed.current()).toBeNull();
    an = false;
    expect(ed.current()?.filePath).toBe("/V/Vertraulich/a.md");
  });
  it("ohne viertes Argument wie vor Abend 33", () => {
    const ed = new IdeEditor(appWith(view("Vertraulich/a.md")), () => "/V", () => undefined, () => false, "darwin");
    expect(ed.current()?.filePath).toBe("/V/Vertraulich/a.md");
  });
  it("gemerkte Auswahl: beim Herausgeben gefiltert, nicht beim Merken (Ruling)", async () => {
    let an = false;
    const ed = new IdeEditor(appWith(view("Vertraulich/a.md")), () => "/V", () => undefined, (p) => an && p.startsWith("Vertraulich/"), "darwin");
    ed.check(); // Filter aus: die Auswahl wird gemerkt
    expect(ed.latestSelection()?.text).toBe("geheimer Satz");

    an = true; // Filter an, die Notiz ist jetzt ausgeschlossen
    expect(ed.latestSelection()).toBeNull();
    expect(ed.mention()).toBeNull();
    const gesperrt = JSON.stringify(await ed.handlers().getLatestSelection());
    expect(gesperrt).not.toContain("geheimer Satz");
    expect(gesperrt).toContain("No selection available");

    an = false; // Gegenprobe: Filter wieder aus, die Auswahl ist wieder da
    expect(ed.latestSelection()?.text).toBe("geheimer Satz");
    expect(ed.mention()).not.toBeNull();
    expect(JSON.stringify(await ed.handlers().getLatestSelection())).toContain("geheimer Satz");
  });
});

describe("IdeEditor unter Windows (Abend 42)", () => {
  const WIN_BASE = "C:\\Vault";
  const win = (active: InstanceType<typeof MarkdownView>, base = WIN_BASE) =>
    new IdeEditor(appWith(active), () => base, () => undefined, () => false, "win32");

  it("Auswahl: filePath mit Backslashes, fileUrl mit drei Schrägstrichen", () => {
    const p = win(view("Ordner/a.md")).current();
    expect(p?.filePath).toBe("C:\\Vault\\Ordner\\a.md");
    expect(p?.fileUrl).toBe("file:///C:/Vault/Ordner/a.md");
  });
  it("Backslash am Ende der Basis ändert nichts", () => {
    expect(win(view("Ordner/a.md"), "C:\\Vault\\").current()?.filePath).toBe("C:\\Vault\\Ordner\\a.md");
  });
  it("offene Editoren: uri als file:///C:/…", async () => {
    const text = JSON.stringify(await win(view("Ordner/a.md")).handlers().getOpenEditors());
    expect(JSON.parse(JSON.parse(text).content[0].text).tabs[0].uri).toBe("file:///C:/Vault/Ordner/a.md");
  });
  it("Workspace-Ordner: Name Vault, Pfad mit Backslash, uri als file:///C:/Vault", async () => {
    for (const base of ["C:\\Vault", "C:\\Vault\\"]) {
      const r = await win(view("a.md"), base).handlers().getWorkspaceFolders();
      expect(JSON.parse(r.content[0].text)).toEqual({
        success: true,
        folders: [{ name: "Vault", uri: "file:///C:/Vault", path: "C:\\Vault" }],
        rootPath: "C:\\Vault",
      });
    }
  });
  it("Erwähnung: der Pfad mit Backslashes", () => {
    expect(win(view("Ordner/a.md")).mention()?.filePath).toBe("C:\\Vault\\Ordner\\a.md");
  });
  it("ohne Plattform (Vorgabe darwin) bleibt es beim Mac-Pfad", async () => {
    const ed = new IdeEditor(appWith(view("Ordner/a.md")), () => "/V", () => undefined, () => false, "darwin");
    expect(ed.current()?.filePath).toBe("/V/Ordner/a.md");
    const r = await ed.handlers().getWorkspaceFolders();
    expect(JSON.parse(r.content[0].text)).toEqual({ success: true, folders: [{ name: "V", uri: "file:///V", path: "/V" }], rootPath: "/V" });
  });
});
