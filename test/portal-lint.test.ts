import { describe, expect, it } from "vitest";
import { summarize, verdict } from "../scripts/lib/portal-lint";

const m = (ruleId: string | null, severity: 1 | 2, line = 1) => ({ ruleId, severity, line, message: "x" });

describe("Portal-Lint-Zusammenfassung", () => {
  it("zählt Errors und Warnungen je Regel, sentence-case nicht (zeigt das Portal nicht)", () => {
    const s = summarize([
      { filePath: "/x/src/a.ts", messages: [m("r/a", 2, 3), m("r/b", 1), m("obsidianmd/ui/sentence-case", 1)] },
      { filePath: "/x/src/b.ts", messages: [m("r/b", 1, 7)] },
    ]);
    expect(s.errors).toBe(1);
    expect(s.warnings).toBe(2);
    expect(s.byRule).toEqual({ "r/a": 1, "r/b": 2 });
    expect(s.errorLines).toEqual(["src/a.ts:3 r/a x"]);
  });
  it("Error ohne Regel (Parserfehler) zählt als Error", () => {
    expect(summarize([{ filePath: "/x/src/a.ts", messages: [m(null, 2)] }]).errors).toBe(1);
  });
  it("Exit 1 nur bei Errors", () => {
    expect(verdict({ errors: 0, warnings: 5, byRule: {}, errorLines: [] })).toBe(0);
    expect(verdict({ errors: 1, warnings: 0, byRule: {}, errorLines: [] })).toBe(1);
  });
});
