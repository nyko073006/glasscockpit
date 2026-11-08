import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isDirSync, isFileSync, loadFile, saveFile } from "../src/host/file-viewer-fs";
import { ON_WINDOWS } from "./helpers/platform";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cockpit-viewer-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const file = (name: string, content: string | Uint8Array): string => {
  const p = join(dir, name);
  writeFileSync(p, content);
  return p;
};
/** mtime eine Sekunde später setzen: so sieht es aus, als hätte jemand anders (Claude) die Datei geändert. */
const touchLater = (p: string): void => {
  const t = statSync(p).mtime.getTime() / 1000 + 1;
  utimesSync(p, t, t);
};

describe("isFileSync: nur existierende Dateien sind Links", () => {
  it("Datei ja, Ordner nein, fehlend nein", () => {
    const p = file("a.md", "x");
    mkdirSync(join(dir, "ordner"));
    expect(isFileSync(p)).toBe(true);
    expect(isFileSync(join(dir, "ordner"))).toBe(false);
    expect(isFileSync(join(dir, "gibt-es-nicht.md"))).toBe(false);
  });
});

describe("isDirSync: nur existierende Ordner, für Pfade mit Leerzeichen (Abend 38)", () => {
  // Windows: Symlink anlegen (Inventur H21)
  it.skipIf(ON_WINDOWS)("Ordner (auch mit Leerzeichen) und Symlink auf einen Ordner ja, Datei nein, fehlend nein", () => {
    const p = file("a.md", "x");
    mkdirSync(join(dir, "mein ordner"));
    symlinkSync(join(dir, "mein ordner"), join(dir, "verweis"));
    expect(isDirSync(join(dir, "mein ordner"))).toBe(true);
    expect(isDirSync(join(dir, "verweis"))).toBe(true);
    expect(isDirSync(p)).toBe(false);
    expect(isDirSync(join(dir, "gibt-es-nicht"))).toBe(false);
  });
});

describe("loadFile", () => {
  it("Text mit mtime", async () => {
    const p = file("a.md", "hallo\nwelt");
    expect(await loadFile(p, 2)).toEqual({ kind: "text", text: "hallo\nwelt", mtimeMs: statSync(p).mtimeMs });
  });
  it("zu groß: Hinweis statt Inhalt", async () => {
    const p = file("gross.txt", "a".repeat(1024 * 1024 + 1));
    expect(await loadFile(p, 1)).toEqual({ kind: "tooLarge", size: 1024 * 1024 + 1, image: false });
  });
  it("binär und kein UTF-8", async () => {
    expect(await loadFile(file("b.bin", Uint8Array.from([1, 0, 2])), 2)).toEqual({ kind: "binary" });
    expect(await loadFile(file("l.txt", Uint8Array.from([0x48, 0xe4, 0x6c])), 2)).toEqual({ kind: "notUtf8" });
  });
  it("fehlende Datei: Fehler mit Grund", async () => {
    const r = await loadFile(join(dir, "weg.md"), 2);
    expect(r.kind).toBe("error");
  });
});

describe("saveFile", () => {
  // Windows: chmod 0o754 und Modus prüfen (Inventur H21)
  it.skipIf(ON_WINDOWS)("schreibt, behält die Rechte, liefert neue mtime, lässt keine Temp-Datei liegen", async () => {
    const p = file("s.sh", "alt");
    chmodSync(p, 0o754);
    const opened = statSync(p).mtimeMs;
    const r = await saveFile(p, "neu", opened, false);
    expect(readFileSync(p, "utf8")).toBe("neu");
    expect(statSync(p).mode & 0o777).toBe(0o754);
    expect(r).toEqual({ status: "saved", mtimeMs: statSync(p).mtimeMs });
    expect(readdirSync(dir)).toEqual(["s.sh"]);
  });
  it("Gegentest: fremde Änderung seit dem Öffnen wird nicht überschrieben", async () => {
    const p = file("c.md", "alt");
    const opened = statSync(p).mtimeMs;
    writeFileSync(p, "von Claude");
    touchLater(p);
    expect(await saveFile(p, "meins", opened, false)).toEqual({ status: "changed" });
    expect(readFileSync(p, "utf8")).toBe("von Claude");
  });
  it("gelöschte Datei fragt ebenfalls nach", async () => {
    const p = file("d.md", "alt");
    const opened = statSync(p).mtimeMs;
    rmSync(p);
    expect(await saveFile(p, "meins", opened, false)).toEqual({ status: "changed" });
  });
  it("nach Rückfrage (force) wird überschrieben", async () => {
    const p = file("e.md", "alt");
    const opened = statSync(p).mtimeMs;
    touchLater(p);
    expect((await saveFile(p, "meins", opened, true)).status).toBe("saved");
    expect(readFileSync(p, "utf8")).toBe("meins");
  });
  // Windows: Symlink anlegen (Inventur H21)
  it.skipIf(ON_WINDOWS)("Symlink bleibt Symlink, geschrieben wird das Ziel", async () => {
    const target = file("ziel.md", "alt");
    const link = join(dir, "link.md");
    symlinkSync(target, link);
    await saveFile(link, "neu", statSync(link).mtimeMs, false);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(target, "utf8")).toBe("neu");
  });
});

describe("loadFile mit Bildgrenze (Nachtrag 43c)", () => {
  const MB3 = 3 * 1024 * 1024;
  const png = (): Uint8Array => new Uint8Array(MB3); // lauter NUL-Bytes
  it("Bild über der Textgrenze, unter der Bildgrenze: image", async () => {
    const p = file("a.png", png());
    const r = await loadFile(p, 2, 20);
    expect(r).toMatchObject({ kind: "image", mime: "image/png", size: MB3 });
    if (r.kind === "image") expect(r.bytes.length).toBe(MB3);
  });
  it("über der Bildgrenze: tooLarge mit image true", async () => {
    expect(await loadFile(file("a.png", png()), 2, 1)).toMatchObject({ kind: "tooLarge", image: true });
  });
  it("Bilder aus: tooLarge mit image false, kleine PNG binary", async () => {
    expect(await loadFile(file("a.png", png()), 2)).toMatchObject({ kind: "tooLarge", image: false });
    expect(await loadFile(file("k.png", Uint8Array.from([1, 0, 2])), 2)).toEqual({ kind: "binary" });
  });
  it("Textdatei groß, Bildgrenze 20: tooLarge ohne image", async () => {
    expect(await loadFile(file("a.md", "a".repeat(MB3)), 2, 20)).toMatchObject({ kind: "tooLarge", image: false });
  });
});
