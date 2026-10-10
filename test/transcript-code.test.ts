import { describe, expect, it } from "vitest";
import { codeBlockLabel, extractCodeBlocks, lastAnswerText, lastHandoffBlock } from "../src/core/transcript-code";

/** Baut eine Transkriptzeile. */
function zeile(type: string, id: string | null, blocks: unknown[], extra: object = {}): string {
  return JSON.stringify({ type, ...extra, message: { id, content: blocks } });
}
const text = (t: string) => ({ type: "text", text: t });

describe("lastAnswerText", () => {
  it("verbindet eine Antwort über zwei Zeilen mit gleicher id", () => {
    const j = [zeile("assistant", "m1", [text("Eins")]), zeile("assistant", "m1", [text("Zwei")])].join("\n");
    expect(lastAnswerText(j)).toBe("Eins\n\nZwei");
  });

  it("nimmt die letzte Antwort, nicht die erste", () => {
    const j = [zeile("assistant", "m1", [text("alt")]), zeile("assistant", "m2", [text("neu")])].join("\n");
    expect(lastAnswerText(j)).toBe("neu");
  });

  it("ignoriert spätere user-Einträge", () => {
    const j = [zeile("assistant", "m1", [text("Antwort")]), zeile("user", null, [text("/exit")])].join("\n");
    expect(lastAnswerText(j)).toBe("Antwort");
  });

  it("ignoriert Sidechain-Antworten danach und gleiche id in Sidechain", () => {
    const j = [
      zeile("assistant", "m1", [text("Haupt")]),
      zeile("assistant", "m1", [text("Fremd")], { isSidechain: true }),
      zeile("assistant", "m2", [text("Sub")], { isSidechain: true }),
    ].join("\n");
    expect(lastAnswerText(j)).toBe("Haupt");
  });

  it("überspringt eine kaputte erste Zeile", () => {
    const j = ['ssistant","x":', zeile("assistant", "m1", [text("ok")])].join("\n");
    expect(lastAnswerText(j)).toBe("ok");
  });

  it("nur thinking/tool_use danach ergibt den vorherigen Text-Eintrag", () => {
    const j = [
      zeile("assistant", "m1", [text("Text")]),
      zeile("assistant", "m2", [{ type: "thinking", thinking: "..." }]),
      zeile("assistant", "m2", [{ type: "tool_use", name: "Bash" }]),
    ].join("\n");
    expect(lastAnswerText(j)).toBe("Text");
  });

  it("ohne jeden Text-Block null", () => {
    const j = zeile("assistant", "m1", [{ type: "tool_use" }]);
    expect(lastAnswerText(j)).toBeNull();
  });

  it("leere Eingabe ergibt null", () => {
    expect(lastAnswerText("")).toBeNull();
  });
});

describe("lastHandoffBlock", () => {
  const P = "Handoff:";
  /** Fenced Block mit genau diesem Inhalt. */
  const block = (code: string, lang = "") => "```" + lang + "\n" + code + "\n```";
  const antwort = (id: string, ...teile: string[]) => zeile("assistant", id, teile.map(text));

  it("findet den Block in einer früheren Antwort, wenn die letzte Antwort keinen hat", () => {
    const j = [
      antwort("m1", `Fertig.\n\n${block("Handoff: weiter mit Schritt 3\nzweite Zeile", "text")}`),
      antwort("m2", "ok"),
      antwort("m3", "Noch etwas"),
    ].join("\n");
    expect(lastHandoffBlock(j, P)).toBe("Handoff: weiter mit Schritt 3\nzweite Zeile");
  });

  it("Block ohne Präfix ergibt null", () => {
    const j = antwort("m1", `Hier:\n${block("ls -la", "sh")}\n\nUnd:\n${block("npm test")}`);
    expect(lastHandoffBlock(j, P)).toBeNull();
  });

  it("nur die erste nichtleere Zeile zählt: Präfix in der zweiten Zeile oder mitten in der ersten reicht nicht", () => {
    expect(lastHandoffBlock(antwort("m1", block("Titel\nHandoff: später")), P)).toBeNull();
    expect(lastHandoffBlock(antwort("m1", block("Mein Handoff: Text")), P)).toBeNull();
  });

  it("führende Leerzeilen und Leerzeichen vor dem Präfix werden ignoriert", () => {
    const code = "\n   \n    Handoff: eingerückt\nZeile 2";
    expect(lastHandoffBlock(antwort("m1", block(code)), P)).toBe(code);
  });

  it("das Präfix ist ein Textanfang, kein Muster: Sonderzeichen zählen wörtlich, Groß- und Kleinschreibung auch", () => {
    expect(lastHandoffBlock(antwort("m1", block("Übergabe (neu)? x")), "Übergabe (neu)?")).toBe("Übergabe (neu)? x");
    expect(lastHandoffBlock(antwort("m1", block("Übergabe (neu) x")), "Übergabe (neu)?")).toBeNull();
    expect(lastHandoffBlock(antwort("m1", block("handoff: klein")), P)).toBeNull();
  });

  it("zwei passende Blöcke in verschiedenen Antworten: der jüngere", () => {
    const j = [
      antwort("m1", block("Handoff: alt")),
      antwort("m2", "dazwischen"),
      antwort("m3", block("Handoff: neu")),
      antwort("m4", block("ls")),
    ].join("\n");
    expect(lastHandoffBlock(j, P)).toBe("Handoff: neu");
  });

  it("zwei passende Blöcke in derselben Antwort: der spätere", () => {
    const j = antwort("m1", `${block("Handoff: erst")}\n\nund dann\n\n${block("Handoff: zuletzt")}`);
    expect(lastHandoffBlock(j, P)).toBe("Handoff: zuletzt");
  });

  it("eine Antwort über mehrere Zeilen mit gleicher id gilt als eine; Reihenfolge der Blöcke bleibt", () => {
    const j = [
      zeile("assistant", "m1", [text(block("Handoff: eins"))]),
      zeile("assistant", "m1", [{ type: "tool_use", name: "Bash" }]),
      zeile("assistant", "m1", [text(block("Handoff: zwei"))]),
    ].join("\n");
    expect(lastHandoffBlock(j, P)).toBe("Handoff: zwei");
  });

  it("kaputte Zeilen werden übersprungen, ohne zu werfen", () => {
    const j = ['ssistant","x":', antwort("m1", block("Handoff: ok")), "{nicht json", ""].join("\n");
    expect(() => lastHandoffBlock(j, P)).not.toThrow();
    expect(lastHandoffBlock(j, P)).toBe("Handoff: ok");
  });

  it("Sidechain-Nachrichten zählen nicht, auch nicht mit gleicher id oder als jüngste", () => {
    const j = [
      antwort("m1", block("Handoff: haupt")),
      zeile("assistant", "m1", [text(block("Handoff: fremd gleiche id"))], { isSidechain: true }),
      zeile("assistant", "m2", [text(block("Handoff: fremd neuer"))], { isSidechain: true }),
    ].join("\n");
    expect(lastHandoffBlock(j, P)).toBe("Handoff: haupt");
    expect(lastHandoffBlock(zeile("assistant", "m9", [text(block("Handoff: nur Sidechain"))], { isSidechain: true }), P)).toBeNull();
  });

  it("nur Antworten des Assistenten zählen: ein user-Eintrag mit passendem Block wird ignoriert", () => {
    const j = [zeile("user", null, [text(block("Handoff: vom Nutzer"))]), antwort("m1", "ohne Block")].join("\n");
    expect(lastHandoffBlock(j, P)).toBeNull();
  });

  it("leeres Präfix oder nur Leerzeichen ergibt null, auch wenn jeder Block passen würde", () => {
    const j = antwort("m1", `${block("Handoff: a")}\n\n${block("   b")}\n\n${block("")}`);
    expect(lastHandoffBlock(j, "")).toBeNull();
    expect(lastHandoffBlock(j, "   ")).toBeNull();
    expect(lastHandoffBlock(j, "\t")).toBeNull();
  });

  it("leeres Transkript, Antwort ohne Text und Block ohne Inhalt ergeben null", () => {
    expect(lastHandoffBlock("", P)).toBeNull();
    expect(lastHandoffBlock(zeile("assistant", "m1", [{ type: "tool_use", name: "Bash" }]), P)).toBeNull();
    expect(lastHandoffBlock(antwort("m1", block("")), P)).toBeNull();
  });

  it("liefert genau den Text, den der Knopf der Antwort kopiert (Voraussetzung fürs Entdoppeln per Stringvergleich)", () => {
    const j = [
      antwort("m1", `Start\n\n${block("\n  Handoff: Rest  \n\n  tief\n", "text")}`),
      zeile("assistant", "m1", [text(`und mehr\n\n${block("Handoff: zwei Text-Blöcke")}`)]),
    ].join("\n");
    const h = lastHandoffBlock(j, P);
    expect(h).not.toBeNull();
    const knoepfe = extractCodeBlocks(lastAnswerText(j) ?? "").map((b) => b.code);
    expect(knoepfe).toContain(h);
    // Auch der frühere Block der Antwort ist derselbe String wie sein Knopf.
    expect(knoepfe).toContain("\n  Handoff: Rest  \n\n  tief\n");
  });
});

describe("extractCodeBlocks", () => {
  it("ein Block mit lang", () => {
    expect(extractCodeBlocks("Text\n```ts\nconst a = 1;\n```\nEnde")).toEqual([{ lang: "ts", code: "const a = 1;" }]);
  });

  it("zwei Blöcke in Reihenfolge, einer ohne lang", () => {
    const md = "```sh\nls\n```\n\nzwischen\n\n```\nzwei\nzeilen\n```";
    expect(extractCodeBlocks(md)).toEqual([
      { lang: "sh", code: "ls" },
      { lang: "", code: "zwei\nzeilen" },
    ]);
  });

  it("Tilden-Zaun", () => {
    expect(extractCodeBlocks("~~~py\nprint(1)\n~~~")).toEqual([{ lang: "py", code: "print(1)" }]);
  });

  it("Viererzaun mit innerem Dreierzaun als Inhalt", () => {
    const md = "````md\n```ts\nx\n```\n````";
    expect(extractCodeBlocks(md)).toEqual([{ lang: "md", code: "```ts\nx\n```" }]);
  });

  it("anderes Zaunzeichen schließt nicht", () => {
    expect(extractCodeBlocks("```\n~~~\n```")).toEqual([{ lang: "", code: "~~~" }]);
  });

  it("eingerückter Zaun entfernt die Einrückung, höchstens n je Zeile", () => {
    const md = "- Punkt\n\n   ```sh\n   npm i\n     tief\n  wenig\n\tTab\n   ```";
    expect(extractCodeBlocks(md)).toEqual([{ lang: "sh", code: "npm i\n  tief\nwenig\n\tTab" }]);
  });

  it("Leerzeilen und Einrückung im Inhalt bleiben exakt", () => {
    const md = "```\n\n  a\n\n    b\n\n```";
    expect(extractCodeBlocks(md)).toEqual([{ lang: "", code: "\n  a\n\n    b\n" }]);
  });

  it("nicht geschlossener Block läuft bis zum Ende", () => {
    expect(extractCodeBlocks("```js\nlet x;\nlet y;")).toEqual([{ lang: "js", code: "let x;\nlet y;" }]);
  });

  it("offener Block mit Zeilenende am Textende hat keine Leerzeile am Schluss", () => {
    expect(extractCodeBlocks("```js\nlet x;\nlet y;\n")).toEqual([{ lang: "js", code: "let x;\nlet y;" }]);
  });

  it("Backtick im Info-String: kein Block, Folgetext bleibt Text", () => {
    expect(extractCodeBlocks("```a`b`\nText\n```ts\nx\n```")).toEqual([{ lang: "ts", code: "x" }]);
  });

  it("CRLF zählt als Zeilenende", () => {
    expect(extractCodeBlocks("```ts\r\na\r\nb\r\n```\r\n")).toEqual([{ lang: "ts", code: "a\nb" }]);
  });

  it("Text ohne Block gibt []", () => {
    expect(extractCodeBlocks("nur Text `inline`")).toEqual([]);
  });
});

describe("codeBlockLabel", () => {
  it("kurz", () => {
    expect(codeBlockLabel({ lang: "", code: "ls -la\nmehr" }, 20)).toBe("ls -la");
  });
  it("lang gekürzt auf maxLen-1 plus Ellipse", () => {
    expect(codeBlockLabel({ lang: "", code: "abcdefghij" }, 5)).toBe("abcd…");
  });
  it("überspringt führende Leerzeilen und trimmt", () => {
    expect(codeBlockLabel({ lang: "", code: "\n  \n   x = 1  \n" }, 20)).toBe("x = 1");
  });
  it("leer", () => {
    expect(codeBlockLabel({ lang: "", code: " \n" }, 20)).toBe("(leer)");
    expect(codeBlockLabel({ lang: "ts", code: "" }, 20)).toBe("ts: (leer)");
  });
  it("mit lang, lang zählt nicht zu maxLen", () => {
    expect(codeBlockLabel({ lang: "sh", code: "abcdefghij" }, 5)).toBe("sh: abcd…");
  });
  it("genau maxLen bleibt ungekürzt", () => {
    expect(codeBlockLabel({ lang: "", code: "abcde" }, 5)).toBe("abcde");
  });
});
