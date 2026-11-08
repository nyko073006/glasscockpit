import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { FileSystemAdapter } from "obsidian";
import { hostPlatform, hostTarget, vaultBasePath } from "../src/host/host-platform";

// Abend 42, Task 1: Plattform und Vault-Pfad an einer Stelle im Host.
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

const mitAdapter = (base: string): App =>
  ({ vault: { adapter: new (FileSystemAdapter as unknown as new (b: string) => FileSystemAdapter)(base) } }) as unknown as App;
const ohneAdapter = (): App => ({ vault: { adapter: {} } }) as unknown as App;

describe("hostPlatform und hostTarget", () => {
  it("hostPlatform ist die Plattform dieses Rechners, soweit unterstützt (sonst darwin)", () => {
    expect(hostPlatform()).toBe(process.platform === "win32" ? "win32" : "darwin");
  });
  it("hostTarget liefert die rohen Werte von process", () => {
    expect(hostTarget()).toEqual({ platform: process.platform, arch: process.arch });
  });
});

describe("vaultBasePath", () => {
  it("win32: der 8.3-Kurzname wird über realpath zum Langnamen", () => {
    const realpath = vi.fn((p: string) => (p === "C:\\Users\\JRGENM~1\\V" ? "C:\\Users\\Jürgen Müller\\V" : p));
    expect(vaultBasePath(mitAdapter("C:\\Users\\JRGENM~1\\V"), "win32", realpath)).toBe("C:\\Users\\Jürgen Müller\\V");
    expect(realpath).toHaveBeenCalledWith("C:\\Users\\JRGENM~1\\V");
  });
  it("win32: wirft realpath, bleibt der Rohwert", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const realpath = (): string => {
        throw new Error("ENOENT");
      };
      expect(vaultBasePath(mitAdapter("C:\\Users\\JRGENM~1\\V"), "win32", realpath)).toBe("C:\\Users\\JRGENM~1\\V");
    } finally {
      warn.mockRestore();
    }
  });
  it("win32: wirft realpath, steht Rohwert und Fehlermeldung in einer Warnung (nicht stumm)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const realpath = (): string => {
        throw new Error("EPERM: operation not permitted");
      };
      expect(vaultBasePath(mitAdapter("C:\\Users\\JRGENM~1\\V"), "win32", realpath)).toBe("C:\\Users\\JRGENM~1\\V");
      expect(warn).toHaveBeenCalledTimes(1);
      const text = String(warn.mock.calls[0][0]);
      expect(text).toContain("Glasscockpit");
      expect(text).toContain("C:\\Users\\JRGENM~1\\V");
      expect(text).toContain("EPERM: operation not permitted");
    } finally {
      warn.mockRestore();
    }
  });
  it("win32: Erfolg und darwin warnen nicht", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      vaultBasePath(mitAdapter("C:\\V"), "win32", (p) => p);
      const nie = vi.fn((): string => {
        throw new Error("nie gerufen");
      });
      expect(vaultBasePath(mitAdapter("/v"), "darwin", nie)).toBe("/v");
      expect(nie).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
  // Abend 42, Ruling 4: realpath.native macht aus einem gemappten Laufwerk den UNC-Pfad; Claude sieht aber Z:\\…, die Regeln brauchen den Laufwerkspfad.
  it("win32: gemapptes Laufwerk, realpath liefert UNC: der Rohwert (Laufwerksbuchstabe) bleibt", () => {
    const realpath = vi.fn((p: string) => (p === "Z:\\V" ? "\\\\srv\\share\\V" : p));
    expect(vaultBasePath(mitAdapter("Z:\\V"), "win32", realpath)).toBe("Z:\\V");
    expect(realpath).toHaveBeenCalledWith("Z:\\V");
  });
  it("win32: realpath liefert ein anderes Laufwerk: der Rohwert bleibt", () => {
    expect(vaultBasePath(mitAdapter("Z:\\V"), "win32", () => "D:\\V")).toBe("Z:\\V");
  });
  it("win32: realpath liefert den \\\\?\\-Präfix: der Rohwert bleibt", () => {
    expect(vaultBasePath(mitAdapter("C:\\V"), "win32", () => "\\\\?\\C:\\V")).toBe("C:\\V");
  });
  it("win32: gleiche Wurzel, nur anderer Buchstabenfall: der realpath-Wert gilt", () => {
    expect(vaultBasePath(mitAdapter("c:\\a"), "win32", () => "C:\\a")).toBe("C:\\a");
    expect(vaultBasePath(mitAdapter("C:\\a"), "win32", () => "c:\\a")).toBe("c:\\a");
  });
  // Abend 43, Task 4: Der Brief erwartet, dass ein UNC-Rohwert nicht auf einem lokal gemappten Laufwerk landet. Heute gilt der
  // realpath-Wert (keepsDrive prüft nur Rohwerte mit Laufwerksbuchstaben), also landet er auf D:\\V. Befund für den Lead, Code unverändert.
  it.fails("win32: UNC-Rohwert, realpath liefert ein Laufwerk: der Rohwert bleibt (Brief; heute gilt der realpath-Wert)", () => {
    expect(vaultBasePath(mitAdapter("\\\\srv\\share\\V"), "win32", () => "D:\\V")).toBe("\\\\srv\\share\\V");
  });
  it("win32: Rohwert ohne Laufwerksbuchstaben (UNC): der realpath-Wert gilt", () => {
    expect(vaultBasePath(mitAdapter("\\\\srv\\share\\V"), "win32", () => "\\\\srv2\\share\\V")).toBe("\\\\srv2\\share\\V");
  });
  it("darwin: realpath wird nie aufgerufen, der Rohwert kommt zurück", () => {
    const realpath = vi.fn((p: string) => `${p}-aufgelöst`);
    expect(vaultBasePath(mitAdapter("/Users/n/V"), "darwin", realpath)).toBe("/Users/n/V");
    expect(realpath).not.toHaveBeenCalled();
  });
  it("ohne FileSystemAdapter: null, auch unter win32", () => {
    const realpath = vi.fn((p: string) => p);
    expect(vaultBasePath(ohneAdapter(), "darwin", realpath)).toBeNull();
    expect(vaultBasePath(ohneAdapter(), "win32", realpath)).toBeNull();
    expect(realpath).not.toHaveBeenCalled();
  });
});
