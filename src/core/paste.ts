const PASTE_START = "\x1b[200~";
const PASTE_ENDE = "\x1b[201~";

/** Text für die PTY aufbereiten: Zeilenenden normalisieren, Endmarker entfernen, Mehrzeiler als Bracketed Paste. */
export function preparePaste(text: string): string {
  if (text === "") return "";
  let sauber = text.replace(/\r\n?/g, "\n");
  // Wiederholen: Entfernen kann aus Resten einen neuen Endmarker zusammensetzen ("ESC[20ESC[201~1~").
  for (let vorher = ""; vorher !== sauber; ) {
    vorher = sauber;
    sauber = sauber.split(PASTE_ENDE).join("");
  }
  return sauber.includes("\n") ? `${PASTE_START}${sauber}${PASTE_ENDE}` : sauber;
}

/** Entprellung: Einfügen nur, wenn das letzte mindestens `windowMs` her ist (oder es noch keins gab). */
export function acceptPaste(lastAt: number | null, now: number, windowMs: number): boolean {
  return lastAt === null || now - lastAt >= windowMs;
}
