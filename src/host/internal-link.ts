import { type App, Notice } from "obsidian";

// Interne Links im Dashboard öffnen, gemeinsam für Briefing und Aufgaben (Abend 30).

/** Die Taste, die bei auxclick öffnet: die mittlere. auxclick kommt auch für die rechte (2), die gehört dem Kontextmenü. */
const MIDDLE_BUTTON = 1;

export interface InternalLinkOptions {
  /** Ziel des Links, auf den das Ereignis zielt; null = kein interner Link, das Ereignis bleibt unangetastet. */
  ziel: (e: MouseEvent) => string | null;
  /** Datei, in der der Link steht (Obsidian löst das Ziel relativ dazu auf); gelesen beim Klick. */
  quelle: () => string;
  /** Ereignis nicht an Vorfahren weitergeben: In der Aufgabenzeile schaltet ein Link sonst die Aufgabe um. */
  stopPropagation?: boolean;
}

/**
 * Klick und Mittelklick (auxclick mit Taste 1) auf einen internen Link öffnen das Ziel in einem neuen Tab, damit das
 * Dashboard stehen bleibt. Beide verhindern den Standard: Ob Electron einen Mittelklick auf ein `<a>` sonst selbst öffnet,
 * ist nicht gemessen.
 */
export function handleInternalLinks(app: App, el: HTMLElement, opts: InternalLinkOptions): void {
  const handler = (e: MouseEvent): void => {
    if (e.type === "auxclick" && e.button !== MIDDLE_BUTTON) return;
    const ziel = opts.ziel(e);
    if (ziel === null) return;
    if (opts.stopPropagation) e.stopPropagation();
    e.preventDefault();
    void openInternalLink(app, ziel, opts.quelle());
  };
  el.addEventListener("click", handler);
  el.addEventListener("auxclick", handler);
}

/** Öffnet per openLinkText in einem neuen Tab (ohne Ziel-Pane ersetzt es das Dashboard). Ein Fehler wird zur Notice mit Ziel und Grund. */
async function openInternalLink(app: App, ziel: string, quelle: string): Promise<void> {
  try {
    await app.workspace.openLinkText(ziel, quelle, "tab");
  } catch (fehler) {
    new Notice(`Link lässt sich nicht öffnen: ${ziel} (${fehler instanceof Error ? fehler.message : String(fehler)})`);
  }
}
