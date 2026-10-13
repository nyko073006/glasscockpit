import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import esbuild from "esbuild";
import { describe, expect, it } from "vitest";
import { CODEMIRROR_RUNTIME, EXTERNAL } from "../scripts/lib/externals.ts";

const ROOT = resolve(__dirname, "..");

/** main.js wie im echten Build, nur im Speicher. */
async function bundle(): Promise<string> {
  const r = await esbuild.build({
    entryPoints: ["src/main.ts"], bundle: true, write: false, format: "cjs", platform: "node", target: "es2020",
    external: EXTERNAL, loader: { ".jpg": "dataurl" }, logLevel: "silent", absWorkingDir: ROOT,
  });
  return r.outputFiles[0].text;
}

// Abend 32: Obsidian bringt CodeMirror zur Laufzeit mit, aber keine legacy-modes. Die müssen in main.js stecken, die
// Laufzeit-Pakete dürfen es nicht (sonst zwei Instanzen von @codemirror/state neben Obsidians Editor).
describe("Build: Extern-Liste", () => {
  it("legacy-modes stecken in main.js, Laufzeit-Pakete bleiben require-Aufrufe", async () => {
    const js = await bundle();
    expect(js).toMatch(/name:\s*"swift"/);
    expect(js).not.toContain('require("@codemirror/legacy-modes');
    expect(js).toContain('require("@codemirror/language")');
    expect(js).toContain('require("@codemirror/autocomplete")');
    expect(js).toContain('require("@lezer/highlight")');
    expect(js).toContain('require("@codemirror/state")');
  });

  it("CodeMirror einzeln statt @codemirror/*, Lezer bleibt ganz extern", () => {
    expect(EXTERNAL).not.toContain("@codemirror/*");
    expect(EXTERNAL).toContain("@lezer/*");
    expect(CODEMIRROR_RUNTIME).toEqual(["@codemirror/state", "@codemirror/view", "@codemirror/commands", "@codemirror/language",
      "@codemirror/autocomplete", "@codemirror/search", "@codemirror/lint", "@codemirror/collab"]);
    for (const name of CODEMIRROR_RUNTIME) expect(EXTERNAL).toContain(name);
  });

  it("esbuild.config.mjs nimmt die Liste aus scripts/lib/externals.ts", () => {
    const cfg = readFileSync(resolve(ROOT, "esbuild.config.mjs"), "utf8");
    expect(cfg).toMatch(/import \{ EXTERNAL \} from "\.\/scripts\/lib\/externals\.ts";/);
    expect(cfg).toMatch(/external: EXTERNAL,/);
    expect(cfg).not.toContain("@codemirror/*");
  });
});
