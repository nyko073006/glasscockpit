import type { ILinkProvider } from "@xterm/xterm";
import { type PressGuard, touchesRow } from "../core/link-guard";

// Abend 37: Hülle um jeden Link-Provider des Terminals (TerminalPane.registerLinkProvider). Gründe in core/link-guard.ts.

/**
 * Nur Links der abgefragten Zeile durchlassen und activate hinter den Druckwächter schalten. activate wird am selben Objekt
 * ersetzt, nicht kopiert: xterm hält das Objekt und ersetzt dessen decorations (der FileLinkProvider setzt sie daran).
 */
export function guardLinkProvider(provider: ILinkProvider, pressed: () => boolean): ILinkProvider {
  return {
    provideLinks: (y, callback) =>
      provider.provideLinks(y, (links) => {
        const kept = (links ?? []).filter((link) => touchesRow(link.range, y));
        for (const link of kept) {
          const activate = link.activate.bind(link);
          link.activate = (event, text) => {
            if (pressed()) activate(event, text);
          };
        }
        callback(kept.length > 0 ? kept : undefined);
      }),
  };
}

/**
 * Drücke im Terminal verfolgen. mousedown im Element (Capture, vor xterm) startet einen Druck; im Fenster des Elements beendet
 * ihn der nächste mousedown sofort (auch ein Druck außerhalb, und wenn ein Kontextmenü das mouseup schluckte) und der nächste
 * mouseup erst nach dem Ereignis (setTimeout 0), weil xterm activate im selben mouseup aufruft. Das Fenster wird je Druck
 * gelesen (Pop-out). Gibt die Abmeldung zurück.
 */
export function trackPresses(el: HTMLElement, guard: PressGuard): () => void {
  const onDown = (): void => {
    const win = el.ownerDocument.defaultView;
    if (!win) return; // ohne Fenster gäbe es kein Ende: erst gar nicht starten
    const id = guard.press();
    const end = (): void => guard.end(id);
    win.addEventListener("mousedown", end, { capture: true, once: true });
    win.addEventListener("mouseup", () => win.setTimeout(end, 0), { capture: true, once: true });
  };
  el.addEventListener("mousedown", onDown, true);
  return () => el.removeEventListener("mousedown", onDown, true);
}
