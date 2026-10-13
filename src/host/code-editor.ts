import type * as AutocompleteModule from "@codemirror/autocomplete";
import type * as LanguageModule from "@codemirror/language";
import type { StreamParser } from "@codemirror/language";
import { css } from "@codemirror/legacy-modes/mode/css";
import { javascript, json, typescript } from "@codemirror/legacy-modes/mode/javascript";
import { python } from "@codemirror/legacy-modes/mode/python";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { standardSQL } from "@codemirror/legacy-modes/mode/sql";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { html } from "@codemirror/legacy-modes/mode/xml";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type * as HighlightModule from "@lezer/highlight";
import { KEYWORDS, type LanguageId, languageForPath } from "../core/code-languages";

// Datei-Viewer als kleiner Code-Editor (Abend 32): Sprachmodi aus den mitgepackten legacy-modes, Farben und Vorschläge über
// Obsidians Laufzeit-Pakete (@codemirror/language, @codemirror/autocomplete, @lezer/highlight; im Build extern).

export interface CodeModules {
  language: typeof LanguageModule;
  autocomplete: typeof AutocompleteModule;
  highlight: typeof HighlightModule;
}
export type CodeLoad = () => CodeModules;

/** Fehlt ein Paket, trägt der Fehler seinen Namen, damit die Warnung sagt, was fehlt. */
function need<T>(name: string, get: () => unknown): T {
  try {
    return get() as T;
  } catch {
    throw new Error(name);
  }
}

/** Die drei Pakete aus Obsidian; wörtliche require-Aufrufe, damit esbuild sie als extern stehen lässt (Wächter im Build-Test). */
export const defaultLoad: CodeLoad = () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Obsidian liefert das Paket erst zur Laufzeit, esbuild lässt nur ein wörtliches require extern
  language: need<typeof LanguageModule>("@codemirror/language", () => require("@codemirror/language")),
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Obsidian liefert das Paket erst zur Laufzeit, esbuild lässt nur ein wörtliches require extern
  autocomplete: need<typeof AutocompleteModule>("@codemirror/autocomplete", () => require("@codemirror/autocomplete")),
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Obsidian liefert das Paket erst zur Laufzeit, esbuild lässt nur ein wörtliches require extern
  highlight: need<typeof HighlightModule>("@lezer/highlight", () => require("@lezer/highlight")),
});

/**
 * Die benutzten Exporte je Paket. Fehlt einer in einem künftigen Obsidian, würfe codeExtensions in render() (Fenster leer) oder
 * consume() in close() (Esc und X schließen nicht mehr). Art: "function", "object" oder "define" (Klasse oder Objekt mit Funktion
 * define: StreamLanguage und HighlightStyle sind Klassen mit statischem define).
 */
const USED: ReadonlyArray<readonly [key: keyof CodeModules, pkg: string, exports: Readonly<Record<string, "function" | "object" | "define">>]> = [
  ["language", "@codemirror/language", { StreamLanguage: "define", HighlightStyle: "define", syntaxHighlighting: "function" }],
  ["autocomplete", "@codemirror/autocomplete", {
    autocompletion: "function", completeAnyWord: "function", completeFromList: "function", completionStatus: "function", closeCompletion: "function",
  }],
  ["highlight", "@lezer/highlight", { tags: "object" }],
];

/** Der erste fehlende Export als "Paket: Name", sonst null. */
function missingExport(m: CodeModules | null | undefined): string | null {
  for (const [key, pkg, exports] of USED) {
    const mod = m?.[key] as unknown as Record<string, unknown> | undefined;
    for (const [name, kind] of Object.entries(exports)) {
      const v = mod?.[name];
      const isObject = (typeof v === "object" || typeof v === "function") && v !== null;
      const ok = kind === "function" ? typeof v === "function"
        : kind === "object" ? typeof v === "object" && v !== null
        : isObject && typeof (v as { define?: unknown }).define === "function";
      if (!ok) return `${pkg}: ${name}`;
    }
  }
  return null;
}

/** Module oder null. Fehlt ein Paket oder ein benutzter Export: genau eine Warnung mit dem Namen, keine Notice; das Fenster bleibt ein Rohtext-Editor. */
export function loadCodeModules(load: CodeLoad = defaultLoad): CodeModules | null {
  try {
    const m = load();
    const missing = missingExport(m);
    if (missing) throw new Error(missing);
    return m;
  } catch (e) {
    console.warn(`Glasscockpit: Datei-Viewer ohne Farben und Vorschläge, Paket oder Export fehlt: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

const MODES: Record<LanguageId, StreamParser<unknown>> = {
  typescript, javascript, json, swift, css, python, yaml, sql: standardSQL, html, shell,
};

/**
 * Farben wie die Codeblöcke im Theme: Tags der legacy-modes auf Obsidians --code-*-Variablen. Obsidians @codemirror/language ist
 * ein Umbau: Seine StreamLanguage vergibt CM5-Klassen (tokenClassNodeProp) statt lezer-Tags, der HighlightStyle findet dort nichts;
 * gefärbt wird über den Zusatz-Export lineHighlighter (Marks `cm-keyword` usw.) und Obsidians globales CSS mit den --code-*-Variablen.
 * Darum beides: HighlightStyle (Upstream-Weg) und, wo vorhanden, lineHighlighter.
 */
function highlighting(m: CodeModules): Extension {
  const t = m.highlight.tags;
  const style = m.language.syntaxHighlighting(m.language.HighlightStyle.define([
    { tag: t.keyword, color: "var(--code-keyword)" },
    { tag: [t.string, t.special(t.string), t.regexp], color: "var(--code-string)" },
    { tag: t.comment, color: "var(--code-comment)" },
    { tag: [t.definition(t.variableName), t.function(t.variableName)], color: "var(--code-function)" },
    { tag: [t.propertyName, t.attributeName], color: "var(--code-property)" },
    { tag: [t.number, t.bool, t.atom, t.null], color: "var(--code-value)" },
    { tag: [t.tagName, t.typeName, t.className], color: "var(--code-tag)" },
    { tag: t.operator, color: "var(--code-operator)" },
    { tag: [t.punctuation, t.bracket], color: "var(--code-punctuation)" },
    { tag: [t.meta, t.standard(t.variableName)], color: "var(--code-important)" },
  ]));
  const lineHighlighter = (m.language as { lineHighlighter?: Extension }).lineHighlighter;
  return lineHighlighter ? [style, lineHighlighter] : style;
}

/**
 * Pro Sprach-Paket (Schlüssel mods.language: defaultLoad baut je Fenster ein neues CodeModules, require liefert aber dasselbe
 * Modul) einmal angelegt: HighlightStyle.define lässt je Aufruf Stilregeln im Dokument zurück, auch nach view.destroy(), und
 * StreamLanguage.define legt je Aufruf einen NodeType im globalen typeArray von @codemirror/language ab. Lazy, erst bei Bedarf.
 */
interface Made {
  colors?: Extension;
  languages: Map<LanguageId, Extension>;
}
const madeFor = new WeakMap<object, Made>();

function cached(m: CodeModules): Made {
  let c = madeFor.get(m.language);
  if (!c) madeFor.set(m.language, c = { languages: new Map() });
  return c;
}

export interface CodeEditorOptions {
  /** Liste öffnet beim Tippen von selbst (Einstellung fileViewerAutocomplete); Ctrl+Leertaste öffnet sie immer. */
  autocomplete: boolean;
}

/** Sprachmodus, Farben und Vorschläge für den Pfad; ohne bekannte Sprache nur Wortvorschläge, ohne Module nichts. */
export function codeExtensions(path: string, opts: CodeEditorOptions, mods: CodeModules | null): Extension[] {
  if (!mods) return [];
  const id = languageForPath(path);
  const { autocompletion, completeAnyWord, completeFromList } = mods.autocomplete;
  const keywords = id ? KEYWORDS[id] : [];
  const known = new Set(keywords);
  // CodeMirror entdoppelt nur bei gleichem type (Datei-Wörter "text", Schlüsselwörter "keyword"): Die Wortquelle lässt die
  // Schlüsselwörter der Sprache weg, das Schlüsselwort bleibt. Synchron, damit sich am Zustand "pending" nichts ändert.
  const words: AutocompleteModule.CompletionSource = known.size === 0 ? completeAnyWord : (ctx) => {
    const r = completeAnyWord(ctx) as AutocompleteModule.CompletionResult | null;
    return r ? { ...r, options: r.options.filter((o) => !known.has(o.label)) } : r;
  };
  const sources: AutocompleteModule.CompletionSource[] = [words];
  if (id) sources.push(completeFromList(keywords.map((label) => ({ label, type: "keyword" }))));
  // autocompletion bringt die Tasten selbst mit (Ctrl+Leertaste, Enter, Pfeile, Esc; defaultKeymap: true).
  const completion = autocompletion({ override: sources, activateOnTyping: opts.autocomplete });
  if (!id) return [completion];
  const c = cached(mods);
  let lang = c.languages.get(id);
  if (!lang) c.languages.set(id, lang = mods.language.StreamLanguage.define(MODES[id]));
  return [lang, c.colors ??= highlighting(mods), completion];
}

/**
 * Esc im Fenster: Ist die Vorschlagsliste offen, schließt Esc nur die Liste, das Fenster bleibt. Ob Obsidian das Esc vor oder nach
 * CodeMirror sieht, ist offen. Deshalb merkt sich ein Capture-Listener am Fenster den Stand, bevor CodeMirror die Liste schließt,
 * und consume() prüft zusätzlich live. Der gemerkte Stand gilt nur für dieses eine Ereignis (setTimeout setzt zurück, kein Microtask:
 * bei echten Tastenereignissen läuft nach jedem Listener ein Microtask-Checkpoint, der Stand muss bis zu Obsidians Listener halten).
 */
export class EscGuard {
  private readonly root: HTMLElement;
  private readonly view: EditorView;
  private readonly mods: CodeModules | null;
  private hadList = false;
  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    this.hadList = this.listOpen();
    setTimeout(() => {
      this.hadList = false;
    }, 0);
  };

  constructor(root: HTMLElement, view: EditorView, mods: CodeModules | null) {
    this.root = root;
    this.view = view;
    this.mods = mods;
    root.addEventListener("keydown", this.onKey, true);
  }

  /** Aus close() des Fensters: true heißt, das Esc galt der Liste; sie ist jetzt zu, das Fenster soll offen bleiben. */
  consume(): boolean {
    const hit = this.hadList || this.listOpen();
    this.hadList = false;
    if (hit && this.mods) this.mods.autocomplete.closeCompletion(this.view);
    return hit;
  }

  detach(): void {
    this.root.removeEventListener("keydown", this.onKey, true);
  }

  /** Nur eine sichtbare Liste zählt; rechnet sie noch (pending), schließt Esc das Fenster wie bisher. */
  private listOpen(): boolean {
    return this.mods !== null && this.mods.autocomplete.completionStatus(this.view.state) === "active";
  }
}
