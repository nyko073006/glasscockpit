// Befehlszeile für einen .cmd-Shim (npm legt claude.cmd an) über cmd.exe (Abend 41). Ein Shim liest seine Argumente neu,
// deshalb doppeltes Escaping der Metazeichen. Das Verfahren folgt cross-spawn (MIT, lib/util/escape.js), selbst
// nachgeschrieben; Vermerk in THIRD-PARTY-NOTICES.md. Rein: kein Dateisystem, keine Plattformabfrage.

/** Längste Befehlszeile, die cmd.exe verarbeitet (Zeichen, inklusive Programmname und Leerzeichen). */
export const CMD_LINE_LIMIT = 8191;

/** Zeichen, die cmd.exe auswertet (Metazeichen); mit ^ davor verlieren sie ihre Bedeutung. */
const META_CHARS = /([()\][%!^"`<>&|;, *?])/g;

/**
 * Ein Argument für einen .cmd-Shim: Zeilenumbrüche werden zu einem Leerzeichen (cmd.exe kann sie nicht übergeben),
 * Backslashes vor `"` und am Ende verdoppelt, `"` zu `\"`, das Ganze in `"` gesetzt, dann die Metazeichen zweimal mit ^ geschützt
 * (einmal für cmd.exe, einmal für die Neulesung durch den Shim).
 */
export function escapeCmdArgument(arg: string): string {
  let text = arg.replace(/\r\n|\n|\r/g, " ");
  text = text.replace(/(\\*)"/g, '$1$1\\"');
  text = text.replace(/(\\*)$/, "$1$1");
  text = `"${text}"`;
  return text.replace(META_CHARS, "^$1").replace(META_CHARS, "^$1");
}

/** Der Shim-Pfad als Befehl: Metazeichen einmal mit ^, ohne Anführungszeichen. */
export function escapeCmdCommand(shim: string): string {
  return shim.replace(META_CHARS, "^$1");
}

/** Argumentzeile für `cmd.exe`: /d /s /c "<befehl> <arg> …". node-pty nimmt unter Windows diesen String als Befehlszeile. */
export function cmdShimCommandLine(shim: string, args: readonly string[]): string {
  return `/d /s /c "${[escapeCmdCommand(shim), ...args.map(escapeCmdArgument)].join(" ")}"`;
}
