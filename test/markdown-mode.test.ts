import { StringStream } from "@codemirror/language";
import { describe, expect, it } from "vitest";
import { MD_PARTS, MD_TOKEN, inlineKind, markdownParser, parseCommands } from "../src/core/markdown-mode";

// Nachtrag 43b: Markdown-Parser für den Datei-Viewer. Rein, ohne CodeMirror-View; getrieben mit dem Upstream-StringStream.
type Tok = [string, string | null];

/** Tokens je Zeile; wirft, wenn ein Token nicht vorankommt (CodeMirror würde dann werfen). */
function proZeile(lines: string[], commands = parseCommands("npm git")): Tok[][] {
  const parser = markdownParser(commands);
  const state = parser.startState!(2);
  return lines.map((line) => {
    const out: Tok[] = [];
    if (line.length === 0) {
      parser.blankLine?.(state, 2);
      return out;
    }
    const stream = new StringStream(line, 4, 2);
    while (!stream.eol()) {
      const vor = stream.pos;
      const style = parser.token(stream, state);
      if (stream.pos <= vor) throw new Error(`kein Vorschub in Zeile "${line}" bei ${vor}`);
      out.push([stream.current(), style]);
      stream.start = stream.pos;
    }
    return out;
  });
}
const tokens = (lines: string[], commands?: ReadonlySet<string>): Tok[] => proZeile(lines, commands).flat();
const stile = (zeile: Tok[]): Array<string | null> => [...new Set(zeile.map((t) => t[1]))];

describe("markdownParser", () => {
  it("fließtext ist text", () => {
    expect(stile(tokens(["Hallo Welt"]))).toEqual([MD_TOKEN.text]);
  });

  it("backtick pfad ist code", () => {
    expect(tokens(["Siehe `src/main.ts` hier"])).toContainEqual(["`src/main.ts`", "cockpit-md-code"]);
  });

  it("backtick befehl ist command", () => {
    for (const z of ["`npm run build`", "`$ ls -la`", "`./scripts/x.sh`"]) expect(tokens([z]), z).toEqual([[z, "cockpit-md-command"]]);
    expect(tokens(["`npmx`"])).toEqual([["`npmx`", "cockpit-md-code"]]);
  });

  it("doppelte backticks", () => {
    expect(tokens(["``a ` b``"])).toEqual([["``a ` b``", "cockpit-md-code"]]);
  });

  it("bash-block ist command", () => {
    for (const oeffner of ["```bash", "~~~zsh", "```Shell"]) {
      const z = proZeile([oeffner, "npm ci", oeffner.slice(0, 3), "danach"]);
      for (let i = 0; i < 3; i++) expect(stile(z[i]), `${oeffner} Zeile ${i + 1}`).toEqual(["cockpit-md-command"]);
      expect(stile(z[3])).toEqual(["cockpit-md-text"]);
    }
  });

  it("ts-block und block ohne sprache sind code", () => {
    for (const oeffner of ["```ts", "```"]) {
      const z = proZeile([oeffner, "x", "```", "danach"]);
      for (let i = 0; i < 3; i++) expect(stile(z[i]), `${oeffner} Zeile ${i + 1}`).toEqual(["cockpit-md-code"]);
      expect(stile(z[3])).toEqual(["cockpit-md-text"]);
    }
  });

  it("schließen braucht gleiche länge", () => {
    const z = proZeile(["````", "```", "````", "x"]);
    expect(stile(z[1])).toEqual(["cockpit-md-code"]);
    expect(stile(z[3])).toEqual(["cockpit-md-text"]);
  });

  it("offener block färbt bis zum ende", () => {
    const z = proZeile(["```", "a", "b"]);
    for (const zeile of z) expect(stile(zeile)).toEqual(["cockpit-md-code"]);
  });

  it("überschrift", () => {
    expect(tokens(["## Ziel `x`"])).toEqual([["## Ziel `x`", "cockpit-md-heading"]]);
    expect(stile(tokens(["#hashtag"]))).toEqual(["cockpit-md-text"]);
  });

  it("frontmatter nur ab zeile 1", () => {
    const z = proZeile(["---", "tags: a", "---", "x"]);
    for (let i = 0; i < 3; i++) expect(stile(z[i])).toEqual(["cockpit-md-frontmatter"]);
    expect(stile(z[3])).toEqual(["cockpit-md-text"]);
    expect(stile(proZeile(["x", "---"])[1])).toEqual(["cockpit-md-marker"]);
  });

  it("frontmatter schließt auch mit drei punkten, leere zeilen zählen mit", () => {
    const z = proZeile(["---", "", "a: b", "...", "x"]);
    expect(stile(z[2])).toEqual(["cockpit-md-frontmatter"]);
    expect(stile(z[3])).toEqual(["cockpit-md-frontmatter"]);
    expect(stile(z[4])).toEqual(["cockpit-md-text"]);
  });

  it("listen zitat aufgabe", () => {
    expect(tokens(["- [ ] Punkt"])).toEqual([["- ", "cockpit-md-marker"], ["[ ] ", "cockpit-md-marker"], ["Punkt", "cockpit-md-text"]]);
    expect(tokens(["> [!info] x"])[0]).toEqual(["> ", "cockpit-md-marker"]);
    expect(tokens(["12. a"])[0]).toEqual(["12. ", "cockpit-md-marker"]);
  });

  it("links", () => {
    for (const z of ["[[Plan 41d]]", "[a](b.md)", "https://x.de/a"]) expect(tokens([z]), z).toEqual([[z, "cockpit-md-link"]]);
  });

  it("url mitten in der zeile ist link", () => {
    expect(tokens(["Siehe https://x.de/a hier"])).toContainEqual(["https://x.de/a", "cockpit-md-link"]);
  });

  it("zaun schließt nur mit gleichem zeichen", () => {
    for (const z of proZeile(["```", "~~~", "x"])) expect(stile(z)).toEqual(["cockpit-md-code"]);
  });

  it("backtick-lauf schließt nur bei genau gleicher länge", () => {
    expect(stile(tokens(["`a`` b"]))).toEqual(["cockpit-md-text"]);
  });

  it("glob-sterne und sterne im wort sind kein kursiv", () => {
    for (const z of ["**/*.ts und src/*.md", "a*b*c", "a*b* c", "src/*b* c", "*b*.ts", "*b*/x"]) expect(stile(tokens([z])), z).toEqual(["cockpit-md-text"]);
  });

  it("kursiv vor satzende-punkt", () => {
    const em = "cockpit-md-text cockpit-md-em";
    expect(tokens(["Das ist *wichtig*."])).toEqual([["Das ist ", "cockpit-md-text"], ["*wichtig*", em], [".", "cockpit-md-text"]]);
    expect(tokens(["*wichtig*. "])).toEqual([["*wichtig*", em], [". ", "cockpit-md-text"]]);
    expect(tokens(["*wichtig*."])).toEqual([["*wichtig*", em], [".", "cockpit-md-text"]]);
  });

  it("fett und kursiv", () => {
    expect(tokens(["**fett**"])).toEqual([["**fett**", "cockpit-md-text cockpit-md-strong"]]);
    expect(tokens(["*k*"])).toEqual([["*k*", "cockpit-md-text cockpit-md-em"]]);
    expect(tokens(["Aufgabe mit **fett** und *kursiv*"]).map((t) => t[1])).toEqual([
      "cockpit-md-text", "cockpit-md-text cockpit-md-strong", "cockpit-md-text", "cockpit-md-text cockpit-md-em",
    ]);
  });

  it("kein kursiv im fließtext", () => {
    for (const z of ["2 * 3 * 4", "2 * a*", "file_name und snake_case"]) expect(stile(tokens([z])), z).toEqual(["cockpit-md-text"]);
  });

  it("kursiv schließt nicht am fett-stern", () => {
    expect(tokens(["*text und **fett**"])).toEqual([["*text und ", "cockpit-md-text"], ["**fett**", "cockpit-md-text cockpit-md-strong"]]);
    expect(stile(tokens(["*a**"]))).toEqual(["cockpit-md-text"]);
  });

  it("einzelner backtick bleibt text", () => {
    for (const z of ["it`s ab", "a`b"]) expect(stile(tokens([z])), z).toEqual(["cockpit-md-text"]);
  });

  it("kaputte zeilen verbrauchen alles", () => {
    for (const z of ["", "   ", "**", "[[", "`", "[a](", "|"]) expect(() => proZeile([z]), z).not.toThrow();
  });

  it("tabelle", () => {
    expect(tokens(["| a | b |"])).toEqual([
      ["|", "cockpit-md-marker"], [" a ", "cockpit-md-text"], ["|", "cockpit-md-marker"], [" b ", "cockpit-md-text"], ["|", "cockpit-md-marker"],
    ]);
  });

  it("trennlinie ist marker", () => {
    expect(tokens(["* * *"])).toEqual([["* * *", "cockpit-md-marker"]]);
  });

  it("leere zeile zählt als zeile (frontmatter nur in zeile 1)", () => {
    expect(stile(proZeile(["", "---"])[1])).toEqual(["cockpit-md-marker"]);
  });
});

describe("inlineKind und parseCommands", () => {
  it("Befehle erkennen", () => {
    const c = parseCommands("  npm   git ");
    expect([...c]).toEqual(["npm", "git"]);
    expect(inlineKind("  npm ci ", c)).toBe("command");
    expect(inlineKind("$ x", c)).toBe("command");
    expect(inlineKind("./a", c)).toBe("command");
    expect(inlineKind("a/b.ts", c)).toBe("code");
    expect(inlineKind("$x", c)).toBe("code");
  });

  it("MD_TOKEN deckt alle Teile ab", () => {
    for (const p of MD_PARTS) expect(MD_TOKEN[p]).toBe(`cockpit-md-${p}`);
    expect(MD_TOKEN.strong).toBe("cockpit-md-strong");
    expect(MD_TOKEN.em).toBe("cockpit-md-em");
  });
});
