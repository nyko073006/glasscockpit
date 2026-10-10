export const SCROLLBACK_TEST_LINES = 200;

const ESC = "\x1b";
const CRLF = "\r\n";
const sgr = (code: number) => `${ESC}[${code}m`;
const RESET = sgr(0);

const FARBEN = ["schwarz", "rot", "grün", "gelb", "blau", "magenta", "cyan", "weiß"];

/**
 * Testausgabe für die xterm-Pane: 16 ANSI-Farben (als Text und als Fläche), Attribute,
 * Umlauttest und nummerierte Zeilen für den Scrollback. Zeilenenden \r\n, weil convertEol aus ist.
 */
export function buildTestOutput(): string {
  const zeilen: string[] = [];
  zeilen.push(`${sgr(1)}Glasscockpit: Testausgabe${RESET}`, "");

  for (const [titel, basis] of [
    ["Normal", 30],
    ["Hell  ", 90],
  ] as const) {
    const text = FARBEN.map((name, i) => `${sgr(basis + i)}${name}${RESET}`).join(" ");
    const flaechen = FARBEN.map((_, i) => `${sgr(basis + 10 + i)}    ${RESET}`).join(" ");
    zeilen.push(`${titel} ${text}`, `       ${flaechen}`);
  }

  zeilen.push(
    "",
    `${sgr(1)}fett${RESET}  ${sgr(4)}unterstrichen${RESET}  ${sgr(7)}invertiert${RESET}`,
    "Umlauttest: äöüß € ÄÖÜ",
    "",
  );

  for (let i = 1; i <= SCROLLBACK_TEST_LINES; i++) {
    zeilen.push(`Zeile ${i} von ${SCROLLBACK_TEST_LINES}`);
  }

  return zeilen.join(CRLF) + CRLF;
}
