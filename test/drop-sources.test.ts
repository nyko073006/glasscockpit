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
  it("win32: Laufwerkspfad ohne führenden Schrägstrich, mit Backslash, dekodiert", () => {
    expect(parseUriList("file:///C:/Users/x/a%20b.md", "win32")).toEqual(["C:\\Users\\x\\a b.md"]);
  });
  it("win32: file://server/share wird UNC", () => {
    expect(parseUriList("file://srv/share/a.md", "win32")).toEqual(["\\\\srv\\share\\a.md"]);
  });
  it("win32: Umlaut, # und Klammern aus der Kodierung", () => {
    expect(parseUriList("file:///C:/Users/J%C3%BCrgen%20M%C3%BCller/Mein%20Ordner%20(alt)/a%20%231.md", "win32")).toEqual([
      "C:\\Users\\Jürgen Müller\\Mein Ordner (alt)\\a #1.md",
    ]);
  });
  it("darwin bleibt mit und ohne Angabe gleich (kein Laufwerk-Umbau)", () => {
    expect(parseUriList("file:///C:/Users/x/a.md")).toEqual(["/C:/Users/x/a.md"]);
    expect(parseUriList("file:///C:/Users/x/a.md", "darwin")).toEqual(["/C:/Users/x/a.md"]);
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
  it("win32: Laufwerk, UNC und Home sind Pfadform", () => {
    for (const p of ["C:\\a", "c:/a", "\\\\srv\\s\\a", "~\\a", "~/a"]) expect(isPathLike(p, "win32"), p).toBe(true);
  });
  it("win32: nacktes Laufwerk und relativer Pfad sind keine Pfadform", () => {
    for (const p of ["C:", "a\\b", "\\a", "C:a"]) expect(isPathLike(p, "win32"), p).toBe(false);
  });
  it("darwin: Backslash-Pfade bleiben keine Pfadform", () => {
    expect(isPathLike("C:\\a")).toBe(false);
    expect(isPathLike("~\\a")).toBe(false);
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

describe("Vault auf Windows (win32)", () => {
  const WVAULT = "C:\\Users\\x\\Mein Vault";
  it("resolveObsidianDrop: Notiz im Unterordner, Teile mit Backslash", () => {
    expect(resolveObsidianDrop("obsidian://open?vault=Mein%20Vault&file=Notiz", WVAULT, all, lookup, "win32")).toBe(`${WVAULT}\\Projekte\\A\\Notiz.md`);
  });
  it("resolveObsidianDrop: Vault-Name aus dem letzten Teil, auch mit Backslash am Ende", () => {
    expect(resolveObsidianDrop("obsidian://open?vault=Mein%20Vault&file=Notiz", `${WVAULT}\\`, all, lookup, "win32")).toBe(`${WVAULT}\\Projekte\\A\\Notiz.md`);
    expect(resolveObsidianDrop("obsidian://open?vault=Anderer&file=Notiz", WVAULT, all, lookup, "win32")).toBeNull();
  });
  it("resolveObsidianDrop: Ausbruch mit .. in beiden Schreibweisen abgelehnt", () => {
    expect(resolveObsidianDrop("obsidian://open?vault=Mein%20Vault&file=..%5Cx", WVAULT, all, () => "..\\x.md", "win32")).toBeNull();
    expect(resolveObsidianDrop("a\\..\\b.md", WVAULT, all, noName, "win32")).toBeNull();
  });
  it("resolveObsidianDrop: vault-relativer Pfad mit Endung (beide Trenner) wird zu Backslash-Pfad", () => {
    expect(resolveObsidianDrop("Ordner/Notiz.md", WVAULT, all, noName, "win32")).toBe(`${WVAULT}\\Ordner\\Notiz.md`);
    expect(resolveObsidianDrop("Ordner\\Notiz.md", WVAULT, all, noName, "win32")).toBe(`${WVAULT}\\Ordner\\Notiz.md`);
    expect(resolveObsidianDrop("Ordner/Notiz.md", WVAULT, none, noName, "win32")).toBeNull();
  });
  it("resolveObsidianDrop: absolute Windows-Pfade sind kein vault-relativer Pfad", () => {
    expect(resolveObsidianDrop("C:\\x\\a.md", WVAULT, all, noName, "win32")).toBeNull();
    expect(resolveObsidianDrop("\\\\srv\\s\\a.md", WVAULT, all, noName, "win32")).toBeNull();
  });
  it("pathsFromText: Laufwerkspfad und UNC gelten als Pfad, Obsidian-Name wird aufgelöst", () => {
    expect(pathsFromText("C:\\a\\b.md", WVAULT, none, noName, "win32")).toEqual(["C:\\a\\b.md"]);
    expect(pathsFromText("obsidian://open?vault=Mein%20Vault&file=Notiz", WVAULT, all, lookup, "win32")).toEqual([`${WVAULT}\\Projekte\\A\\Notiz.md`]);
    expect(pathsFromText("irgendwas", WVAULT, none, noName, "win32")).toEqual([]);
  });
  it("Abend 43: pathsFromText: wurzelrelativer Pfad im Vault ergibt dieselbe Erwähnung wie der Laufwerkspfad", () => {
    const base = "C:\\Vault";
    const ref = pathsFromText("C:\\Vault\\a.md", base, none, noName, "win32");
    expect(ref).toEqual(["C:\\Vault\\a.md"]);
    expect(pathsFromText("\\Vault\\a.md", base, all, noName, "win32")).toEqual(ref);
    expect(pathsFromText("/Vault/a.md", base, all, noName, "win32")).toEqual(ref);
    expect(pathsFromText("\\Vault\\a.md", base, none, noName, "win32")).toEqual([]); // gibt es die Datei nicht, ist es kein Pfad
  });
  it("Abend 43: pathsFromText: Text, der nur nach Pfad aussieht, bleibt Text", () => {
    for (const t of ["/foo\nbar baz", "/clear", "// kommentar", "\\\\srv", "C:a.md"]) expect(pathsFromText(t, "C:\\Vault", (abs) => abs === "C:\\Vault\\a.md", noName, "win32"), t).toEqual([]);
    expect(pathsFromText("\\x\\a.md", "", all, noName, "win32")).toEqual([]);
  });
  it("Abend 43: darwin: ein Text mit \\ am Anfang bleibt kein Pfad", () => {
    expect(pathsFromText("\\Vault\\a.md", VAULT, none, noName)).toEqual([]);
  });
  it("Vorgabe darwin: ein Windows-Vault wird nicht als Backslash-Vault erkannt und mit Schrägstrich verbunden", () => {
    // Der Vault-Name ist der ganze Pfad (kein "/" darin), also passt "Mein Vault" nicht; ohne vault= in der URL wird mit "/" angehängt.
    expect(resolveObsidianDrop("obsidian://open?vault=Mein%20Vault&file=Notiz", WVAULT, all, lookup)).toBeNull();
    expect(resolveObsidianDrop("obsidian://open?file=Notiz", WVAULT, all, lookup)).toBe(`${WVAULT}/Projekte/A/Notiz.md`);
  });
});
