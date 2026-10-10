import { describe, expect, it } from "vitest";
import { isPathLike, parseUriList, pathsFromText, resolveObsidianDrop } from "../src/core/drop-sources";

const VAULT = "/Users/alex/Documents/Vault";
const all = () => true;
const none = () => false;

describe("parseUriList", () => {
  it("file-URLs werden dekodiert", () => {
    expect(parseUriList("file:///Users/n/Mein%20Ordner/a.png")).toEqual(["/Users/n/Mein Ordner/a.png"]);
  });
  it("Kommentare, Leerzeilen und CRLF werden übersprungen", () => {
    expect(parseUriList("# Kommentar\r\nfile:///a\r\n\r\nfile:///b\r\n")).toEqual(["/a", "/b"]);
  });
  it("Nicht-file-URLs werden ignoriert", () => {
    expect(parseUriList("https://example.com/x\nfile:///a")).toEqual(["/a"]);
  });
  it("leerer Text liefert nichts", () => {
    expect(parseUriList("")).toEqual([]);
  });
  it("kaputte Prozent-Kodierung fällt nicht um", () => {
    expect(parseUriList("file:///a%ZZ")).toEqual([]);
  });
});

describe("isPathLike", () => {
  it("absolut und Home sind Pfadform", () => {
    expect(isPathLike("/a/b")).toBe(true);
    expect(isPathLike("~/a/b")).toBe(true);
  });
  it("Zeilenumbruch, relativ, leer sind keine Pfadform", () => {
    expect(isPathLike("/a\n/b")).toBe(false);
    expect(isPathLike("a/b")).toBe(false);
    expect(isPathLike("")).toBe(false);
    expect(isPathLike("~foo")).toBe(false);
  });
});

describe("resolveObsidianDrop", () => {
  it("obsidian-URL ohne Endung bekommt .md", () => {
    expect(resolveObsidianDrop("obsidian://open?vault=Vault&file=Ordner%2FNotiz", VAULT, all)).toBe(`${VAULT}/Ordner/Notiz.md`);
  });
  it("obsidian-URL mit Endung bleibt", () => {
    expect(resolveObsidianDrop("obsidian://open?vault=Vault&file=bild.png", VAULT, all)).toBe(`${VAULT}/bild.png`);
  });
  it("anderer Vault-Name ergibt null", () => {
    expect(resolveObsidianDrop("obsidian://open?vault=Anderer&file=Notiz", VAULT, all)).toBeNull();
  });
  it("vault-relativer Pfad mit Endung, wenn die Datei existiert", () => {
    expect(resolveObsidianDrop("Ordner/Notiz.md", VAULT, all)).toBe(`${VAULT}/Ordner/Notiz.md`);
    expect(resolveObsidianDrop("Ordner/Notiz.md", VAULT, none)).toBeNull();
  });
  it("Name ohne Endung ist nicht eindeutig", () => {
    expect(resolveObsidianDrop("Notiz", VAULT, all)).toBeNull();
  });
  it("Ausbruch aus dem Vault wird abgelehnt", () => {
    expect(resolveObsidianDrop("obsidian://open?vault=Vault&file=..%2F..%2Fetc%2Fpasswd", VAULT, all)).toBeNull();
    expect(resolveObsidianDrop("../x.md", VAULT, all)).toBeNull();
  });
  it("mehrzeiliger Text und Fremd-URLs ergeben null", () => {
    expect(resolveObsidianDrop("a.md\nb.md", VAULT, all)).toBeNull();
    expect(resolveObsidianDrop("https://x.de/a.md", VAULT, all)).toBeNull();
  });
});

describe("pathsFromText", () => {
  it("absoluter Pfad", () => {
    expect(pathsFromText("/a/b.txt", VAULT, none)).toEqual(["/a/b.txt"]);
  });
  it("obsidian-URL wird aufgelöst", () => {
    expect(pathsFromText("obsidian://open?vault=Vault&file=N", VAULT, none)).toEqual([`${VAULT}/N.md`]);
  });
  it("normaler Text liefert nichts", () => {
    expect(pathsFromText("hallo welt", VAULT, all)).toEqual([]);
  });
});
