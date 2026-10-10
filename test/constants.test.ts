import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CSS_PREFIX,
  PLUGIN_ID,
  TERMINAL_FONT_FAMILY,
  TERMINAL_MAC_OPTION_IS_META,
  VIEW_TYPE_DASHBOARD,
  VIEW_TYPE_TERMINAL,
} from "../src/core/constants";
import * as constants from "../src/core/constants";
import { ROOT } from "./helpers/files";

describe("(a) Namensraum und Konstanten", () => {
  it("Plugin-ID beginnt mit glasscockpit", () => {
    expect(PLUGIN_ID).toMatch(/^glasscockpit/);
  });

  it("beide View-Typen beginnen mit glasscockpit", () => {
    expect(VIEW_TYPE_TERMINAL).toMatch(/^glasscockpit/);
    expect(VIEW_TYPE_DASHBOARD).toMatch(/^glasscockpit/);
  });

  it("Plugin-ID und View-Typen haben die festgelegten Werte", () => {
    expect(PLUGIN_ID).toBe("glasscockpit");
    expect(VIEW_TYPE_TERMINAL).toBe("glasscockpit-terminal");
    expect(VIEW_TYPE_DASHBOARD).toBe("glasscockpit-dashboard");
  });

  it("manifest.json: id ist PLUGIN_ID", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
    expect(manifest.id).toBe(PLUGIN_ID);
  });

  it("CSS_PREFIX ist cockpit-", () => {
    expect(CSS_PREFIX).toBe("cockpit-");
  });

  it("SKIP_PERMISSIONS gibt es nicht mehr: die Rechte-Überspringung ist eine Einstellung (Abend 20)", () => {
    expect("SKIP_PERMISSIONS" in constants).toBe(false);
  });
});

describe("Terminal-Optionen", () => {
  it("Schrift ist Monaco mit Rückfall (Entscheidung vom 04.10.2026)", () => {
    expect(TERMINAL_FONT_FAMILY).toBe("Monaco, Menlo, monospace");
  });

  // Mit Option als Meta schickt Option+L auf der deutschen Mac-Tastatur ESC l statt @.
  it("Option ist keine Meta-Taste, damit Option+L ein @ tippt", () => {
    expect(TERMINAL_MAC_OPTION_IS_META).toBe(false);
  });
});
