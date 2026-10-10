const NAME = /^(\d{4})-(\d{2})-(\d{2})\.md$/;

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Dateiname einer Tagesdatei: nur JJJJ-MM-TT.md mit echtem Kalenderdatum; gibt das Datum oder null. */
export function parseBriefingName(name: string): string | null {
  const m = NAME.exec(name);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Gültige Tage aus Dateinamen, neuester zuerst, ohne Duplikate. */
export function listBriefings(names: string[]): string[] {
  const days = new Set<string>();
  for (const name of names) {
    const day = parseBriefingName(name);
    if (day !== null) days.add(day);
  }
  // JJJJ-MM-TT sortiert als Text wie nach Datum.
  return [...days].sort().reverse();
}

/** Direktes Kind des Ordners (vault-relativ, ohne Schrägstriche außen), kein Unterordner, kein Namensvetter. */
export function isInBriefingsDir(path: string, dir: string): boolean {
  const prefix = `${dir}/`;
  if (!path.startsWith(prefix)) return false;
  const rest = path.slice(prefix.length);
  return rest !== "" && !rest.includes("/");
}

/** Auswahl nach dem Neuladen: folgt der Neuesten, wenn sie die Neueste war oder fehlt; sonst bleibt sie. */
export function pickSelection(list: string[], current: string | null, followNewest: boolean): string | null {
  if (list.length === 0) return null;
  if (followNewest || current === null || !list.includes(current)) return list[0];
  return current;
}

/** Ersetzt jedes {ordner}; Funktion statt Text, damit $ im Ordnernamen wörtlich bleibt. */
export function fillPrompt(template: string, dir: string): string {
  return template.replace(/\{ordner\}/g, () => dir);
}
