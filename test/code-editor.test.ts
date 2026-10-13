// @vitest-environment happy-dom
import * as autocomplete from "@codemirror/autocomplete";
import * as language from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import * as highlight from "@lezer/highlight";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type CodeModules, EscGuard, codeExtensions, loadCodeModules } from "../src/host/code-editor";

// Abend 32: Farben, Vorschläge und Esc im Datei-Viewer mit echtem CodeMirror. Die Module kommen per Import, wie zur Laufzeit
// aus Obsidian; nie per require, das lüde die CJS-Fassung und damit eine zweite Instanz von @codemirror/state.
const MODS: CodeModules = { language, autocomplete, highlight };
const { acceptCompletion, completionStatus, currentCompletions, startCompletion } = autocomplete;

const views: EditorView[] = [];
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
  for (const v of views.splice(0)) {
    v.destroy();
    v.dom.parentElement?.remove();
  }
});

/** Editor im Dokument, Cursor am Ende (nach dem Anlegen gesetzt: mit \r\n weicht die Dokumentlänge von der Stringlänge ab). */
function editor(extensions: Extension[], doc: string): { view: EditorView; root: HTMLElement } {
  const root = document.createElement("div");
  document.body.append(root);
  const view = new EditorView({ parent: root, state: EditorState.create({ doc, extensions }) });
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  views.push(view);
  return { view, root };
}
const code = (path: string, doc: string, autocompleteOn = true, extra: Extension[] = []): EditorView =>
  editor([...extra, ...codeExtensions(path, { autocomplete: autocompleteOn }, MODS)], doc).view;

/** Wartet, bis die Liste offen ist, dazu 100 ms (CodeMirrors interactionDelay von 75 ms sperrt Übernehmen direkt nach dem Öffnen). */
async function offen(view: EditorView, timeout = 1000): Promise<string[]> {
  await vi.waitFor(() => expect(completionStatus(view.state)).toBe("active"), { timeout });
  await new Promise((r) => setTimeout(r, 100));
  return currentCompletions(view.state).map((c) => c.label);
}
const warte = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tippe = (view: EditorView, text: string): void => {
  const at = view.state.selection.main.head;
  view.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length }, userEvent: "input.type" });
};
const taste = (target: Element, key: string, code: string, keyCode: number, ctrlKey = false): void => {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, code, keyCode, ctrlKey, bubbles: true, cancelable: true }));
};

/** Trägt das Wort die Klasse, die der Highlighter für diese Tags vergibt? */
function gefaerbt(state: EditorState, word: string, tags: highlight.Tag[]): boolean {
  const cls = language.highlightingFor(state, tags);
  const tree = language.ensureSyntaxTree(state, state.doc.length, 5000);
  if (!cls || !tree) return false;
  let found = false;
  highlight.highlightTree(tree, { style: (t) => language.highlightingFor(state, t) }, (from, to, classes) => {
    if (state.sliceDoc(from, to) === word && classes.split(" ").includes(cls)) found = true;
  });
  return found;
}

describe("Farben", () => {
  it("Swift: func trägt die Klasse für Schlüsselwörter", () => {
    const view = code("/r/View.swift", "func main() {\n  let x = 1\n}\n");
    expect(gefaerbt(view.state, "func", [highlight.tags.keyword])).toBe(true);
  });

  it.each([
    ["/r/a.ts", "const a: number = 1;"], ["/r/App.tsx", "let a = 1;"], ["/r/a.js", "var a = 1;"], ["/r/p.json", "{\"a\": true}"],
    ["/r/s.css", "a { color: red; }"], ["/r/t.py", "def f():\n    pass\n"], ["/r/c.yml", "a: true\n"], ["/r/q.sql", "select 1;"],
    ["/r/i.html", "<div class=\"x\"></div>"], ["/r/r.sh", "echo hi\n"],
  ])("%s: Sprache gesetzt, Baum über das ganze Dokument", (path, doc) => {
    const view = code(path, doc);
    expect(view.state.facet(language.language)).not.toBeNull();
    expect(language.ensureSyntaxTree(view.state, view.state.doc.length, 5000)?.length).toBe(view.state.doc.length);
  });

  it("Sprache und Farben werden je Sprach-Paket nur einmal angelegt, sonst wächst jedes Fenster um Stilregeln und NodeTypes", () => {
    const a = codeExtensions("/r/a.swift", { autocomplete: true }, MODS);
    const b = codeExtensions("/r/b.swift", { autocomplete: false }, MODS);
    expect(b[0]).toBe(a[0]); // StreamLanguage
    expect(b[1]).toBe(a[1]); // Farben
    const py = codeExtensions("/r/t.py", { autocomplete: true }, MODS);
    expect(py[0]).not.toBe(a[0]); // andere Sprache, eigene Definition
    expect(py[1]).toBe(a[1]); // dieselben Farben
    // Schlüssel ist mods.language, nicht das CodeModules-Objekt (defaultLoad baut je Fenster ein neues).
    const c = codeExtensions("/r/c.swift", { autocomplete: true }, { ...MODS });
    expect(c[0]).toBe(a[0]);
    expect(c[1]).toBe(a[1]);
    // Ein anderes Sprach-Paket bekommt keine fremden Objekte.
    const d = codeExtensions("/r/d.swift", { autocomplete: true }, { ...MODS, language: { ...language } });
    expect(d[0]).not.toBe(a[0]);
    expect(d[1]).not.toBe(a[1]);
  });

  // Obsidian liefert unter @codemirror/language eine umgebaute Fassung: Deren StreamLanguage vergibt CM5-Klassen statt lezer-Tags,
  // gefärbt wird nur über den Zusatz-Export lineHighlighter (Upstream hat ihn nicht). Hier ein Ersatz, der zählt, ob er läuft.
  describe("Obsidians lineHighlighter", () => {
    const made: unknown[] = [];
    const lineHighlighter = ViewPlugin.define((v) => {
      made.push(v);
      return {};
    });
    // Spread-Kopie = eigener Cache-Schlüssel (mods.language), der Upstream-Cache bleibt unberührt.
    // Der zweite Spread ist Absicht: Der Upstream-Typ kennt den Fork-Export nicht, ein Literal mit lineHighlighter meldet tsc als unbekannte Eigenschaft.
    const forkLanguage: typeof language = { ...MODS.language, ...{ lineHighlighter } };
    const FORK: CodeModules = { ...MODS, language: forkLanguage };

    it("mit Fork-Export: das Plugin läuft wirklich im Editor, nicht nur im Array", () => {
      made.length = 0;
      editor(codeExtensions("/r/a.swift", { autocomplete: true }, FORK), "func main() {}\n");
      expect(made.length).toBe(1);
    });

    it("Fork: beides zugleich, HighlightStyle und lineHighlighter", () => {
      made.length = 0;
      const view = editor(codeExtensions("/r/a.swift", { autocomplete: true }, FORK), "func main() {}\n").view;
      expect(gefaerbt(view.state, "func", [highlight.tags.keyword])).toBe(true);
      expect(made.length).toBe(1);
    });

    it("Cache: zwei Aufrufe mit demselben Fork-Paket liefern dieselben Farben (Stelle 1)", () => {
      const a = codeExtensions("/r/a.swift", { autocomplete: true }, FORK);
      const b = codeExtensions("/r/b.py", { autocomplete: false }, { ...FORK });
      expect(b[1]).toBe(a[1]);
    });
  });

  it("unbekannte Endung: keine Sprache, keine Farben", () => {
    const view = code("/r/notes.md", "func main");
    expect(view.state.facet(language.language)).toBeNull();
    expect(language.highlightingFor(view.state, [highlight.tags.keyword])).toBeNull();
  });
});

describe("Vorschläge", () => {
  it("Wörter der Datei: an `al|` steht alpha", async () => {
    const view = code("/r/a.txt", "let alpha = 1\nal");
    startCompletion(view);
    expect(await offen(view)).toContain("alpha");
  });

  it("Swift: zusätzlich Schlüsselwörter (gu → guard, Typ keyword)", async () => {
    const view = code("/r/a.swift", "let alpha = 1\ngu");
    startCompletion(view);
    expect(await offen(view)).toContain("guard");
    expect(currentCompletions(view.state).find((c) => c.label === "guard")?.type).toBe("keyword");
  });

  it("Swift: ein Schlüsselwort, das schon in der Datei steht, erscheint nur einmal (Typ keyword)", async () => {
    // CodeMirror entdoppelt nur bei gleichem type; Datei-Wörter sind "text", Schlüsselwörter "keyword".
    const view = code("/r/a.swift", "return 1\nre");
    startCompletion(view);
    await offen(view);
    const treffer = currentCompletions(view.state).filter((c) => c.label === "return");
    expect(treffer).toHaveLength(1);
    expect(treffer[0].type).toBe("keyword");
  });

  it("Swift: ein Datei-Wort, das kein Schlüsselwort ist, kommt weiter (rest)", async () => {
    const view = code("/r/a.swift", "let rest = 1\nre");
    startCompletion(view);
    const labels = await offen(view);
    expect(labels).toContain("rest");
    expect(labels).toContain("return");
  });

  it("ohne Sprache keine Schlüsselwörter", async () => {
    const view = code("/r/notes.md", "let alpha = 1\ngu");
    startCompletion(view);
    await warte(300);
    expect(currentCompletions(view.state).map((c) => c.label)).not.toContain("guard");
  });

  it("autocomplete an: Tippen öffnet die Liste", async () => {
    const view = code("/r/a.swift", "let alpha = 1\n");
    tippe(view, "al");
    expect(await offen(view)).toContain("alpha");
  });

  it("autocomplete aus: Tippen öffnet nichts, Ctrl+Leertaste schon", async () => {
    const view = code("/r/a.swift", "let alpha = 1\n", false);
    tippe(view, "al");
    await warte(300);
    expect(completionStatus(view.state)).toBeNull();
    taste(view.contentDOM, " ", "Space", 32, true);
    expect(await offen(view)).toContain("alpha");
  });

  it("Enter übernimmt den Vorschlag", async () => {
    const view = code("/r/a.swift", "let alpha = 1\nal");
    startCompletion(view);
    await offen(view);
    taste(view.contentDOM, "Enter", "Enter", 13);
    expect(view.state.doc.toString()).toBe("let alpha = 1\nalpha");
  });

  it("CRLF-Datei: übernommener Vorschlag lässt \\r\\n stehen", async () => {
    const view = code("/r/a.swift", "let alpha = 1\r\nal", true, [EditorState.lineSeparator.of("\r\n")]);
    startCompletion(view);
    await offen(view);
    expect(acceptCompletion(view)).toBe(true);
    expect(view.state.sliceDoc()).toBe("let alpha = 1\r\nalpha");
  });

  it("2-MB-Datei (Höchstgröße): Liste kommt in unter 2 s", async () => {
    const zeile = "const alphaValue = betaValue + gammaValue; // Kommentar\n";
    const doc = `${zeile.repeat(Math.ceil((2 * 1024 * 1024) / zeile.length))}alp`;
    const t0 = performance.now();
    const view = code("/r/big.ts", doc);
    startCompletion(view);
    expect(await offen(view, 2000)).toContain("alphaValue");
    expect(performance.now() - t0).toBeLessThan(2000 + 100);
  });
});

describe("Laden", () => {
  it("Paket fehlt: null, genau eine Warnung mit dem Namen, keine Erweiterungen", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(loadCodeModules(() => { throw new Error("@codemirror/autocomplete"); })).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("@codemirror/autocomplete");
      expect(codeExtensions("/r/a.swift", { autocomplete: true }, null)).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  // Ein künftiges Obsidian könnte einen benutzten Export weglassen; ohne Prüfung würfe codeExtensions in render() (Fenster leer)
  // oder consume() in close() (Esc und X schließen nicht mehr). Gleiches Verhalten wie bei fehlendem Paket, egal welcher Lader.
  const ohne = (key: keyof CodeModules, name: string, wert: unknown = undefined): CodeModules =>
    ({ ...MODS, [key]: { ...MODS[key], [name]: wert } }) as unknown as CodeModules;

  it.each([
    ["@codemirror/language", "StreamLanguage", "language"],
    ["@codemirror/language", "HighlightStyle", "language"],
    ["@codemirror/language", "syntaxHighlighting", "language"],
    ["@codemirror/autocomplete", "autocompletion", "autocomplete"],
    ["@codemirror/autocomplete", "completeAnyWord", "autocomplete"],
    ["@codemirror/autocomplete", "completeFromList", "autocomplete"],
    ["@codemirror/autocomplete", "completionStatus", "autocomplete"],
    ["@codemirror/autocomplete", "closeCompletion", "autocomplete"],
    ["@lezer/highlight", "tags", "highlight"],
  ] as const)("Export fehlt (%s: %s): null, genau eine Warnung mit Paket und Export", (pkg, name, key) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(loadCodeModules(() => ohne(key, name))).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain(`${pkg}: ${name}`);
    } finally {
      warn.mockRestore();
    }
  });

  it("StreamLanguage ohne define zählt als fehlend", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(loadCodeModules(() => ohne("language", "StreamLanguage", {}))).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("StreamLanguage");
    } finally {
      warn.mockRestore();
    }
  });

  it("geladene Module kommen unverändert durch", () => {
    expect(loadCodeModules(() => MODS)).toBe(MODS);
  });
});

describe("Esc im Fenster (EscGuard)", () => {
  // Obsidian ruft bei Esc close() des Fensters. Ob es das Ereignis vor CodeMirror sieht (Capture am Dokument) oder danach (Bubble),
  // ist nicht gemessen; beide Reihenfolgen müssen dasselbe ergeben. close() unten ist das von FileViewerModal im Kleinen.
  // Achtung: taste() sendet per dispatchEvent. Bei echten Tasten läuft nach jedem Listener ein Microtask-Checkpoint, hier nicht;
  // die Reihenfolge-Tests bilden ihn zwischen den Listenern nicht nach. Das tut der Test "Stand hält über einen Microtask-Checkpoint".
  for (const obsidianZuerst of [true, false]) {
    describe(obsidianZuerst ? "Obsidian vor CodeMirror" : "CodeMirror vor Obsidian", () => {
      function fenster(extensions: Extension[], doc: string, mods: CodeModules | null = MODS) {
        const { view, root } = editor(extensions, doc);
        const guard = new EscGuard(root, view, mods);
        let zu = 0;
        const close = (): void => {
          if (guard.consume()) return;
          zu++;
        };
        const obsidian = (e: KeyboardEvent): void => {
          if (e.key === "Escape") close();
        };
        document.addEventListener("keydown", obsidian, obsidianZuerst);
        cleanups.push(() => {
          document.removeEventListener("keydown", obsidian, obsidianZuerst);
          guard.detach();
        });
        return { view, geschlossen: () => zu };
      }
      const esc = (view: EditorView): void => taste(view.contentDOM, "Escape", "Escape", 27);

      it("offene Liste: erstes Esc schließt nur die Liste, zweites das Fenster", async () => {
        const f = fenster(codeExtensions("/r/a.swift", { autocomplete: true }, MODS), "let alpha = 1\nal");
        startCompletion(f.view);
        await offen(f.view);
        esc(f.view);
        expect(completionStatus(f.view.state)).toBeNull();
        expect(f.geschlossen()).toBe(0);
        await Promise.resolve();
        esc(f.view);
        expect(f.geschlossen()).toBe(1);
      });

      it("ohne Liste schließt Esc das Fenster", () => {
        const f = fenster(codeExtensions("/r/a.swift", { autocomplete: true }, MODS), "let alpha = 1\n");
        esc(f.view);
        expect(f.geschlossen()).toBe(1);
      });

      it("Liste rechnet noch (pending, nichts sichtbar): Esc schließt das Fenster", () => {
        const f = fenster([autocomplete.autocompletion({ override: [() => new Promise(() => {})] })], "al");
        startCompletion(f.view);
        expect(completionStatus(f.view.state)).toBe("pending");
        esc(f.view);
        expect(f.geschlossen()).toBe(1);
      });

      it("Module fehlen (null): Esc schließt direkt", () => {
        const f = fenster([], "let alpha = 1\n", null);
        esc(f.view);
        expect(f.geschlossen()).toBe(1);
      });
    });
  }

  it("Stand hält über einen Microtask-Checkpoint (wie zwischen zwei Listenern bei echten Tasten)", async () => {
    const { view, root } = editor(codeExtensions("/r/a.swift", { autocomplete: true }, MODS), "let alpha = 1\nal");
    const guard = new EscGuard(root, view, MODS);
    cleanups.push(() => guard.detach());
    startCompletion(view);
    await offen(view);
    taste(view.contentDOM, "Escape", "Escape", 27);
    expect(completionStatus(view.state)).toBeNull(); // CodeMirror hat die Liste selbst geschlossen
    await Promise.resolve(); // Checkpoint, wie ihn der Browser nach jedem Listener fährt
    expect(guard.consume()).toBe(true);
  });

  it("der gemerkte Stand gilt nur für dieses eine Esc: nach dem Tick ist er weg", async () => {
    // Sonst schluckte ein späteres Esc ohne Liste (zweites Esc, anderes Ereignis) das Schließen des Fensters.
    const { view, root } = editor(codeExtensions("/r/a.swift", { autocomplete: true }, MODS), "let alpha = 1\nal");
    const guard = new EscGuard(root, view, MODS);
    cleanups.push(() => guard.detach());
    startCompletion(view);
    await offen(view);
    taste(view.contentDOM, "Escape", "Escape", 27); // CodeMirror schließt die Liste selbst, kein consume()
    expect(completionStatus(view.state)).toBeNull();
    await warte(10); // der setTimeout-Reset ist gelaufen
    expect(guard.consume()).toBe(false);
  });

  it("detach nimmt den Listener ab", async () => {
    const { view, root } = editor(codeExtensions("/r/a.swift", { autocomplete: true }, MODS), "let alpha = 1\nal");
    const guard = new EscGuard(root, view, MODS);
    guard.detach();
    startCompletion(view);
    await offen(view);
    // CodeMirror schließt die Liste selbst; ohne Listener hat der Wächter den Stand vorher nicht gesehen.
    taste(view.contentDOM, "Escape", "Escape", 27);
    expect(guard.consume()).toBe(false);
  });
});
