import { describe, expect, it } from "vitest";
import { planCockpitSplit, planNewSessionPlacement } from "../src/core/cockpit-split";

// Command „Cockpit-Ansicht öffnen“ (Abend 15): links das Dashboard, rechts die Terminal-Sitzungen.
// Abend 19e (Befund 00:48): Nach dem Command liegt keine Sitzung in der Gruppe des Dashboards.
describe("planCockpitSplit", () => {
  const draussen = (sessionId: string) => ({ sessionId, inDashboardGroup: false });
  const drin = (sessionId: string) => ({ sessionId, inDashboardGroup: true });

  it("Dashboard offen und Sitzung rechts offen: beides wiederverwenden, nichts zieht um", () => {
    expect(planCockpitSplit({ dashboardOpen: true, candidates: [draussen("a")] })).toEqual({ dashboard: "reuse", terminal: { kind: "reuse", sessionId: "a", move: [] } });
  });

  it("kein Dashboard: neues Leaf, die Sitzung bleibt", () => {
    expect(planCockpitSplit({ dashboardOpen: false, candidates: [draussen("a")] })).toEqual({ dashboard: "create", terminal: { kind: "reuse", sessionId: "a", move: [] } });
  });

  it("keine offene Terminal-Sitzung: neue Claude-Sitzung im Vault", () => {
    expect(planCockpitSplit({ dashboardOpen: true, candidates: [] })).toEqual({ dashboard: "reuse", terminal: { kind: "new-session" } });
    expect(planCockpitSplit({ dashboardOpen: false, candidates: [] })).toEqual({ dashboard: "create", terminal: { kind: "new-session" } });
  });

  it("eine leere Sitzungs-ID zählt nicht als Sitzung", () => {
    expect(planCockpitSplit({ dashboardOpen: true, candidates: [draussen("")] }).terminal).toEqual({ kind: "new-session" });
    expect(planCockpitSplit({ dashboardOpen: true, candidates: [drin("")] }).terminal).toEqual({ kind: "new-session" });
    expect(planCockpitSplit({ dashboardOpen: true, candidates: [drin(""), drin("a")] }).terminal).toEqual({ kind: "move", sessionIds: ["a"] });
  });

  it("eine Sitzung liegt als Tab neben dem Dashboard: sie zieht nach rechts um (move), statt ein zweites Mal aufzugehen", () => {
    expect(planCockpitSplit({ dashboardOpen: true, candidates: [drin("a")] })).toEqual({ dashboard: "reuse", terminal: { kind: "move", sessionIds: ["a"] } });
  });

  it("drei Sitzungen in der Dashboard-Gruppe: alle drei ziehen um, in der Reihenfolge der Liste (jüngste vorn)", () => {
    expect(planCockpitSplit({ dashboardOpen: true, candidates: [drin("c"), drin("a"), drin("b")] }))
      .toEqual({ dashboard: "reuse", terminal: { kind: "move", sessionIds: ["c", "a", "b"] } });
  });

  it("Sitzungen schon rechts: nichts zieht um, die jüngste kommt nach vorn", () => {
    expect(planCockpitSplit({ dashboardOpen: true, candidates: [draussen("b"), draussen("a"), draussen("c")] }))
      .toEqual({ dashboard: "reuse", terminal: { kind: "reuse", sessionId: "b", move: [] } });
  });

  it("gemischt: nur die aus der Dashboard-Gruppe ziehen um, die jüngste draußen kommt nach vorn", () => {
    expect(planCockpitSplit({ dashboardOpen: true, candidates: [drin("c"), draussen("a"), drin("b"), draussen("d")] }))
      .toEqual({ dashboard: "reuse", terminal: { kind: "reuse", sessionId: "a", move: ["c", "b"] } });
  });

  it("ohne Sitzung spielt die Gruppe keine Rolle", () => {
    expect(planCockpitSplit({ dashboardOpen: true, candidates: [] }).terminal).toEqual({ kind: "new-session" });
  });
});

// Abend 18d/18f: eine neue Sitzung wird ein Tab in der Gruppe der jüngsten Sitzung rechts, nie in der Gruppe des Dashboards.
describe("planNewSessionPlacement", () => {
  const rechts = (sessionId: string) => ({ sessionId, inDashboardGroup: false });
  const links = (sessionId: string) => ({ sessionId, inDashboardGroup: true });

  it("jüngste Sitzung liegt rechts: Tab in ihrer Gruppe", () => {
    expect(planNewSessionPlacement({ candidates: [rechts("a")] })).toEqual({ kind: "tab", sessionId: "a" });
  });
  it("keine offene Sitzung: Split", () => {
    expect(planNewSessionPlacement({ candidates: [] })).toEqual({ kind: "split" });
  });
  it("Fehlfall vor 18f: jüngste Sitzung liegt in der Dashboard-Gruppe, keine andere offen: Split statt Tab links", () => {
    expect(planNewSessionPlacement({ candidates: [links("a")] })).toEqual({ kind: "split" });
  });
  it("jüngste liegt links, eine ältere rechts: Tab in der Gruppe der älteren, nie links", () => {
    expect(planNewSessionPlacement({ candidates: [links("a"), rechts("b"), rechts("c")] })).toEqual({ kind: "tab", sessionId: "b" });
  });
  it("mehrere rechts: die jüngste gewinnt", () => {
    expect(planNewSessionPlacement({ candidates: [rechts("b"), links("a"), rechts("c")] })).toEqual({ kind: "tab", sessionId: "b" });
  });
  it("eine leere Sitzungs-ID zählt nicht als Sitzung", () => {
    expect(planNewSessionPlacement({ candidates: [rechts("")] })).toEqual({ kind: "split" });
  });
  it("Ergebnis ist nie ein Tab einer Sitzung aus der Dashboard-Gruppe (alle Kombinationen bis 4 Sitzungen)", () => {
    for (let n = 0; n <= 4; n++) {
      for (let mask = 0; mask < 1 << n; mask++) {
        const candidates = Array.from({ length: n }, (_, i) => ({ sessionId: `s${i}`, inDashboardGroup: (mask & (1 << i)) !== 0 }));
        const plan = planNewSessionPlacement({ candidates });
        if (plan.kind === "tab") expect(candidates.find((c) => c.sessionId === plan.sessionId)?.inDashboardGroup).toBe(false);
      }
    }
  });
});
