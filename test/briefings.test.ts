import { describe, expect, it } from "vitest";
import { fillPrompt, isInBriefingsDir, listBriefings, parseBriefingName, pickSelection } from "../src/core/briefings";

describe("parseBriefingName", () => {
  it("gültiger Name gibt das Datum", () => {
    expect(parseBriefingName("2026-10-04.md")).toBe("2026-10-04");
    expect(parseBriefingName("2024-02-29.md")).toBe("2024-02-29");
  });
  it("kein echtes Kalenderdatum gibt null", () => {
    expect(parseBriefingName("2026-02-30.md")).toBeNull();
    expect(parseBriefingName("2026-13-01.md")).toBeNull();
    expect(parseBriefingName("2026-00-10.md")).toBeNull();
    expect(parseBriefingName("2026-10-00.md")).toBeNull();
    expect(parseBriefingName("2025-02-29.md")).toBeNull();
  });
  it("falsches Format gibt null", () => {
    for (const n of ["README.md", "2026-10-04.md.bak", "x2026-10-04.md", "2026-10-04.txt", "2026-1-4.md", "2026-10-04", "2026-10-04.md\n", ""]) {
      expect(parseBriefingName(n)).toBeNull();
    }
  });
});

describe("listBriefings", () => {
  it("behält nur gültige, absteigend, ohne Duplikate", () => {
    const names = ["2026-10-01.md", "README.md", "2026-10-04.md", "2026-02-30.md", "2026-10-02.md", "2026-10-04.md", "2026-10-04.md.bak", "x2026-10-04.md", "sub"];
    expect(listBriefings(names)).toEqual(["2026-10-04", "2026-10-02", "2026-10-01"]);
  });
  it("sortiert über Monats- und Jahresgrenzen", () => {
    expect(listBriefings(["2025-12-31.md", "2026-01-01.md", "2026-09-30.md"])).toEqual(["2026-09-30", "2026-01-01", "2025-12-31"]);
  });
  it("leer bleibt leer", () => {
    expect(listBriefings([])).toEqual([]);
  });
});

describe("isInBriefingsDir", () => {
  it("nur direkte Kinder", () => {
    expect(isInBriefingsDir("Briefings/2026-10-04.md", "Briefings")).toBe(true);
    expect(isInBriefingsDir("Briefings/sub/2026-10-04.md", "Briefings")).toBe(false);
    expect(isInBriefingsDir("BriefingsAlt/2026-10-04.md", "Briefings")).toBe(false);
    expect(isInBriefingsDir("Briefings", "Briefings")).toBe(false);
    expect(isInBriefingsDir("x/Briefings/a.md", "Briefings")).toBe(false);
  });
  it("verschachtelter Ordner", () => {
    expect(isInBriefingsDir("a/b/2026-10-04.md", "a/b")).toBe(true);
    expect(isInBriefingsDir("a/b/c/x.md", "a/b")).toBe(false);
  });
});

describe("pickSelection", () => {
  const list = ["2026-10-04", "2026-10-03", "2026-10-02"];
  it("folgt der neuesten", () => {
    expect(pickSelection(list, "2026-10-03", true)).toBe("2026-10-04");
  });
  it("hält eine ältere Auswahl", () => {
    expect(pickSelection(list, "2026-10-03", false)).toBe("2026-10-03");
  });
  it("leere oder gelöschte Auswahl wird die neueste", () => {
    expect(pickSelection(list, null, false)).toBe("2026-10-04");
    expect(pickSelection(list, "2026-09-01", false)).toBe("2026-10-04");
  });
  it("leere Liste gibt null", () => {
    expect(pickSelection([], "2026-10-03", true)).toBeNull();
    expect(pickSelection([], null, false)).toBeNull();
  });
});

describe("fillPrompt", () => {
  it("ersetzt alle Platzhalter", () => {
    expect(fillPrompt("Lies {ordner}/ und {ordner}/x", "Briefings")).toBe("Lies Briefings/ und Briefings/x");
  });
  it("ohne Platzhalter unverändert; $ im Ordner bleibt wörtlich", () => {
    expect(fillPrompt("Hallo", "B")).toBe("Hallo");
    expect(fillPrompt("{ordner}", "a$&b")).toBe("a$&b");
  });
});
