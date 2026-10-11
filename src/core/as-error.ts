/** Macht aus jedem Ablehnungsgrund einen Error (ein Error bleibt dasselbe Objekt), damit Promise-Ablehnungen immer einen tragen. */
export function asError(x: unknown): Error {
  return x instanceof Error ? x : new Error(String(x));
}
