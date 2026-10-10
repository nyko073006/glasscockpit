import { describe, expect, it } from "vitest";
import {
  THEME_FALLBACKS,
  THEME_SOURCES,
  type ThemeKey,
  buildTheme,
  rgbaToCss,
} from "../src/core/xterm-theme";

// Abbildung laut Bauauftrag Abend 2, hier ausgeschrieben, damit eine Änderung an
// THEME_SOURCES nicht unbemerkt durchrutscht.
const ERWARTETE_QUELLEN: Record<ThemeKey, string> = {
  background: "--background-primary",
  foreground: "--text-normal",
  cursor: "--text-accent",
  cursorAccent: "--background-primary",
  selectionBackground: "--text-selection",
  black: "--background-secondary",
  red: "--color-red",
  green: "--color-green",
  yellow: "--color-yellow",
  blue: "--color-blue",
  magenta: "--color-purple",
  cyan: "--color-cyan",
  white: "--text-muted",
  brightBlack: "--text-faint",
  brightRed: "--color-red",
  brightGreen: "--color-green",
  brightYellow: "--color-yellow",
  brightBlue: "--color-blue",
  brightMagenta: "--color-purple",
  brightCyan: "--color-cyan",
  brightWhite: "--text-normal",
};

const SCHLUESSEL = Object.keys(ERWARTETE_QUELLEN) as ThemeKey[];
const VARIABLEN = [...new Set(Object.values(ERWARTETE_QUELLEN))];

/** Liefert für jede Variable einen eindeutigen Wert, ausser für die in `fehlend`. */
function leser(fehlend: string[] = []) {
  return (name: string) => (fehlend.includes(name) ? "" : `wert(${name})`);
}

// Das Format, das der Farb-Parser von xterm 6.0.0 ohne Canvas akzeptiert.
const XTERM_FARBE = /^(#[0-9a-f]{6}|rgba\(\d{1,3}, \d{1,3}, \d{1,3}, (0|1|0?\.\d+)\))$/i;

describe("buildTheme", () => {
  it("Abbildung entspricht dem Bauauftrag", () => {
    expect(THEME_SOURCES).toEqual(ERWARTETE_QUELLEN);
  });

  it("mit allen Variablen: jeder Schlüssel kommt aus seiner Variable", () => {
    const theme = buildTheme(leser());
    expect(Object.keys(theme).sort()).toEqual([...SCHLUESSEL].sort());
    for (const schluessel of SCHLUESSEL) {
      expect(theme[schluessel], schluessel).toBe(`wert(${ERWARTETE_QUELLEN[schluessel]})`);
    }
  });

  it("Werte werden getrimmt", () => {
    const theme = buildTheme((name) => `  wert(${name})\n`);
    expect(theme.background).toBe("wert(--background-primary)");
  });

  it("mit lauter leeren Werten: jeder Schlüssel hat einen Rückfall", () => {
    const theme = buildTheme(() => "");
    expect(Object.keys(theme).sort()).toEqual([...SCHLUESSEL].sort());
    for (const schluessel of SCHLUESSEL) {
      expect(theme[schluessel], schluessel).toBe(THEME_FALLBACKS[schluessel]);
      expect(theme[schluessel], schluessel).not.toBe("");
    }
  });

  it("nur Leerzeichen zählt als fehlend", () => {
    const theme = buildTheme(() => "   ");
    // Ohne die zweite Zusicherung wäre undefined === undefined schon grün.
    expect(theme.foreground).toBe(THEME_FALLBACKS.foreground);
    expect(theme.foreground).toMatch(XTERM_FARBE);
  });

  it("jeder Rückfallwert ist für xterm ohne Canvas lesbar", () => {
    for (const schluessel of SCHLUESSEL) {
      expect(THEME_FALLBACKS[schluessel], schluessel).toMatch(XTERM_FARBE);
    }
  });

  it.each(VARIABLEN)("nur %s fehlt: nur die davon gespeisten Schlüssel fallen zurück", (variable) => {
    const theme = buildTheme(leser([variable]));
    for (const schluessel of SCHLUESSEL) {
      const quelle = ERWARTETE_QUELLEN[schluessel];
      const erwartet = quelle === variable ? THEME_FALLBACKS[schluessel] : `wert(${quelle})`;
      expect(theme[schluessel], schluessel).toBe(erwartet);
    }
  });
});

describe("rgbaToCss", () => {
  it("deckend wird #rrggbb", () => {
    expect(rgbaToCss(255, 0, 16, 255)).toBe("#ff0010");
  });

  it("durchscheinend wird rgba mit Alpha auf drei Stellen", () => {
    expect(rgbaToCss(168, 130, 255, 84)).toBe("rgba(168, 130, 255, 0.329)");
  });

  it("ganz durchsichtig bleibt lesbar", () => {
    expect(rgbaToCss(0, 0, 0, 0)).toBe("rgba(0, 0, 0, 0)");
  });

  it("Ausgabe passt immer zum Parser von xterm", () => {
    for (const alpha of [0, 1, 84, 128, 254, 255]) {
      expect(rgbaToCss(12, 34, 56, alpha)).toMatch(XTERM_FARBE);
    }
  });
});
