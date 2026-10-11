import { describe, expect, it } from "vitest";
import { NATIVE_TARGETS } from "../src/core/shell";
import { DOWNLOAD_TARGETS, type FoundEntry, isSafeRelPath, nativeStatusText, nativeAssetName, nativeAssetUrl, verifyNative } from "../src/core/native-verify";

const H1 = "a".repeat(64);
const H2 = "b".repeat(64);
const erwartet = { "package.json": H1, "lib/index.js": H2 };
const gut = (): FoundEntry[] => [
  { path: "lib", kind: "dir" },
  { path: "lib/index.js", kind: "file", sha256: H2 },
  { path: "package.json", kind: "file", sha256: H1 },
];

describe("Abend 26 (1): verifyNative", () => {
  it("passende Dateimenge und Summen sind ok, in jeder Reihenfolge", () => {
    expect(verifyNative(erwartet, gut())).toEqual({ ok: true });
    expect(verifyNative(erwartet, gut().reverse())).toEqual({ ok: true });
  });

  it("fehlende Datei: Grund nennt den Pfad", () => {
    const r = verifyNative(erwartet, gut().filter((e) => e.path !== "package.json"));
    expect(r).toMatchObject({ ok: false, code: "fehlt" });
    expect(!r.ok && r.reason).toContain("package.json");
  });

  it("Zusatzdatei: Grund nennt den Pfad", () => {
    const r = verifyNative(erwartet, [...gut(), { path: "lib/evil.js", kind: "file", sha256: H1 }]);
    expect(r).toMatchObject({ ok: false, code: "zusatz" });
    expect(!r.ok && r.reason).toContain("lib/evil.js");
  });

  it("Zusatzordner, der zu keiner erwarteten Datei führt, ist eine Zusatzdatei", () => {
    const r = verifyNative(erwartet, [...gut(), { path: "leer", kind: "dir" }]);
    expect(r).toMatchObject({ ok: false, code: "zusatz" });
  });

  it("Symlink statt Datei und Symlink als Zusatz scheitern", () => {
    const stattDatei = gut().map((e) => (e.path === "package.json" ? { path: e.path, kind: "symlink" as const } : e));
    expect(verifyNative(erwartet, stattDatei)).toMatchObject({ ok: false, code: "symlink" });
    expect(verifyNative(erwartet, [...gut(), { path: "x", kind: "symlink" }])).toMatchObject({ ok: false, code: "symlink" });
  });

  it("falsche Summe: Grund nennt den Pfad", () => {
    const r = verifyNative(erwartet, gut().map((e) => (e.path === "lib/index.js" ? { ...e, sha256: H1 } : e)));
    expect(r).toMatchObject({ ok: false, code: "summe" });
    expect(!r.ok && r.reason).toContain("lib/index.js");
  });

  it("Summe wird ohne Groß-/Kleinschreibung nicht aufgeweicht: Großbuchstaben passen nicht", () => {
    const r = verifyNative(erwartet, gut().map((e) => (e.path === "package.json" ? { ...e, sha256: H1.toUpperCase() } : e)));
    expect(r).toMatchObject({ ok: false, code: "summe" });
  });

  it("Pfade mit .. , absolut, leer, Rückwärtsstrich oder doppeltem Schrägstrich scheitern", () => {
    for (const bose of ["../x", "lib/../../x", "/etc/passwd", "lib//a", "a\\b", "", "./a", "lib/."]) {
      const r = verifyNative(erwartet, [...gut(), { path: bose, kind: "file", sha256: H1 }]);
      expect(r, bose).toMatchObject({ ok: false, code: "pfad" });
    }
  });

  it("doppelter Pfad scheitert", () => {
    const r = verifyNative(erwartet, [...gut(), { path: "package.json", kind: "file", sha256: H1 }]);
    expect(r).toMatchObject({ ok: false, code: "pfad" });
  });

  it("andere Typen (Gerät, Socket) und Datei ohne Summe scheitern", () => {
    expect(verifyNative(erwartet, [...gut(), { path: "p", kind: "other" }])).toMatchObject({ ok: false });
    const ohne = gut().map((e) => (e.path === "package.json" ? { path: e.path, kind: "file" as const } : e));
    expect(verifyNative(erwartet, ohne)).toMatchObject({ ok: false, code: "summe" });
  });

  it("eine Datei, wo ein Ordner erwartet wird (lib ist Datei), scheitert", () => {
    const r = verifyNative(erwartet, [{ path: "lib", kind: "file", sha256: H1 }, { path: "package.json", kind: "file", sha256: H1 }]);
    expect(r.ok).toBe(false);
  });

  it("Namen aus Object.prototype zählen nicht als erwartet", () => {
    const r = verifyNative(erwartet, [...gut(), { path: "toString", kind: "file", sha256: H1 }]);
    expect(r).toMatchObject({ ok: false, code: "zusatz" });
  });

  it("leere erwartete Liste ist nie ok (Wächter gegen vakuumen Test)", () => {
    expect(verifyNative({}, [])).toMatchObject({ ok: false });
  });

  it("ein ungültiger erwarteter Pfad macht die Prüfung selbst ungültig", () => {
    expect(verifyNative({ "../x": H1 }, [{ path: "../x", kind: "file", sha256: H1 }])).toMatchObject({ ok: false, code: "pfad" });
  });
});

describe("Abend 26 (1): isSafeRelPath", () => {
  it("lässt normale relative Pfade zu", () => {
    for (const p of ["a", "lib/index.js", "prebuilds/darwin-arm64/pty.node"]) expect(isSafeRelPath(p), p).toBe(true);
  });
});

describe("Abend 26 (1): Download-Adresse", () => {
  it("die Ziele sind die des Loaders", () => {
    expect([...DOWNLOAD_TARGETS]).toEqual([...NATIVE_TARGETS]);
  });

  it("fester Host und Pfad, Tag gleich Manifest-Version ohne v", () => {
    expect(nativeAssetUrl("0.2.0", "darwin-arm64")).toBe(
      "https://github.com/nyko073006/glasscockpit/releases/download/0.2.0/glasscockpit-native-darwin-arm64.zip",
    );
    expect(nativeAssetName("darwin-x64")).toBe("glasscockpit-native-darwin-x64.zip");
  });

  it("Version und Ziel werden geprüft, nichts wird in die Adresse eingeschleust", () => {
    for (const v of ["", "v0.2.0", "0.2", "0.2.0/../x", "0.2.0?x=1", "1.0.0-beta", " 0.2.0"]) {
      expect(() => nativeAssetUrl(v, "darwin-arm64"), v).toThrow();
    }
    expect(() => nativeAssetUrl("0.2.0", "linux-x64")).toThrow();
    expect(() => nativeAssetUrl("0.2.0", "darwin-arm64/../x")).toThrow();
  });
});

describe("Abend 26 (5): Statuszeile der Einstellungen", () => {
  it("nennt Ziel und Zustand", () => {
    expect(nativeStatusText(true, "darwin-arm64")).toBe("Binärdateien vorhanden für darwin-arm64.");
    expect(nativeStatusText(false, "darwin-x64")).toBe("Binärdateien fehlen für darwin-x64.");
  });
});
