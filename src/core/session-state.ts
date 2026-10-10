/** sessionId aus dem View-State, sonst null. Leere Texte zählen nicht. */
export function readSessionId(state: unknown): string | null {
  if (typeof state !== "object" || state === null) return null;
  const id = (state as { sessionId?: unknown }).sessionId;
  return typeof id === "string" && id.trim() !== "" ? id : null;
}
