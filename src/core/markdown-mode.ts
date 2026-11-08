// Markdown-Modus für den Datei-Viewer (Nachtrag 43b): färbt Text, Code, Befehle, Überschriften, Links, Marker und Frontmatter.
// Rein, ohne View; Farben und Einbindung hängt src/host/code-editor.ts an. Jeder Aufruf von token() verbraucht mindestens ein Zeichen.
import type { StreamParser } from "@codemirror/language";

export const MD_PARTS = ["text", "code", "command", "heading", "link", "marker", "frontmatter"] as const;
export type MdPart = (typeof MD_PARTS)[number];

export const MD_TOKEN: Record<MdPart | "strong" | "em", string> = {
  text: "cockpit-md-text", code: "cockpit-md-code", command: "cockpit-md-command", heading: "cockpit-md-heading",
  link: "cockpit-md-link", marker: "cockpit-md-marker", frontmatter: "cockpit-md-frontmatter",
  strong: "cockpit-md-strong", em: "cockpit-md-em",
};

export interface MdState {
  line: number;
  front: boolean;
  fence: { char: "`" | "~"; len: number; kind: "code" | "command" } | null;
}

const SHELL_LANGS = new Set(["bash", "sh", "zsh", "shell", "console", "terminal"]);
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})\s*([\w+-]*)/;
const HEADING = /^ {0,3}#{1,6}(\s|$)/;
const RULE = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s*(>\s?)+/;
const LIST = /^\s*([-*+]|\d{1,9}[.)])\s+/;
const TASK = /^\[[ xX]\]\s/;
const URL_AT = /https?:\/\/[^\s)>]+/y;
const MD_LINK_AT = /\[[^\]]*\]\([^)]*\)/y;

/** Leerraum-getrennte Befehlsliste als Menge, leere Teile weg. */
export function parseCommands(list: string): ReadonlySet<string> {
  return new Set(list.split(/\s+/).filter((w) => w.length > 0));
}

/** Inline-Code als Befehl (beginnt mit "$ " oder "./" oder erstes Wort ist ein bekannter Befehl) oder als Code. */
export function inlineKind(content: string, commands: ReadonlySet<string>): "code" | "command" {
  const t = content.trim();
  if (t.startsWith("$ ") || t.startsWith("./")) return "command";
  const first = t.split(/\s/)[0];
  return commands.has(first) ? "command" : "code";
}

/** Ende der Marker-Abschnitte am Zeilenanfang (Zitat, Listenmarker, Aufgabenkästchen), aufsteigend. */
function prefixEnds(line: string): number[] {
  const ends: number[] = [];
  let pos = 0;
  const quote = QUOTE.exec(line);
  if (quote) { pos = quote[0].length; ends.push(pos); }
  const list = LIST.exec(line.slice(pos));
  if (list) {
    pos += list[0].length;
    ends.push(pos);
    const task = TASK.exec(line.slice(pos));
    if (task) ends.push(pos + task[0].length);
  }
  return ends;
}

/** Stellen, an denen ein Text-Lauf endet, weil dort etwas Besonderes beginnen kann. */
function isSpecial(s: string, i: number): boolean {
  const c = s[i];
  if (c === "`" || c === "[" || c === "*" || c === "|") return true;
  if (c === "h") { URL_AT.lastIndex = i; return URL_AT.test(s); }
  return false;
}

const WORD_CHAR = /[\p{L}\p{N}]/u;
const isWordChar = (c: string | undefined): boolean => c !== undefined && WORD_CHAR.test(c);

function closingEm(s: string, pos: number): number {
  for (let j = pos + 2; j < s.length; j++) {
    const after = s[j + 1];
    // Glob-Sterne (src/*.md, a*b*c) sind kein Kursiv: Schluss-Stern nicht vor "/", "." + Wortzeichen oder Wortzeichen (Satzende-Punkt bleibt erlaubt).
    if (s[j] === "*" && s[j - 1] !== " " && s[j - 1] !== "*" && after !== "*" && after !== "/" && !(after === "." && isWordChar(s[j + 2])) && !isWordChar(after)) return j;
  }
  return -1;
}

export function markdownParser(commands: ReadonlySet<string>): StreamParser<MdState> {
  return {
    name: "markdown",
    startState: () => ({ line: 0, front: false, fence: null }),
    // Leere Zeilen ruft CodeMirror nicht über token() auf, sie zählen trotzdem als Zeile.
    blankLine(state) { state.line++; },
    token(stream, state) {
      const s = stream.string;
      if (stream.sol()) {
        state.line++;
        if (state.line === 1 && s === "---") { state.front = true; stream.skipToEnd(); return MD_TOKEN.frontmatter; }
        if (state.front) {
          if (s === "---" || s === "...") state.front = false;
          stream.skipToEnd();
          return MD_TOKEN.frontmatter;
        }
        if (state.fence) {
          const f = state.fence;
          const close = new RegExp(`^ {0,3}${f.char}{${f.len},}\\s*$`);
          if (close.test(s)) state.fence = null;
          stream.skipToEnd();
          return MD_TOKEN[f.kind];
        }
        const open = FENCE_OPEN.exec(s);
        if (open) {
          const kind = SHELL_LANGS.has(open[2].toLowerCase()) ? "command" : "code";
          state.fence = { char: open[1][0] as "`" | "~", len: open[1].length, kind };
          stream.skipToEnd();
          return MD_TOKEN[kind];
        }
        if (HEADING.test(s)) { stream.skipToEnd(); return MD_TOKEN.heading; }
        if (RULE.test(s)) { stream.skipToEnd(); return MD_TOKEN.marker; }
      }

      // Marker am Zeilenanfang: Abschnitt für Abschnitt, bis das Ende des letzten erreicht ist.
      const next = prefixEnds(s).find((e) => e > stream.pos);
      if (next !== undefined) {
        stream.pos = next;
        return MD_TOKEN.marker;
      }

      const pos = stream.pos;
      const c = s[pos];
      if (c === "`") {
        let n = 0;
        while (s[pos + n] === "`") n++;
        let i = pos + n;
        while (i < s.length) {
          if (s[i] !== "`") { i++; continue; }
          let m = 0;
          while (s[i + m] === "`") m++;
          if (m === n) {
            stream.pos = i + m;
            return MD_TOKEN[inlineKind(s.slice(pos + n, i), commands)];
          }
          i += m;
        }
        stream.pos = pos + n;
        return MD_TOKEN.text;
      }
      if (c === "[") {
        if (s.startsWith("[[", pos)) {
          const end = s.indexOf("]]", pos + 2);
          if (end >= 0) { stream.pos = end + 2; return MD_TOKEN.link; }
        }
        MD_LINK_AT.lastIndex = pos;
        const m = MD_LINK_AT.exec(s);
        if (m) { stream.pos = pos + m[0].length; return MD_TOKEN.link; }
      }
      if (c === "h") {
        URL_AT.lastIndex = pos;
        const m = URL_AT.exec(s);
        if (m) { stream.pos = pos + m[0].length; return MD_TOKEN.link; }
      }
      if (c === "*") {
        if (s[pos + 1] === "*") {
          const end = s.indexOf("**", pos + 2);
          if (end > pos + 2) { stream.pos = end + 2; return `${MD_TOKEN.text} ${MD_TOKEN.strong}`; }
          let n = 0;
          while (s[pos + n] === "*") n++;
          stream.pos = pos + n;
          return MD_TOKEN.text;
        }
        const before = s[pos - 1];
        if (pos + 1 < s.length && s[pos + 1] !== " " && before !== "/" && !isWordChar(before)) {
          const end = closingEm(s, pos);
          if (end > pos + 1) { stream.pos = end + 1; return `${MD_TOKEN.text} ${MD_TOKEN.em}`; }
        }
      }
      if (c === "|") { stream.pos = pos + 1; return MD_TOKEN.marker; }

      // Text-Lauf bis zur nächsten Stelle, an der etwas Besonderes beginnen kann (mindestens ein Zeichen).
      let i = pos + 1;
      while (i < s.length && !isSpecial(s, i)) i++;
      stream.pos = i;
      return MD_TOKEN.text;
    },
  };
}
