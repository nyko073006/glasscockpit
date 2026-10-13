import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import esbuild from "esbuild";
import { describe, expect, it } from "vitest";
import { EXTERNAL } from "../scripts/lib/externals.ts";

const ROOT = resolve(__dirname, "..");
const SKRIPT = resolve(ROOT, "scripts", "third-party.mjs");
// node-pty landet nicht in main.js, sondern über den Deploy in native/.
const NATIVE_PAKETE = ["node-pty"];

function erzeuge(): string {
  const r = spawnSync("node", [SKRIPT, "--stdout"], { encoding: "utf8", cwd: ROOT });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout;
}

/** Pakete aus node_modules, die esbuild tatsächlich in main.js und styles.css einbettet. */
async function gebuendelt(): Promise<string[]> {
  const gemeinsam = { write: false, metafile: true, bundle: true, logLevel: "silent" as const, absWorkingDir: ROOT };
  const js = await esbuild.build({
    ...gemeinsam,
    entryPoints: ["src/main.ts"],
    format: "cjs",
    platform: "node",
    loader: { ".jpg": "dataurl" },
    external: EXTERNAL,
  });
  const css = await esbuild.build({ ...gemeinsam, entryPoints: ["src/styles.css"] });
  const namen = new Set<string>();
  for (const meta of [js.metafile, css.metafile]) {
    if (!meta) continue;
    for (const datei of Object.keys(meta.inputs)) {
      const m = datei.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
      if (m) namen.add(m[1]);
    }
  }
  return [...namen].sort();
}

describe("THIRD-PARTY-NOTICES", () => {
  it("jede gebündelte Abhängigkeit und node-pty steht drin, je mit Version, Lizenztyp und Copyright-Zeile", async () => {
    const text = erzeuge();
    const pakete = [...(await gebuendelt()), ...NATIVE_PAKETE].sort();
    expect(pakete.length).toBeGreaterThanOrEqual(4);
    for (const name of pakete) {
      const version = JSON.parse(readFileSync(resolve(ROOT, "node_modules", name, "package.json"), "utf8")).version;
      const start = text.indexOf(`## ${name} ${version}`);
      expect(start, `${name} fehlt`).toBeGreaterThanOrEqual(0);
      const abschnitt = text.slice(start).split(/\n## /)[0];
      expect(abschnitt, `${name}: Lizenztyp`).toMatch(/Lizenz: MIT/);
      expect(abschnitt, `${name}: Copyright-Zeile`).toMatch(/^Copyright \([cC]\) .+/m);
      expect(abschnitt, `${name}: Lizenztext`).toContain("Permission is hereby granted");
    }
  });

  it("die Ausgabe ist deterministisch und nach Paketnamen sortiert", () => {
    const a = erzeuge();
    expect(erzeuge()).toBe(a);
    const namen = [...a.matchAll(/^## (\S+) \d/gm)].map((m) => m[1]);
    expect(namen).toEqual([...namen].sort());
  });

  it("nennt das Hintergrundbild mit Herkunft, ohne eine Lizenz zu behaupten", () => {
    const text = erzeuge();
    expect(text).toContain("assets/cockpit-bg.jpg");
    expect(text).toContain("Google Flow");
    expect(text).toContain("Google won’t claim ownership over that content.");
  });

  it("die eingecheckte THIRD-PARTY-NOTICES.md ist aktuell", () => {
    expect(readFileSync(resolve(ROOT, "THIRD-PARTY-NOTICES.md"), "utf8")).toBe(erzeuge());
  });
});

describe("Lizenz und Metadaten", () => {
  it("LICENSE ist MIT mit der festgelegten Copyright-Zeile", () => {
    const text = readFileSync(resolve(ROOT, "LICENSE"), "utf8");
    expect(text).toMatch(/^MIT License\n\nCopyright \(c\) 2026 nyko073006\n/);
    expect(text).toContain("Permission is hereby granted, free of charge");
  });

  it("manifest.json und package.json: englische description ohne Eigengebrauch, Autor und authorUrl", () => {
    const manifest = JSON.parse(readFileSync(resolve(ROOT, "manifest.json"), "utf8"));
    const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
    for (const beschreibung of [manifest.description, pkg.description]) {
      expect(beschreibung).toBe("Run Claude Code sessions as terminal views with a cockpit dashboard.");
      expect(beschreibung).not.toMatch(/Eigengebrauch/);
    }
    expect(manifest.author).toBe("nyko073006");
    expect(pkg.author).toBe("nyko073006");
    expect(manifest.authorUrl).toBe("https://github.com/nyko073006");
    expect(pkg.scripts["third-party"]).toBe("node scripts/third-party.mjs");
  });
});
