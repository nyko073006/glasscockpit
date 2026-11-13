import { type HandoffCheck, clearNeedsConfirm } from "../core/handoff-check";

// Nachtrag 43j: Rückfrage beim Klick auf /clear. Nur der Link ruft das, getipptes /clear kann das Cockpit nicht abfangen.
// Der Check hilft, er sperrt nicht: Scheitert er, wird ohne Rückfrage eingefügt.

export interface ClearGuardDeps {
  /** Einstellung checkBeforeClear, bei jedem Klick frisch. */
  enabled: () => boolean;
  /** Check der eigenen Sitzung; null bei Shell oder unbekannter Sitzung. */
  check: () => Promise<HandoffCheck | null>;
  /** Rückfrage mit den Lücken; onYes fügt ein. */
  confirm: (gaps: string[], onYes: () => void) => void;
  insert: () => void;
  log: (m: string) => void;
}

/** Laufzustand je View: ein zweiter Klick, solange einer läuft, wird verworfen. */
export interface ClearGuardState { busy: boolean }

export async function guardedClearInsert(d: ClearGuardDeps, state: ClearGuardState = { busy: false }): Promise<void> {
  if (!d.enabled()) { d.insert(); return; }
  if (state.busy) return;
  state.busy = true;
  try {
    let check: HandoffCheck | null;
    try {
      check = await d.check();
    } catch (e) {
      d.log(`Übergabe-Check vor /clear gescheitert: ${e instanceof Error ? e.message : String(e)}`);
      d.insert();
      return;
    }
    const gaps = clearNeedsConfirm(check, true);
    if (gaps === null) d.insert();
    else d.confirm(gaps, d.insert);
  } finally {
    state.busy = false;
  }
}
