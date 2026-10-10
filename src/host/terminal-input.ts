import { existsSync } from "node:fs";
import type { Terminal } from "@xterm/xterm";
import { PASTE_DEBOUNCE_MS } from "../core/constants";
import { formatDroppedPaths } from "../core/dropped-paths";
import { parseUriList, pathsFromText } from "../core/drop-sources";
import { keyToSequence } from "../core/keymap";
import { acceptPaste, preparePaste } from "../core/paste";
import { readClipboard, writeClipboard } from "./clipboard";

export interface TerminalInputOptions {
  term: Terminal;
  /** Container der Pane. Listener hängen an seinem Dokument und Fenster (Pop-out). */
  container: HTMLElement;
  /** Gleicher Weg in die Sitzung wie die Tastatureingabe aus xterm (kein zweiter Kanal). */
  write: (data: string) => void;
  /** Vault-Basis für Notizen aus der Dateiliste, null wenn es keine gibt. */
  vaultBase: () => string | null;
}

interface ElectronBits {
  webUtils?: { getPathForFile(file: File): string };
}

/** Electron liegt im Obsidian-Renderer vor; sonst (Test, Mobil) null. */
function electron(): ElectronBits | null {
  try {
    return require("electron") as ElectronBits;
  } catch {
    return null;
  }
}

/**
 * Eingabe der Pane: Mac-Tasten, Cmd+V/C/A, Drag-and-drop.
 * Cmd+V läuft über zwei Wege (Tastenhandler und paste-Ereignis, etwa aus dem Kontextmenü),
 * die Entprellung lässt nur den ersten durch.
 */
export class TerminalInput {
  private readonly opts: TerminalInputOptions;
  /** Listener am aktuellen Dokument des Containers; wandert mit ihm ins Pop-out. */
  private unbindDocument: (() => void) | null = null;
  private lastPasteAt: number | null = null;
  private readonly cleanups: Array<() => void> = [];

  constructor(opts: TerminalInputOptions) {
    this.opts = opts;
    opts.term.attachCustomKeyEventHandler((ev) => this.onKey(ev));

    // xterm hängt sein paste an Textarea UND term.element; stopPropagation am Ziel hilft nicht.
    // Deshalb Capture am gemeinsamen Vorfahren (Pane-Host): Das Ereignis erreicht beide nie.
    const pasteRoot = opts.term.element?.parentElement;
    if (pasteRoot) {
      const onPaste = (ev: ClipboardEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
        void this.paste();
      };
      pasteRoot.addEventListener("paste", onPaste, true);
      this.cleanups.push(() => pasteRoot.removeEventListener("paste", onPaste, true));
    }

    // Drop am Dokument des Containers; bei Fenstermigration (Pop-out) umhängen.
    this.bindDocument();
    this.cleanups.push(
      opts.container.onWindowMigrated(() => {
        this.unbindDocument?.();
        this.bindDocument();
      }),
      () => this.unbindDocument?.(),
    );
  }

  /** Fenster und Dokument immer frisch vom Container lesen, nie festhalten. */
  private get win(): Window & typeof globalThis {
    return this.opts.container.win as Window & typeof globalThis;
  }

  private bindDocument(): void {
    const doc = this.opts.container.doc;
    const onDragOver = (ev: DragEvent) => {
      if (!this.inside(ev)) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
    };
    const onDrop = (ev: DragEvent) => {
      if (!this.inside(ev)) return;
      ev.preventDefault();
      ev.stopPropagation();
      this.drop(ev);
    };
    doc.addEventListener("dragover", onDragOver, true);
    doc.addEventListener("drop", onDrop, true);
    this.unbindDocument = () => {
      doc.removeEventListener("dragover", onDragOver, true);
      doc.removeEventListener("drop", onDrop, true);
      this.unbindDocument = null;
    };
  }

  dispose(): void {
    for (const stop of this.cleanups.splice(0)) stop();
  }

  private inside(ev: Event): boolean {
    // Fensterunabhängig: kein instanceof gegen ein bestimmtes Fenster, nur nodeType.
    const target = ev.target as Node | null;
    return target !== null && typeof target.nodeType === "number" && this.opts.container.contains(target);
  }

  /** true: xterm macht normal weiter. false: erledigt, xterm lässt die Taste in Ruhe. */
  private onKey(ev: KeyboardEvent): boolean {
    if (ev.type !== "keydown") return true;

    const seq = keyToSequence(ev, process.platform);
    if (seq !== null) {
      ev.preventDefault();
      this.opts.write(seq);
      return false;
    }

    // Nur Cmd allein; Option+Zeichen (@ auf der deutschen Tastatur) erledigt schon keyToSequence.
    if (process.platform === "darwin" && ev.metaKey && !ev.altKey && !ev.ctrlKey && !ev.shiftKey) {
      switch (ev.key.toLowerCase()) {
        case "v":
          ev.preventDefault();
          void this.paste();
          return false;
        case "c":
          if (!this.opts.term.hasSelection()) return true;
          ev.preventDefault();
          void this.copy(this.opts.term.getSelection());
          return false;
        case "a":
          ev.preventDefault();
          this.opts.term.selectAll();
          return false;
      }
    }
    return true;
  }

  private async paste(): Promise<void> {
    const now = Date.now();
    if (!acceptPaste(this.lastPasteAt, now, PASTE_DEBOUNCE_MS)) return;
    this.lastPasteAt = now;
    try {
      const text = await readClipboard(this.win);
      const data = preparePaste(text);
      if (data) this.opts.write(data);
    } catch (fehler) {
      console.error("Glasscockpit: Zwischenablage nicht lesbar", fehler);
    }
  }

  private async copy(text: string): Promise<void> {
    try {
      await writeClipboard(this.win, text);
    } catch (fehler) {
      console.error("Glasscockpit: Zwischenablage nicht beschrieben", fehler);
    }
  }

  private drop(ev: DragEvent): void {
    const dt = ev.dataTransfer;
    if (!dt) return;
    const values: Record<string, string> = {};
    for (const type of dt.types) values[type] = dt.getData(type);
    const kurz = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.length > 200 ? `${v.slice(0, 200)}… (${v.length} Zeichen)` : v]));
    console.log("Glasscockpit: Drop dataTransfer.types", Array.from(dt.types), kurz, "files:", dt.files.length);

    const files = Array.from(dt.files);
    const stages: Array<[string, () => string[]]> = [
      ["1 (File.path)", () => files.map((f) => (f as File & { path?: string }).path ?? "").filter(Boolean)],
      [
        "2 (webUtils.getPathForFile)",
        () => {
          const getPath = electron()?.webUtils?.getPathForFile;
          if (!getPath) return [];
          return files
            .map((f) => {
              try {
                return getPath(f);
              } catch {
                return "";
              }
            })
            .filter(Boolean);
        },
      ],
      ["3 (text/uri-list)", () => parseUriList(dt.getData("text/uri-list"))],
      [
        "4 (text/plain)",
        () => {
          const base = this.opts.vaultBase();
          return pathsFromText(dt.getData("text/plain"), base ?? "", (abs) => base !== null && existsSync(abs));
        },
      ],
    ];
    for (const [name, run] of stages) {
      const paths = run();
      if (paths.length === 0) continue;
      console.log(`Glasscockpit: Drop über Stufe ${name}`, paths);
      this.opts.write(formatDroppedPaths(paths));
      return;
    }
    console.warn("Glasscockpit: Drop ohne auflösbaren Pfad");
  }
}
