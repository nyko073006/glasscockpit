import type { App, PluginManifest } from "obsidian";
import { FileSystemAdapter } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { type LoaderDeps, type LoadResult, NativeLoader } from "../src/host/native-loader";

// Lader (Abend 40): Reihenfolge der Schritte je Plattform. Die Attrappe schreibt access, quarantine, chmod und require als
// [name, arg] ins Protokoll (chmod mit dem Modus als drittem Eintrag); osRelease() liefert nur den Wert und steht nicht darin.

vi.mock("obsidian", () => ({
  FileSystemAdapter: class {
    private readonly base: string;
    constructor(base: string) {
      this.base = base;
    }
    getBasePath() {
      return this.base;
    }
  },
}));

const MANIFEST = { dir: ".obsidian/plugins/glasscockpit" } as PluginManifest;

function app(vault: string): App {
  return { vault: { adapter: new (FileSystemAdapter as unknown as new (base: string) => FileSystemAdapter)(vault) } } as unknown as App;
}

function attrappe(deps: Partial<LoaderDeps> & Pick<LoaderDeps, "platform" | "arch">) {
  const protokoll: unknown[][] = [];
  const pty = { spawn: () => ({}) };
  const alle: LoaderDeps = {
    osRelease: () => "10.0.26100",
    access: (pfad) => void protokoll.push(["access", pfad]),
    chmod: (pfad, modus) => void protokoll.push(["chmod", pfad, modus]),
    quarantine: async (ordner) => {
      protokoll.push(["quarantine", ordner]);
      return "xattr ok";
    },
    require: (id) => {
      protokoll.push(["require", id]);
      return pty;
    },
    ...deps,
  };
  return { deps: alle, protokoll, pty };
}

function fehlertext(result: LoadResult): string {
  if (result.ok) throw new Error("Der Lader hat geladen, erwartet war ein Fehler.");
  return result.error.message;
}

describe("NativeLoader (Abend 40)", () => {
  it("Mac: Reihenfolge wie bisher", async () => {
    // Die Windows-Version darf auf dem Mac nie gelesen werden: ein kaputter Wert würde sonst abbrechen.
    const { deps, protokoll } = attrappe({ platform: "darwin", arch: "arm64", osRelease: () => "kaputt" });
    const ziel = "/v/.obsidian/plugins/glasscockpit/native/darwin-arm64";

    const result = await new NativeLoader(app("/v"), MANIFEST, deps).load();

    expect(protokoll).toStrictEqual([
      ["access", `${ziel}/lib/index.js`],
      ["quarantine", "/v/.obsidian/plugins/glasscockpit/native"],
      ["chmod", `${ziel}/prebuilds/darwin-arm64/pty.node`, 0o755],
      ["chmod", `${ziel}/prebuilds/darwin-arm64/spawn-helper`, 0o755],
      ["require", `${ziel}/prebuilds/darwin-arm64/pty.node`],
      ["require", `${ziel}/lib/index.js`],
    ]);
    expect(result.ok).toBe(true);
  });

  it("Windows: kein xattr, kein chmod, conpty.node zuerst", async () => {
    const { deps, protokoll } = attrappe({ platform: "win32", arch: "x64", osRelease: () => "10.0.26100" });
    const ziel = "C:\\v\\.obsidian\\plugins\\glasscockpit\\native\\win32-x64";

    const result = await new NativeLoader(app("C:\\v"), MANIFEST, deps).load();

    expect(protokoll).toStrictEqual([
      ["access", `${ziel}\\lib\\index.js`],
      ["require", `${ziel}\\prebuilds\\win32-x64\\conpty.node`],
      ["require", `${ziel}\\lib\\index.js`],
    ]);
    expect(result.ok).toBe(true);
  });

  it("Windows zu alt: Meldung statt node-pty-Fehler, nichts wird angefasst", async () => {
    const { deps, protokoll } = attrappe({ platform: "win32", arch: "x64", osRelease: () => "10.0.17763" });

    const result = await new NativeLoader(app("C:\\v"), MANIFEST, deps).load();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("windows-alt");
    expect(result.error.message).toContain("(hier: Build 17763)");
    expect(protokoll.filter(([name]) => name === "require")).toStrictEqual([]);
    // Die Versionsprüfung steht vor jedem Dateizugriff.
    expect(protokoll).toStrictEqual([]);
  });

  it("Erfolg wird gemerkt", async () => {
    const { deps, protokoll, pty } = attrappe({ platform: "darwin", arch: "x64" });
    const loader = new NativeLoader(app("/v"), MANIFEST, deps);
    expect(loader.isLoaded()).toBe(false);

    const erst = await loader.load();
    expect(loader.isLoaded()).toBe(true);
    const nach = protokoll.length;
    expect(nach).toBeGreaterThan(0);

    const zweit = await loader.load();
    expect(protokoll).toHaveLength(nach);
    expect(erst.ok && (erst.pty as unknown) === pty).toBe(true);
    expect(zweit.ok && (zweit.pty as unknown) === pty).toBe(true);
  });

  it("ein Fehler wird nicht gemerkt: der nächste Versuch läuft wieder", async () => {
    let versuche = 0;
    const { deps } = attrappe({
      platform: "win32",
      arch: "arm64",
      require: () => {
        if (++versuche === 1) throw new Error("The specified module could not be found.");
        return {};
      },
    });
    const loader = new NativeLoader(app("C:\\v"), MANIFEST, deps);

    const erst = await loader.load();
    expect(erst.ok).toBe(false);
    if (!erst.ok) expect(erst.error.kind).toBe("fehlt");
    expect(loader.isLoaded()).toBe(false);

    expect((await loader.load()).ok).toBe(true);
    expect(loader.isLoaded()).toBe(true);
  });

  it("unbekannter Fehler unter Windows nennt Strg+Umschalt+I, auf dem Mac Cmd+Option+I", async () => {
    const wirft = () => {
      throw new Error("Unerwartet");
    };
    const win = await new NativeLoader(app("C:\\v"), MANIFEST, attrappe({ platform: "win32", arch: "x64", require: wirft }).deps).load();
    const mac = await new NativeLoader(app("/v"), MANIFEST, attrappe({ platform: "darwin", arch: "x64", require: wirft }).deps).load();

    expect(fehlertext(win)).toContain("Strg+Umschalt+I");
    expect(fehlertext(mac)).toContain("Cmd+Option+I");
  });

  it("Plattform ohne Binärdateien: Meldung mit dem Ziel, Hinweis wie auf dem Mac", async () => {
    const { deps, protokoll } = attrappe({ platform: "linux", arch: "x64" });

    const result = await new NativeLoader(app("/v"), MANIFEST, deps).load();

    expect(protokoll).toStrictEqual([]);
    expect(fehlertext(result)).toContain("Glasscockpit unterstützt nur macOS und Windows, jeweils arm64 und x64 (hier: linux-x64).");
    expect(fehlertext(result)).toContain("Cmd+Option+I");
  });
});
