import { describe, expect, it } from "vitest";
import { RECENT_SKILLS_MAX } from "../src/core/constants";
import type { LaunchEntry } from "../src/core/discovery";
import { filterSkills, pushRecent, rankSkills } from "../src/core/recents";

const skill = (name: string, description = ""): LaunchEntry => ({ kind: "skill", name, description, source: "user" });

describe("pushRecent", () => {
  it("neuer Name steht vorn", () => expect(pushRecent(["a", "b"], "c")).toEqual(["c", "a", "b"]));
  it("Dopplung wandert nach vorn, nicht doppelt", () => expect(pushRecent(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]));
  it("Vorgabe ist die Grenze 30", () => {
    expect(RECENT_SKILLS_MAX).toBe(30);
    const voll = Array.from({ length: 30 }, (_, i) => `s${i}`);
    const r = pushRecent(voll, "neu");
    expect(r).toHaveLength(30);
    expect(r[0]).toBe("neu");
    expect(r).not.toContain("s29");
  });
  it("eigene Grenze", () => expect(pushRecent(["a", "b", "c"], "d", 2)).toEqual(["d", "a"]));
  it("Eingabe wird nicht verändert", () => {
    const eingabe = Object.freeze(["a", "b"]) as readonly string[];
    pushRecent(eingabe, "b");
    expect(eingabe).toEqual(["a", "b"]);
  });
});

describe("rankSkills", () => {
  const alle = [skill("zebra"), skill("Äpfel"), skill("apfel"), skill("mango"), skill("Birne")];

  it("zuletzt benutzte zuerst, in Recents-Reihenfolge", () => {
    expect(rankSkills(alle, ["mango", "zebra"]).slice(0, 2).map((s) => s.name)).toEqual(["mango", "zebra"]);
  });
  it("verschwundene Recents werden ignoriert", () => {
    expect(rankSkills(alle, ["weg", "mango"]).map((s) => s.name)[0]).toBe("mango");
    expect(rankSkills(alle, ["weg"])).toHaveLength(5);
  });
  it("Rest alphabetisch, Umlaut und Groß/Klein ohne Rolle", () => {
    const rest = rankSkills(alle, ["mango"]).slice(1).map((s) => s.name);
    expect(rest).toEqual(["apfel", "Äpfel", "Birne", "zebra"]);
  });
  it("ohne Recents alles alphabetisch, Eingabe unverändert", () => {
    const kopie = [...alle];
    expect(rankSkills(alle, []).map((s) => s.name)).toEqual(["apfel", "Äpfel", "Birne", "mango", "zebra"]);
    expect(alle).toEqual(kopie);
  });
});

describe("filterSkills", () => {
  const ranked = [skill("plan-tag", "Tagesplan"), skill("lint", "Vault prüfen"), skill("Council", "Entscheidung")];
  it("Teilstring im Namen, ohne Groß/Klein", () => expect(filterSkills(ranked, "COUN").map((s) => s.name)).toEqual(["Council"]));
  it("Teilstring in der Beschreibung", () => expect(filterSkills(ranked, "vault").map((s) => s.name)).toEqual(["lint"]));
  it("Reihenfolge bleibt", () => expect(filterSkills(ranked, "n").map((s) => s.name)).toEqual(["plan-tag", "lint", "Council"]));
  it("leere Suche (auch Leerzeichen) = alle", () => {
    expect(filterSkills(ranked, "")).toEqual(ranked);
    expect(filterSkills(ranked, "  ")).toEqual(ranked);
  });
  it("kein Treffer", () => expect(filterSkills(ranked, "xyz")).toEqual([]));
});
