import { describe, expect, it } from "vitest";
import { CODE_TOOLTIP_LINES, CODE_TOOLTIP_LINE_LEN, HANDOFF_BUTTON_LABEL } from "../src/core/constants";
import { type CodeBlock, lastHandoffBlock } from "../src/core/transcript-code";
import { HandoffKeeper, barItems, codeTooltip, mayRescan, statChanged, tailStart } from "../src/core/transcript-poll";

describe("statChanged", () => {
  it("liest beim ersten Mal", () => {
    expect(statChanged(null, { size: 0, mtimeMs: 1 })).toBe(true);
  });
  it("liest nicht bei gleichem Stand", () => {
    expect(statChanged({ size: 10, mtimeMs: 5 }, { size: 10, mtimeMs: 5 })).toBe(false);
  });
  it("liest bei geänderter Größe", () => {
    expect(statChanged({ size: 10, mtimeMs: 5 }, { size: 11, mtimeMs: 5 })).toBe(true);
  });
  it("liest bei geändertem mtime", () => {
    expect(statChanged({ size: 10, mtimeMs: 5 }, { size: 10, mtimeMs: 6 })).toBe(true);
  });
});

describe("tailStart", () => {
  it("liest kleine Dateien ganz", () => {
    expect(tailStart(100, 524288)).toBe(0);
  });
  it("liest genau tailBytes ab Ende bei großen Dateien", () => {
    expect(tailStart(1_000_000, 524288)).toBe(475712);
  });
  it("Grenzfall: Größe gleich tailBytes", () => {
    expect(tailStart(524288, 524288)).toBe(0);
  });
});

describe("mayRescan", () => {
  it("sucht beim ersten Mal", () => {
    expect(mayRescan(null, 1000, 10000)).toBe(true);
  });
  it("wartet innerhalb der Mindestzeit", () => {
    expect(mayRescan(1000, 5000, 10000)).toBe(false);
  });
  it("sucht nach Ablauf", () => {
    expect(mayRescan(1000, 11000, 10000)).toBe(true);
  });
});

describe("codeTooltip", () => {
  it("gibt kurzen Code unverändert", () => {
    expect(codeTooltip("a\nb", 5, 80)).toBe("a\nb");
  });
  it("kürzt auf maxLines und hängt … an", () => {
    expect(codeTooltip("1\n2\n3\n4", 2, 80)).toBe("1\n2\n…");
  });
  it("kürzt lange Zeilen", () => {
    expect(codeTooltip("abcdefghij", 5, 5)).toBe("abcd…");
  });
  it("ohne Überschuss kein …", () => {
    expect(codeTooltip("1\n2", 2, 80)).toBe("1\n2");
  });
});

describe("barItems (Leiste mit festem Handoff-Knopf)", () => {
  const blk = (code: string, lang = ""): CodeBlock => ({ lang, code });
  const A = blk("ls -la", "sh");
  const B = blk("npm test");
  const H = "Handoff: weiter bei Schritt 3\nzweite Zeile";
  const kinds = (items: ReturnType<typeof barItems>) => items.map((i) => i.kind);

  it("ohne Handoff: ein Knopf je Block wie bisher, nur der letzte trägt die Akzentfarbe", () => {
    expect(barItems([A, B], null).map((i) => [i.kind, i.label, i.last])).toEqual([
      ["block", "sh: ls -la", false],
      ["block", "npm test", true],
    ]);
  });

  it("ohne Blöcke und ohne Handoff: keine Knöpfe", () => {
    expect(barItems([], null)).toEqual([]);
  });

  it("Handoff, der nicht in der Antwort steht: fester Knopf vorn, danach alle Blöcke", () => {
    const items = barItems([A, B], H);
    expect(kinds(items)).toEqual(["handoff", "block", "block"]);
    expect(items[0].label).toBe(HANDOFF_BUTTON_LABEL);
    expect(items[0].label).toBe("Handoff kopieren");
    expect(items[0].block.code).toBe(H);
    expect(items.map((i) => i.last)).toEqual([false, false, true]);
  });

  it("Handoff ohne Blöcke in der Antwort (etwa nach /clear): genau der feste Knopf", () => {
    const items = barItems([], H);
    expect(kinds(items)).toEqual(["handoff"]);
    expect(items[0].block.code).toBe(H);
    expect(items[0].last).toBe(false);
  });

  it("Handoff steckt auch in der Antwort: dessen normaler Knopf entfällt, es bleibt nur der feste", () => {
    const items = barItems([A, blk(H), B], H);
    expect(kinds(items)).toEqual(["handoff", "block", "block"]);
    expect(items.filter((i) => i.block.code === H)).toHaveLength(1);
    expect(items.slice(1).map((i) => i.block.code)).toEqual(["ls -la", "npm test"]);
    expect(items.map((i) => i.last)).toEqual([false, false, true]);
  });

  it("Handoff ist der letzte Block der Antwort: der feste Knopf steht für ihn und trägt die Akzentfarbe", () => {
    const items = barItems([A, blk(H)], H);
    expect(kinds(items)).toEqual(["handoff", "block"]);
    expect(items.map((i) => i.last)).toEqual([true, false]);
  });

  it("der Tooltip des festen Knopfs ist der Block, gekürzt wie bei den anderen Knöpfen", () => {
    const lang = Array.from({ length: 12 }, (_, i) => `Handoff: Zeile ${i}`).join("\n");
    const items = barItems([A], lang);
    expect(items).toHaveLength(2);
    expect(items[0].tooltip).toBe(codeTooltip(lang, CODE_TOOLTIP_LINES, CODE_TOOLTIP_LINE_LEN));
    expect(items[0].tooltip.endsWith("\n…")).toBe(true);
    expect(items[1].tooltip).toBe(codeTooltip("ls -la", CODE_TOOLTIP_LINES, CODE_TOOLTIP_LINE_LEN));
  });

  it("entdoppelt nur bei exakt gleichem Text: ein Unterschied am Zeilenende lässt den Knopf stehen", () => {
    const items = barItems([blk(H + "\n"), blk(H + " ")], H);
    expect(kinds(items)).toEqual(["handoff", "block", "block"]);
  });

  it("mehrere Blöcke mit dem Text des Handoffs entfallen alle, der feste kopiert denselben Text", () => {
    const items = barItems([blk(H), A, blk(H)], H);
    expect(kinds(items)).toEqual(["handoff", "block"]);
    expect(items[1].block.code).toBe("ls -la");
    expect(items[0].last).toBe(true);
  });
});

describe("HandoffKeeper (Wert je Cockpit-Sitzung, nicht je Claude-ID)", () => {
  it("ein Wert, den es noch nie gab, ergibt null: kein Knopf", () => {
    const keeper = new HandoffKeeper();
    expect(keeper.get("c1")).toBeNull();
    expect(keeper.keep("c1", null)).toBeNull();
    expect(keeper.get("c1")).toBeNull();
  });

  it("merkt den gefundenen Block und gibt ihn zurück", () => {
    const keeper = new HandoffKeeper();
    expect(keeper.keep("c1", "Handoff: a")).toBe("Handoff: a");
    expect(keeper.get("c1")).toBe("Handoff: a");
  });

  it("kein Block im neuen Stand (null) lässt den alten Wert stehen, ein neuerer Block ersetzt ihn", () => {
    const keeper = new HandoffKeeper();
    keeper.keep("c1", "Handoff: alt");
    expect(keeper.keep("c1", null)).toBe("Handoff: alt");
    expect(keeper.get("c1")).toBe("Handoff: alt");
    expect(keeper.keep("c1", "Handoff: neu")).toBe("Handoff: neu");
    expect(keeper.get("c1")).toBe("Handoff: neu");
  });

  it("Sitzungen sind getrennt: ein Block gehört nur zu seiner Cockpit-id", () => {
    const keeper = new HandoffKeeper();
    keeper.keep("c1", "Handoff: eins");
    keeper.keep("c2", "Handoff: zwei");
    keeper.keep("c1", null);
    expect(keeper.get("c1")).toBe("Handoff: eins");
    expect(keeper.get("c2")).toBe("Handoff: zwei");
    expect(keeper.get("c3")).toBeNull();
  });
});

describe("Sitzungswechsel nach /clear: Cockpit-id bleibt, das Claude-Transkript wechselt", () => {
  const antwort = (id: string, t: string) => JSON.stringify({ type: "assistant", message: { id, content: [{ type: "text", text: t }] } });
  const block = (code: string) => "```\n" + code + "\n```";
  const P = "Handoff:";
  // Transkript vor /clear: Startnachricht, danach weitere Antworten ohne Block.
  const vorClear = [antwort("m1", `Hier die Startnachricht:\n\n${block("Handoff: Schritt 3 steht an\nPfad: /x")}`), antwort("m2", "ok"), antwort("m3", "fertig")].join("\n");
  // Transkript nach /clear: neue Claude-ID, zuerst ohne Block, später mit.
  const nachClearOhne = [antwort("n1", "Neuer Chat, ohne Block"), antwort("n2", `Nur ein Befehl:\n${block("ls")}`)].join("\n");
  const nachClearMit = [nachClearOhne, antwort("n3", `Neue Startnachricht:\n${block("Handoff: Schritt 4")}`)].join("\n");

  it("neues Transkript ohne Block: der alte Wert bleibt; mit Block: der neue ersetzt ihn", () => {
    const keeper = new HandoffKeeper();
    // Poll im alten Transkript.
    expect(keeper.keep("cockpit-1", lastHandoffBlock(vorClear, P))).toBe("Handoff: Schritt 3 steht an\nPfad: /x");
    // /clear: der Schlüssel (Cockpit-id) ist derselbe, die Claude-ID spielt keine Rolle.
    expect(keeper.keep("cockpit-1", lastHandoffBlock(nachClearOhne, P))).toBe("Handoff: Schritt 3 steht an\nPfad: /x");
    expect(keeper.keep("cockpit-1", lastHandoffBlock(nachClearMit, P))).toBe("Handoff: Schritt 4");
    expect(keeper.get("cockpit-1")).toBe("Handoff: Schritt 4");
  });

  it("die Leiste nach /clear: nur der feste Knopf, solange das neue Transkript keine Blöcke liefert", () => {
    const keeper = new HandoffKeeper();
    keeper.keep("cockpit-1", lastHandoffBlock(vorClear, P));
    expect(kinds(barItems([], keeper.get("cockpit-1")))).toEqual(["handoff"]);
    // Neues Transkript mit anderem Block: fester Knopf plus dessen Knopf.
    keeper.keep("cockpit-1", lastHandoffBlock(nachClearOhne, P));
    expect(kinds(barItems([{ lang: "", code: "ls" }], keeper.get("cockpit-1")))).toEqual(["handoff", "block"]);
  });

  it("leeres Präfix übernimmt nichts, ein vorhandener Wert bleibt", () => {
    const keeper = new HandoffKeeper();
    expect(keeper.keep("cockpit-2", lastHandoffBlock(vorClear, ""))).toBeNull();
    keeper.keep("cockpit-2", lastHandoffBlock(vorClear, P));
    expect(keeper.keep("cockpit-2", lastHandoffBlock(nachClearMit, "  "))).toBe("Handoff: Schritt 3 steht an\nPfad: /x");
  });

  function kinds(items: ReturnType<typeof barItems>): string[] {
    return items.map((i) => i.kind);
  }
});
