import { builtinModules } from "node:module";

// Was esbuild nicht in main.js packt. Eine Quelle für esbuild.config.mjs und test/third-party.test.ts (Abend 32).
// CodeMirror und Lezer bringt Obsidian zur Laufzeit mit (gemessen am asar von Obsidian 1.14.4); @codemirror/legacy-modes fehlt dort
// und wird deshalb mitgepackt. Darum hier die Laufzeit-Pakete einzeln statt "@codemirror/*".
export const CODEMIRROR_RUNTIME = [
  "@codemirror/state", "@codemirror/view", "@codemirror/commands", "@codemirror/language",
  "@codemirror/autocomplete", "@codemirror/search", "@codemirror/lint", "@codemirror/collab",
];

// Node-Builtins jeweils mit und ohne node:-Präfix.
const builtins = builtinModules.map((name) => name.replace(/^node:/, ""));

export const EXTERNAL = [
  "obsidian",
  "electron",
  ...CODEMIRROR_RUNTIME,
  "@lezer/*",
  // ws: optionale native Zusätze, unbenutzt (ws fällt ohne sie auf reines JavaScript zurück).
  "bufferutil",
  "utf-8-validate",
  ...new Set([...builtins, ...builtins.map((name) => `node:${name}`)]),
];
