/** Abgelegte Pfade als @-Erwähnungen für den Claude-Prompt, mit Leerzeichen am Ende. */
export function formatDroppedPaths(paths: string[]): string {
  return paths
    .map((pfad) => (/[ \\]/.test(pfad) ? `@"${pfad}" ` : `@${pfad} `))
    .join("");
}
