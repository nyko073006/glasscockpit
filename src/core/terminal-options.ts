/** Einstellungen, die xterm direkt betreffen und live wirken (Schrift, Scrollback, Mindestkontrast). */
export interface TerminalOptions { fontSize: number; scrollback: number; minimumContrast: number }
export interface XtermOptions { fontSize: number; scrollback: number; minimumContrastRatio: number }

/** Die xterm-Optionen beim Erzeugen. */
export function xtermOptions(o: TerminalOptions): XtermOptions {
  return { fontSize: o.fontSize, scrollback: o.scrollback, minimumContrastRatio: o.minimumContrast };
}

/** Nur was sich gegenüber dem laufenden Terminal ändert; leer = nichts zu tun. */
export function changedXtermOptions(current: Partial<XtermOptions>, o: TerminalOptions): Partial<XtermOptions> {
  const next = xtermOptions(o);
  const out: Partial<XtermOptions> = {};
  if (current.fontSize !== next.fontSize) out.fontSize = next.fontSize;
  if (current.scrollback !== next.scrollback) out.scrollback = next.scrollback;
  if (current.minimumContrastRatio !== next.minimumContrastRatio) out.minimumContrastRatio = next.minimumContrastRatio;
  return out;
}
