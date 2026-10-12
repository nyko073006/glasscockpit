import { describe, expect, it } from "vitest";
import { isPathLike, parseUriList, pathsFromText, resolveObsidianDrop } from "../src/core/drop-sources";

const VAULT = "/Users/alex/Documents/Vault";
const all = () => true;
const none = () => false;

// Was der Host über metadataCache.getFirstLinkpathDest findet: Name aus der URL -> Vault-Pfad der Datei.
const KNOWN: Record<string, string> = {
  Notiz: "Projekte/A/Notiz.md",
  "Ordner/Notiz": "Ordner/Notiz.md",
  "bild.png": "Anhänge/bild.png",
};
const lookup = (name: string): string | null => KNOWN[name] ?? null;
const noName = (): string | null => null;

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
  it("Notiz im Unterordner: nur der Name in der URL, der Pfad kommt vom Resolver", () => {
    expect(resolveObsidianDrop("obsidian://open?vault=Vault&file=Notiz", VAULT, all, lookup)).toBe(`${VAULT}/Projekte/A/Notiz.md`);
  });
  it("Name mit Ordner wird aufgelöst", () => {
    expect(resolveObsidianDrop("obsidian://open?vault=Vault&file=Ordner%2FNotiz", VAULT, all, lookup)).toBe(`${VAULT}/Ordner/Notiz.md`);
  });
  it("Anhang mit Endung wird aufgelöst", () => {
    expect(resolveObsidianDrop("obsidian://open?vault=Vault&file=bild.png", VAULT, all, lookup)).toBe(`${VAULT}/Anhänge/bild.png`);
  });
  it("Name, den es nicht gibt, ergibt null (nichts wird erfunden)", () => {
    expect(resolveObsidianDrop("obsidian://open?vault=Vault&file=Gibtsnicht", VAULT, all, lookup)).toBeNull();
  });
  it("der Resolver bekommt den dekodierten Namen, ohne angehängtes .md", () => {
    const calls: string[] = [];
    resolveObsidianDrop("obsidian://open?vault=Vault&file=Ordner%2FNotiz", VAULT, all, (name) => (calls.push(name), null));
    expect(calls).toEqual(["Ordner/Notiz"]);
  });
  it("anderer Vault-Name ergibt null, der Resolver wird nicht gefragt", () => {
    const calls: string[] = [];
    const spy = (name: string) => (calls.push(name), "x.md");
    expect(resolveObsidianDrop("obsidian://open?vault=Anderer&file=Notiz", VAULT, all, spy)).toBeNull();
    expect(calls).toEqual([]);
  });
  it("ohne Vault-Basis ergibt null, der Resolver wird nicht gefragt (sonst entstünde ein Pfad ab /)", () => {
    const calls: string[] = [];
    const spy = (name: string) => (calls.push(name), "Projekte/A/Notiz.md");
    expect(resolveObsidianDrop("obsidian://open?file=Notiz", "", all, spy)).toBeNull();
    expect(resolveObsidianDrop("obsidian://open?vault=Vault&file=Notiz", "", all, spy)).toBeNull();
    expect(calls).toEqual([]);
  });
  it("vault-relativer Pfad mit Endung, wenn die Datei existiert", () => {
    expect(resolveObsidianDrop("Ordner/Notiz.md", VAULT, all, noName)).toBe(`${VAULT}/Ordner/Notiz.md`);
    expect(resolveObsidianDrop("Ordner/Notiz.md", VAULT, none, noName)).toBeNull();
  });
  it("Name ohne Endung ist nicht eindeutig", () => {
    expect(resolveObsidianDrop("Notiz", VAULT, all, lookup)).toBeNull();
  });
  it("Ausbruch aus dem Vault wird abgelehnt, der Resolver wird nicht gefragt", () => {
    const calls: string[] = [];
    const spy = (name: string) => (calls.push(name), "x.md");
    expect(resolveObsidianDrop("obsidian://open?vault=Vault&file=..%2F..%2Fetc%2Fpasswd", VAULT, all, spy)).toBeNull();
    expect(resolveObsidianDrop("../x.md", VAULT, all, spy)).toBeNull();
    expect(calls).toEqual([]);
  });
  it("liefert der Resolver einen Pfad mit .., ergibt das null", () => {
    expect(resolveObsidianDrop("obsidian://open?vault=Vault&file=Notiz", VAULT, all, () => "../x.md")).toBeNull();
  });
  it("mehrzeiliger Text und Fremd-URLs ergeben null", () => {
    expect(resolveObsidianDrop("a.md\nb.md", VAULT, all, lookup)).toBeNull();
    expect(resolveObsidianDrop("https://x.de/a.md", VAULT, all, lookup)).toBeNull();
  });
});

describe("pathsFromText", () => {
  it("absoluter Pfad", () => {
    expect(pathsFromText("/a/b.txt", VAULT, none, noName)).toEqual(["/a/b.txt"]);
  });
  it("obsidian-URL wird über den Resolver aufgelöst, auch aus dem Unterordner", () => {
    expect(pathsFromText("obsidian://open?vault=Vault&file=Notiz", VAULT, none, lookup)).toEqual([`${VAULT}/Projekte/A/Notiz.md`]);
  });
  it("obsidian-URL mit unbekanntem Namen liefert nichts", () => {
    expect(pathsFromText("obsidian://open?vault=Vault&file=N", VAULT, none, lookup)).toEqual([]);
  });
  it("normaler Text liefert nichts", () => {
    expect(pathsFromText("hallo welt", VAULT, all, lookup)).toEqual([]);
  });
});
