// Antworten aus dem Claude-Code-Transkript (JSONL) und ihre Codeblöcke: die letzte Antwort, der letzte Handoff-Block. Reine Logik.

export interface CodeBlock {
  lang: string;
  code: string;
}

interface Eintrag {
  type?: unknown;
  isSidechain?: unknown;
  message?: { id?: unknown; content?: unknown };
}

/** Text-Blöcke eines Eintrags; null, wenn er keine Haupt-Assistant-Antwort mit Text ist. */
function textBloecke(e: Eintrag): string[] | null {
  if (e.type !== "assistant" || e.isSidechain === true) return null;
  const content: unknown = e.message?.content;
  if (!Array.isArray(content)) return null;
  const texte: string[] = [];
  for (const b of content as unknown[]) {
    if (typeof b !== "object" || b === null) continue;
    const { type, text } = b as { type?: unknown; text?: unknown };
    if (type === "text" && typeof text === "string") texte.push(text);
  }
  return texte.length > 0 ? texte : null;
}

/** Die Zeilen des Transkripts als Einträge. Eine halbe Zeile am Dateianfang oder Müll wird übersprungen. */
function leseEintraege(jsonl: string): Eintrag[] {
  const eintraege: Eintrag[] = [];
  for (const zeile of jsonl.split("\n")) {
    if (zeile.trim() === "") continue;
    try {
      const e: unknown = JSON.parse(zeile);
      if (e && typeof e === "object") eintraege.push(e);
    } catch {
      // Halbe Zeile am Dateianfang oder Müll: überspringen.
    }
  }
  return eintraege;
}

/**
 * Text jeder Haupt-Antwort (alle Zeilen mit derselben message.id, durch Leerzeile verbunden), die älteste zuerst.
 * Die Reihenfolge richtet sich nach der letzten Textzeile einer Antwort; die letzte Antwort ist damit die der Leiste.
 */
function antwortTexte(eintraege: Eintrag[]): string[] {
  const antworten = new Map<unknown, string[]>();
  for (const e of eintraege) {
    const t = textBloecke(e);
    if (!t) continue;
    const id = e.message?.id;
    const bisher = antworten.get(id);
    // Ans Ende der Reihenfolge: Eine Antwort zählt ab ihrer letzten Textzeile.
    antworten.delete(id);
    antworten.set(id, bisher ? [...bisher, ...t] : t);
  }
  return [...antworten.values()].map((teile) => teile.join("\n\n"));
}

/** Text der letzten Antwort (alle Zeilen mit derselben message.id), sonst null. */
export function lastAnswerText(jsonl: string): string | null {
  const antworten = antwortTexte(leseEintraege(jsonl));
  return antworten.length > 0 ? antworten[antworten.length - 1] : null;
}

const OEFFNER = /^( {0,3})(`{3,}|~{3,})(.*)$/;

/** Fenced Code Blocks nach CommonMark, in Textreihenfolge. */
export function extractCodeBlocks(markdown: string): CodeBlock[] {
  const zeilen = markdown.split(/\r\n|\n|\r/);
  const bloecke: CodeBlock[] = [];
  let i = 0;
  while (i < zeilen.length) {
    const m = OEFFNER.exec(zeilen[i]);
    // Beim Backtick-Zaun darf der Info-String keine Backticks enthalten (sonst Inline-Code).
    if (!m || (m[2][0] === "`" && m[3].includes("`"))) {
      i++;
      continue;
    }
    const einzug = m[1].length;
    const zeichen = m[2][0];
    const laenge = m[2].length;
    const lang = m[3].trim().split(/\s+/)[0] ?? "";
    const schliesser = new RegExp(`^ {0,3}${zeichen === "`" ? "`" : "~"}{${laenge},}[ \\t]*$`);
    const inhalt: string[] = [];
    i++;
    let geschlossen = false;
    while (i < zeilen.length) {
      if (schliesser.test(zeilen[i])) {
        geschlossen = true;
        i++;
        break;
      }
      inhalt.push(zeilen[i].replace(new RegExp(`^ {0,${einzug}}`), ""));
      i++;
    }
    // Offener Block am Textende: das Zeilenende der letzten Zeile ist kein Inhalt.
    if (!geschlossen && inhalt.length > 0 && inhalt[inhalt.length - 1] === "") inhalt.pop();
    bloecke.push({ lang, code: inhalt.join("\n") });
  }
  return bloecke;
}

/** Beginnt die erste nichtleere Zeile des Codes (führende Leerzeichen ignoriert) mit prefix? */
function beginntMit(code: string, prefix: string): boolean {
  const erste = code.split("\n").find((z) => z.trim() !== "");
  return erste !== undefined && erste.trimStart().startsWith(prefix);
}

/**
 * Letzter Codeblock aller Haupt-Antworten (ohne Sidechain), dessen erste nichtleere Zeile mit prefix beginnt: die
 * Startnachricht für den nächsten Chat. Zurück kommt genau der Text, den der Knopf des Blocks kopiert; so lässt sich ein
 * Knopf der letzten Antwort per Stringvergleich als derselbe Block erkennen. Leeres Präfix oder nur Leerzeichen: null.
 */
export function lastHandoffBlock(jsonl: string, prefix: string): string | null {
  if (prefix.trim() === "") return null;
  const antworten = antwortTexte(leseEintraege(jsonl));
  for (let i = antworten.length - 1; i >= 0; i--) {
    const bloecke = extractCodeBlocks(antworten[i]);
    for (let j = bloecke.length - 1; j >= 0; j--) {
      if (beginntMit(bloecke[j].code, prefix)) return bloecke[j].code;
    }
  }
  return null;
}

/** Kurzbeschriftung: erste nicht leere Zeile, auf maxLen gekürzt, mit vorangestellter Sprache. */
export function codeBlockLabel(block: CodeBlock, maxLen: number): string {
  const erste = block.code.split("\n").map((z) => z.trim()).find((z) => z !== "");
  let text = "(leer)";
  if (erste !== undefined) {
    text = erste.length > maxLen ? erste.slice(0, Math.max(0, maxLen - 1)) + "…" : erste;
  }
  return block.lang ? `${block.lang}: ${text}` : text;
}
