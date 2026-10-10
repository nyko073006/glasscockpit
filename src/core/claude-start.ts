// Startentscheidung für eine Claude-Sitzung (Abend 11), rein: Transkript-Prüfung und neue UUID kommen von außen.
// Gemessen: `claude --session-id <id>` mit vorhandenem Transkript bricht ab („already in use“), deshalb gibt es
// nur diese drei Wege: fortsetzen (--resume), frisch mit derselben ID (kein Transkript) oder frisch mit neuer ID.

/** new = gerade angelegt, restore = Tab nach Neuladen, restart = „Neu starten“ / „Sitzung frisch starten“. */
export type StartKind = "new" | "restore" | "restart";

export interface StartInput {
  /** Aktuelle Claude-ID des Eintrags. */
  claudeId: string;
  transcriptExists: boolean;
  resumeConversations: boolean;
  /** Erzwungen frisch, unabhängig von der Einstellung. */
  fresh: boolean;
  startKind: StartKind;
  /** Neue UUID, nur aufgerufen, wenn wirklich eine gebraucht wird. */
  newId: () => string;
}

export interface StartPlan {
  /** ID für --resume bzw. --session-id. */
  claudeId: string;
  resume: boolean;
  /** Neue Claude-ID, die im Eintrag gespeichert werden muss; sonst null. */
  adoptId: string | null;
  /** Graue Zeile für die Pane vor der Claude-Ausgabe; sonst null. */
  notice: string | null;
}

export function planClaudeStart(i: StartInput): StartPlan {
  if (i.transcriptExists) {
    if (i.resumeConversations && !i.fresh) return { claudeId: i.claudeId, resume: true, adoptId: null, notice: null };
    const fresh = i.newId();
    return {
      claudeId: fresh, resume: false, adoptId: fresh,
      notice: `Neue Unterhaltung, die alte bleibt unter ${i.claudeId.slice(0, 8)} erhalten.`,
    };
  }
  return {
    claudeId: i.claudeId, resume: false, adoptId: null,
    notice: i.startKind === "new" ? null : "Keine gespeicherte Unterhaltung gefunden, Claude startet frisch.",
  };
}
