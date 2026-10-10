import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "./helpers/files";

const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// Abend 15: Das Hintergrundbild steckt als Data-URL in main.js. Der Deploy kopiert weiter nur main.js,
// manifest.json, styles.css und native/, deshalb darf das Bild keine eigene Datei im Ziel brauchen.
describe("Cockpit-Hintergrundbild eingebettet", () => {
  it("esbuild lädt .jpg als dataurl", () => {
    expect(read("esbuild.config.mjs")).toMatch(/loader:\s*\{[^}]*"\.jpg":\s*"dataurl"/);
  });

  it("Typdeklaration für *.jpg gibt einen String", () => {
    const d = read("src/assets.d.ts");
    expect(d).toMatch(/declare module "\*\.jpg"/);
    expect(d).toMatch(/export default \w+:\s*string|const \w+:\s*string;\s*export default/);
  });

  it("das Bild liegt im Repo und ist ein JPEG in der erwarteten Größe", () => {
    const p = join(ROOT, "assets/cockpit-bg.jpg");
    expect(existsSync(p)).toBe(true);
    const bytes = readFileSync(p);
    expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect(statSync(p).size).toBeLessThan(400_000);
  });

  it("der Deploy bleibt unverändert: keine Bilddatei im Kopierauftrag", () => {
    expect(read("scripts/deploy.mjs")).not.toMatch(/cockpit-bg|\.jpg|assets/);
  });
});
