import { describe, expect, it } from "vitest";
import {
  MAX_RULES_PER_FILTER, escapeGlob, excludedTargets, exclusionNotice, exclusionRules, exclusionSettings, isExcluded,
  parseIgnoreFilters, planExclusion, type ExclusionTargets,
} from "../src/core/exclusion";

const V = "/Users/x/Vault";
const e = (path: string, folder = false) => ({ path, folder });
const filters = (raw: unknown) => parseIgnoreFilters(raw).filters;
const T = (p: Partial<ExclusionTargets>): ExclusionTargets => ({ prefixes: [], folders: [], files: [], skipped: [], active: 0, ...p });

describe("parseIgnoreFilters (Regeln wie Obsidian 1.14.4)", () => {
  it("liest Pfadanfang und Muster, trimmt, lässt Leeres weg", () => {
    const r = parseIgnoreFilters([" Vertraulich/ ", "/\\.pdf$/", "", "  "]);
    expect(r.errors).toEqual([]);
    expect(r.filters.map((f) => [f.kind, f.text])).toEqual([["prefix", "Vertraulich/"], ["regex", "/\\.pdf$/"]]);
  });
  it("// ist ein Pfadanfang, /a/ ein Muster", () => {
    expect(filters(["//", "/a/"]).map((f) => f.kind)).toEqual(["prefix", "regex"]);
  });
  it("ohne Groß-/Kleinschreibung", () => {
    const [p, r] = filters(["vertraulich/", "/GEHEIM/"]);
    expect(p.re.test("Vertraulich/a.md")).toBe(true);
    expect(r.re.test("akte-geheim.md")).toBe(true);
  });
  it("Pfadanfang ist wörtlich und nur am Anfang", () => {
    const [p] = filters(["a.b"]);
    expect(p.re.test("a.b.md")).toBe(true);
    expect(p.re.test("axb.md")).toBe(false);
    expect(p.re.test("x/a.b.md")).toBe(false);
  });
  it("ungültiges Muster wird gemeldet, die übrigen gelten", () => {
    const r = parseIgnoreFilters(["/[/", "Privat/"]);
    expect(r.filters.map((f) => f.text)).toEqual(["Privat/"]);
    expect(r.errors).toEqual(["ungültiges Muster /[/"]);
  });
  it("fehlend ist leer, Nicht-Liste und Nicht-Text sind Fehler", () => {
    expect(parseIgnoreFilters(undefined)).toEqual({ filters: [], errors: [] });
    expect(parseIgnoreFilters(null)).toEqual({ filters: [], errors: [] });
    expect(parseIgnoreFilters("Privat/").errors).toEqual(["Ausschlussliste ist keine Liste"]);
    const r = parseIgnoreFilters([3, "Privat/"]);
    expect(r.errors).toEqual(["kein Text: 3"]);
    expect(r.filters.map((f) => f.text)).toEqual(["Privat/"]);
  });
});

describe("excludedTargets", () => {
  const entries = [
    e("Vertraulich", true), e("Vertraulich/a.md"), e("Vertraulich/Sub", true), e("Vertraulich/Sub/b.md"),
    e("Vertraulich.md"), e("Vertraulichkeit", true), e("Vertraulichkeit/x.md"),
    e("Offen", true), e("Offen/c.md"), e("Offen/d.pdf"), e("Scan.PDF"),
  ];
  it("Pfadanfang in eingetragener Schreibweise braucht keine Einzelregel", () => {
    expect(excludedTargets(filters(["Vertraulich/"]), entries)).toEqual(T({ prefixes: ["Vertraulich/"], active: 1 }));
  });
  it("abweichende Schreibweise: Regel in echter Schreibweise, Ordner verdeckt Unterpfade", () => {
    expect(excludedTargets(filters(["vertraulich/"]), entries))
      .toEqual(T({ prefixes: ["vertraulich/"], folders: ["Vertraulich"], active: 1 }));
  });
  it("Pfadanfang ohne Schrägstrich trifft gleich beginnende Dateien und Ordner", () => {
    expect(excludedTargets(filters(["vertraulich"]), entries))
      .toEqual(T({ prefixes: ["vertraulich"], folders: ["Vertraulich", "Vertraulichkeit"], files: ["Vertraulich.md"], active: 1 }));
  });
  it("Muster gilt nur für Dateien, auch ohne Groß-/Kleinschreibung", () => {
    expect(excludedTargets(filters(["/\\.pdf$/"]), entries)).toEqual(T({ files: ["Offen/d.pdf", "Scan.PDF"], active: 1 }));
  });
  it("Muster auf einen Ordnernamen sperrt die Dateien darin einzeln", () => {
    expect(excludedTargets(filters(["/^offen\\//"]), entries)).toEqual(T({ files: ["Offen/c.md", "Offen/d.pdf"], active: 1 }));
  });
  it("mehrere Einträge: sortiert, ohne Doppelte", () => {
    expect(excludedTargets(filters(["/\\.pdf$/", "/^offen\\//"]), entries))
      .toEqual(T({ files: ["Offen/c.md", "Offen/d.pdf", "Scan.PDF"], active: 2 }));
  });
  it(`genau ${MAX_RULES_PER_FILTER} Einzelpfade gehen noch`, () => {
    const many = Array.from({ length: MAX_RULES_PER_FILTER }, (_, i) => e(`Scans/s${i}.pdf`));
    expect(excludedTargets(filters(["/\\.pdf$/"]), many).files).toHaveLength(MAX_RULES_PER_FILTER);
  });
  it(`mehr als ${MAX_RULES_PER_FILTER} Einzelpfade: Eintrag wird nicht gesperrt, die übrigen schon`, () => {
    const many = Array.from({ length: MAX_RULES_PER_FILTER + 1 }, (_, i) => e(`Scans/s${i}.pdf`));
    expect(excludedTargets(filters(["/\\.pdf$/", "Privat/"]), many))
      .toEqual(T({ prefixes: ["Privat/"], skipped: [`/\\.pdf$/ (${MAX_RULES_PER_FILTER + 1} Einzelpfade)`], active: 1 }));
  });
  it("auch ein Pfadanfang mit zu vielen abweichend geschriebenen Treffern fällt ganz weg", () => {
    const many = Array.from({ length: MAX_RULES_PER_FILTER + 1 }, (_, i) => e(`PRIVAT/f${i}.md`));
    expect(excludedTargets(filters(["privat/"]), many))
      .toEqual(T({ skipped: [`privat/ (${MAX_RULES_PER_FILTER + 1} Einzelpfade)`] }));
  });
  it(`Ordner mit mehr als ${MAX_RULES_PER_FILTER} Dateien: gezählt wird nach dem Zusammenfassen, eine Ordnerregel genügt`, () => {
    const many = [e("Vertraulich", true), ...Array.from({ length: MAX_RULES_PER_FILTER + 1 }, (_, i) => e(`Vertraulich/f${i}.md`))];
    expect(excludedTargets(filters(["vertraulich/"]), many))
      .toEqual(T({ prefixes: ["vertraulich/"], folders: ["Vertraulich"], active: 1 }));
  });
  it(`auch mehr als ${MAX_RULES_PER_FILTER} Unterordner unter einem Treffer zählen als eine Regel`, () => {
    const many = [
      e("Vertraulich", true), e("Vertraulich/s0/x.md"),
      ...Array.from({ length: MAX_RULES_PER_FILTER + 1 }, (_, i) => e(`Vertraulich/s${i}`, true)),
    ];
    expect(excludedTargets(filters(["vertraulich/"]), many))
      .toEqual(T({ prefixes: ["vertraulich/"], folders: ["Vertraulich"], active: 1 }));
  });
  it("Einträge überlappen: Dateien unter einem gesperrten Ordner brauchen keine eigene Regel", () => {
    const some = [e("Vertraulich", true), e("Vertraulich/a.md"), e("Offen/b.md")];
    expect(excludedTargets(filters(["vertraulich/", "/\\.md$/"]), some))
      .toEqual(T({ prefixes: ["vertraulich/"], folders: ["Vertraulich"], files: ["Offen/b.md"], active: 2 }));
  });
});

describe("exclusionRules", () => {
  it("Pfadanfang mit Schrägstrich: ein Muster, Read und Edit, absolut mit //", () => {
    expect(exclusionRules(V, T({ prefixes: ["Vertraulich/"], active: 1 })))
      .toEqual(["Edit(//Users/x/Vault/Vertraulich/**)", "Read(//Users/x/Vault/Vertraulich/**)"]);
  });
  it("Pfadanfang ohne Schrägstrich: Dateien und Ordner mit diesem Anfang", () => {
    expect(exclusionRules(V, T({ prefixes: ["Privat"], active: 1 }))).toEqual([
      "Edit(//Users/x/Vault/Privat*)", "Edit(//Users/x/Vault/Privat*/**)",
      "Read(//Users/x/Vault/Privat*)", "Read(//Users/x/Vault/Privat*/**)",
    ]);
  });
  it("Ordner und Dateien einzeln, Glob-Zeichen maskiert (außer ?), Leerzeichen bleiben, Schrägstrich am Vault-Ende egal", () => {
    expect(exclusionRules("/Users/x/Mein Vault/", T({ folders: ["Akte [alt] *"], files: ["Plan {a}?.md", "Notizen (alt)/n.md"], active: 1 }))).toEqual([
      "Edit(//Users/x/Mein Vault/Akte \\[alt\\] \\*/**)",
      "Edit(//Users/x/Mein Vault/Notizen \\(alt\\)/n.md)",
      "Edit(//Users/x/Mein Vault/Plan \\{a\\}?.md)",
      "Read(//Users/x/Mein Vault/Akte \\[alt\\] \\*/**)",
      "Read(//Users/x/Mein Vault/Notizen \\(alt\\)/n.md)",
      "Read(//Users/x/Mein Vault/Plan \\{a\\}?.md)",
    ]);
  });
  it("leer ergibt keine Regeln", () => {
    expect(exclusionRules(V, T({}))).toEqual([]);
  });
  it("escapeGlob maskiert auch Backslash und Ausrufezeichen", () => {
    expect(escapeGlob("a\\b!c")).toBe("a\\\\b\\!c");
  });
  it("escapeGlob lässt ? unmaskiert (claude trifft \\? und [?] nicht wörtlich), maskiert die übrigen Zeichen", () => {
    expect(escapeGlob("a?b")).toBe("a?b");
    expect(escapeGlob("\\*?[]{}()!")).toBe("\\\\\\*?\\[\\]\\{\\}\\(\\)\\!");
  });
});

describe("exclusionSettings", () => {
  it("ohne Regeln leer, auch mit Sandbox", () => {
    expect(exclusionSettings([], true)).toEqual({});
  });
  it("Regeln ohne Sandbox", () => {
    expect(exclusionSettings(["Read(//a/**)"], false)).toEqual({ permissions: { deny: ["Read(//a/**)"] } });
  });
  it("Regeln mit Sandbox, ohne Ausweg aus der Sandbox", () => {
    expect(exclusionSettings(["Read(//a/**)"], true)).toEqual({
      permissions: { deny: ["Read(//a/**)"] },
      sandbox: { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false },
    });
  });
});

describe("exclusionNotice", () => {
  const base = { active: 0, skipped: [], errors: [], sandbox: false };
  it("nichts eingetragen: keine Zeile", () => {
    expect(exclusionNotice(base)).toBeNull();
  });
  it("Einzahl ohne Sandbox", () => {
    expect(exclusionNotice({ ...base, active: 1 })).toBe("Ausschluss aktiv: 1 Eintrag gesperrt, Shell-Befehle wie grep -r nicht (Sandbox aus).");
  });
  it("Mehrzahl mit Sandbox", () => {
    expect(exclusionNotice({ ...base, active: 3, sandbox: true })).toBe("Ausschluss aktiv: 3 Einträge gesperrt, auch Shell-Befehle (Sandbox an).");
  });
  it("übersprungene und fehlerhafte Einträge stehen dahinter", () => {
    expect(exclusionNotice({ ...base, active: 1, skipped: ["/x/ (501 Einzelpfade)"], errors: ["ungültiges Muster /[/"] })).toBe(
      "Ausschluss aktiv: 1 Eintrag gesperrt, Shell-Befehle wie grep -r nicht (Sandbox aus). Nicht gesperrt: /x/ (501 Einzelpfade). Fehler in der Ausschlussliste: ungültiges Muster /[/.",
    );
  });
  it("nur Fehler: nichts gesperrt", () => {
    expect(exclusionNotice({ ...base, errors: ["ungültiges Muster /[/"] })).toBe("Ausschluss: nichts gesperrt. Fehler in der Ausschlussliste: ungültiges Muster /[/.");
  });
  it("Lesefehler geht vor", () => {
    expect(exclusionNotice({ ...base, active: 2, failure: "ENOENT" })).toBe("Ausschluss NICHT aktiv: app.json nicht lesbar (ENOENT).");
  });
});

describe("isExcluded (für die IDE-Brücke, wie Obsidians isUserIgnored)", () => {
  it("prüft vault-relative Pfade gegen alle Einträge", () => {
    const f = filters(["vertraulich/", "/\\.pdf$/"]);
    expect(isExcluded(f, "Vertraulich/a.md")).toBe(true);
    expect(isExcluded(f, "Offen/scan.PDF")).toBe(true);
    expect(isExcluded(f, "Offen/a.md")).toBe(false);
    expect(isExcluded([], "Vertraulich/a.md")).toBe(false);
  });
});

describe("planExclusion", () => {
  const input = { enabled: true, sandbox: false, raw: ["Vertraulich/"], entries: [e("Vertraulich", true), e("Vertraulich/a.md")], vaultAbs: V };
  it("aus: nichts, auch keine Zeile", () => {
    expect(planExclusion({ ...input, enabled: false })).toEqual({ settings: {}, notice: null, filters: [] });
  });
  it("an: Regeln, Zeile, Filter für die Brücke", () => {
    const p = planExclusion(input);
    expect(p.settings).toEqual({ permissions: { deny: ["Edit(//Users/x/Vault/Vertraulich/**)", "Read(//Users/x/Vault/Vertraulich/**)"] } });
    expect(p.notice).toBe("Ausschluss aktiv: 1 Eintrag gesperrt, Shell-Befehle wie grep -r nicht (Sandbox aus).");
    expect(p.filters.map((f) => f.text)).toEqual(["Vertraulich/"]);
  });
  it("Ordner in abweichender Schreibweise: Regel für den Ordner statt Hunderter Dateiregeln", () => {
    const many = [e("Vertraulich", true), ...Array.from({ length: MAX_RULES_PER_FILTER + 1 }, (_, i) => e(`Vertraulich/f${i}.md`))];
    const p = planExclusion({ ...input, raw: ["vertraulich/"], entries: many });
    expect(p.settings).toEqual({
      permissions: {
        deny: [
          "Edit(//Users/x/Vault/Vertraulich/**)", "Edit(//Users/x/Vault/vertraulich/**)",
          "Read(//Users/x/Vault/Vertraulich/**)", "Read(//Users/x/Vault/vertraulich/**)",
        ],
      },
    });
    expect(p.notice).toBe("Ausschluss aktiv: 1 Eintrag gesperrt, Shell-Befehle wie grep -r nicht (Sandbox aus).");
  });
  it("Sandbox nur mit Regeln", () => {
    expect(planExclusion({ ...input, sandbox: true }).settings).toHaveProperty("sandbox");
    const leer = planExclusion({ ...input, sandbox: true, raw: undefined });
    expect(leer).toEqual({ settings: {}, notice: null, filters: [] });
  });
  it("Muster ohne Treffer: Eintrag zählt, aber keine Regel und keine Sandbox", () => {
    const p = planExclusion({ ...input, sandbox: true, raw: ["/\\.pdf$/"] });
    expect(p.settings).toEqual({});
    expect(p.notice).toBe("Ausschluss aktiv: 1 Eintrag gesperrt, Shell-Befehle wie grep -r nicht (Sandbox aus).");
  });
  it("Lesefehler: keine Regeln, Warnzeile", () => {
    expect(planExclusion({ ...input, failure: "Unexpected token" }))
      .toEqual({ settings: {}, notice: "Ausschluss NICHT aktiv: app.json nicht lesbar (Unexpected token).", filters: [] });
  });
});

describe("Größe (Review Focus)", () => {
  it("20.000 Pfade samt Ordnern und drei Einträge unter 500 ms, mit Treffern", () => {
    // Wie getAllLoadedFiles(): Ordner und Dateien. Jeder 10. liegt unter Vertraulich/ (2000), jeder 40. (versetzt, nicht unter Vertraulich/)
    // endet auf .pdf (500), der Rest ist Ordner${i % 50}/n${i}.md.
    const folders = ["Vertraulich", ...Array.from({ length: 50 }, (_, i) => `Ordner${i}`)].map((p) => e(p, true));
    const files = Array.from({ length: 20_000 }, (_, i) => e(`${i % 10 === 0 ? "Vertraulich" : `Ordner${i % 50}`}/n${i}.${i % 40 === 5 ? "pdf" : "md"}`));
    const entries = [...folders, ...files];
    const t0 = performance.now();
    const plan = planExclusion({ enabled: true, sandbox: false, raw: ["vertraulich/", "/\\.pdf$/", "Archiv"], entries, vaultAbs: V });
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(500);
    // "vertraulich/" trifft Ordner und 2000 Dateien in anderer Schreibweise: eine Ordnerregel genügt, der Eintrag ist gesperrt.
    // Das Muster (genau 500 Dateien, je Read und Edit) und der Pfadanfang "Archiv" (zwei Musterregeln, je Read und Edit) gelten ebenso.
    const deny = (plan.settings.permissions as { deny: string[] }).deny;
    expect(deny).toHaveLength(4 + 4 + 2 * MAX_RULES_PER_FILTER);
    expect(deny).toContain("Read(//Users/x/Vault/Vertraulich/**)");
    expect(deny).toContain("Edit(//Users/x/Vault/Vertraulich/**)");
    expect(deny.filter((r) => r.includes("/Vertraulich/n"))).toEqual([]);
    expect(deny).toContain("Read(//Users/x/Vault/Archiv*)");
    expect(deny).toContain("Read(//Users/x/Vault/Ordner5/n5.pdf)");
    expect(deny).toContain("Edit(//Users/x/Vault/Ordner15/n19965.pdf)");
    expect(plan.notice).toBe("Ausschluss aktiv: 3 Einträge gesperrt, Shell-Befehle wie grep -r nicht (Sandbox aus).");
    expect(plan.filters).toHaveLength(3);
  });
  it("viele Ordner: 3000 Ordner und 30.000 Dateien unter 500 ms (Zusammenfassen schlägt nach, vergleicht nicht mit jedem Ordner)", () => {
    const entries = [
      ...Array.from({ length: 3000 }, (_, i) => e(`Ordner${i}`, true)),
      ...Array.from({ length: 30_000 }, (_, i) => e(`Ordner${i % 3000}/n${i}.md`)),
    ];
    const t0 = performance.now();
    const t = excludedTargets(filters(["ordner"]), entries);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(500);
    expect(t).toEqual(T({ skipped: ["ordner (3000 Einzelpfade)"] }));
  });
});
