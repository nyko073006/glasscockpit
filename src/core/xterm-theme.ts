/** Liefert den Wert einer CSS-Variable oder einen leeren String. */
export type ReadVar = (name: string) => string;

/**
 * Woher jeder xterm-Farbschlüssel kommt. Die Palette folgt dem Obsidian-Theme:
 * black ist der Hintergrundton, white der Textton. So bleibt Text in Hell und Dunkel lesbar.
 * Die hellen Varianten nehmen dieselben Farben, die festen xterm-Werte wären im hellen Theme unlesbar.
 * Die Variablen sind in Obsidian 1.13.7 (app.css) belegt.
 */
export const THEME_SOURCES = {
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
} as const;

export type ThemeKey = keyof typeof THEME_SOURCES;
export type TerminalTheme = Record<ThemeKey, string>;

/** Rückfallwerte: Obsidians dunkle Standardfarben, im Format, das xterm ohne Canvas liest. */
export const THEME_FALLBACKS: TerminalTheme = {
  background: "#1e1e1e",
  foreground: "#dadada",
  cursor: "#a882ff",
  cursorAccent: "#1e1e1e",
  selectionBackground: "rgba(168, 130, 255, 0.33)",
  black: "#262626",
  red: "#fb464c",
  green: "#44cf6e",
  yellow: "#e0de71",
  blue: "#027aff",
  magenta: "#a882ff",
  cyan: "#53dfdd",
  white: "#b3b3b3",
  brightBlack: "#666666",
  brightRed: "#fb464c",
  brightGreen: "#44cf6e",
  brightYellow: "#e0de71",
  brightBlue: "#027aff",
  brightMagenta: "#a882ff",
  brightCyan: "#53dfdd",
  brightWhite: "#dadada",
};

/** Baut das xterm-Theme aus den CSS-Variablen; fehlende oder leere Werte fallen einzeln zurück. */
export function buildTheme(readVar: ReadVar): TerminalTheme {
  const theme = {} as TerminalTheme;
  for (const key of Object.keys(THEME_SOURCES) as ThemeKey[]) {
    const value = readVar(THEME_SOURCES[key]).trim();
    theme[key] = value === "" ? THEME_FALLBACKS[key] : value;
  }
  return theme;
}

/**
 * Formatiert ein Pixel (Kanäle 0 bis 255) so, wie der Farb-Parser von xterm 6 es ohne Canvas liest.
 * Den Canvas-Weg nimmt xterm nur für deckende Farben, Obsidians Auswahlfarbe ist durchscheinend.
 */
export function rgbaToCss(r: number, g: number, b: number, a: number): string {
  if (a >= 255) {
    return `#${[r, g, b].map((kanal) => kanal.toString(16).padStart(2, "0")).join("")}`;
  }
  const alpha = Number((a / 255).toFixed(3));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
