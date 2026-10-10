/**
 * Command „Cockpit-Ansicht öffnen“ (Abend 15), reine Entscheidung: links das Dashboard, rechts die Terminal-Sitzungen.
 * Die Mechanik (Leaves teilen, anzeigen) liegt im Plugin; hier steht nur, was wiederverwendet wird und was umzieht.
 * Regel seit Abend 19e: Nach dem Command liegt keine Sitzung in der Gruppe des Dashboards.
 */
export interface SplitCandidate {
  sessionId: string;
  /** Liegt der Tab dieser Sitzung in derselben Gruppe wie das Dashboard (dann stünden beide als Tabs im selben Bereich)? */
  inDashboardGroup: boolean;
}

export interface SplitInput {
  /** Gibt es schon ein Dashboard-Leaf? Dann wird es wiederverwendet. */
  dashboardOpen: boolean;
  /** Offene Terminal-Sitzungen mit Tab (RecentSessions), jüngste zuerst. */
  candidates: readonly SplitCandidate[];
}

export type SplitPlan = {
  dashboard: "reuse" | "create";
  /**
   * reuse: die jüngste Sitzung außerhalb der Dashboard-Gruppe kommt nach vorn (kein zweiter Tab derselben Sitzung); liegen
   * weitere Sitzungen in der Dashboard-Gruppe (move), ziehen sie als Tabs in deren Gruppe um.
   * move: alle Sitzungen liegen in der Gruppe des Dashboards: die erste zieht in einen neuen Split rechts davon um, die übrigen
   * als Tabs in dessen Gruppe, in der Reihenfolge der Liste (jüngste vorn); der alte Tab geht jeweils zu (kein Doppel).
   * new-session: claude im Vault.
   */
  terminal:
    | { kind: "reuse"; sessionId: string; move: string[] }
    | { kind: "move"; sessionIds: string[] }
    | { kind: "new-session" };
};

export function planCockpitSplit(input: SplitInput): SplitPlan {
  const dashboard = input.dashboardOpen ? "reuse" : "create";
  const sessions = input.candidates.filter((c) => c.sessionId !== "");
  const outside = sessions.find((c) => !c.inDashboardGroup);
  const inGroup = sessions.filter((c) => c.inDashboardGroup).map((c) => c.sessionId);
  if (outside) return { dashboard, terminal: { kind: "reuse", sessionId: outside.sessionId, move: inGroup } };
  if (inGroup.length > 0) return { dashboard, terminal: { kind: "move", sessionIds: inGroup } };
  return { dashboard, terminal: { kind: "new-session" } };
}

/** Eine offene Sitzung mit auffindbarem Leaf (Tab). */
export interface PlacementCandidate {
  sessionId: string;
  /** Liegt ihr Tab in derselben Gruppe wie das Dashboard? */
  inDashboardGroup: boolean;
}

export interface NewSessionPlacementInput {
  /** Offene Sitzungen mit bekanntem Leaf, jüngste zuerst (RecentSessions). Hintergrund-Tabs zählen, sobald ihr Leaf bekannt ist. */
  candidates: readonly PlacementCandidate[];
}

/** tab: neuer Tab in der Gruppe dieser Sitzung; split: vertikaler Split (rechts neben dem Dashboard, sonst vom aktiven Leaf). */
export type NewSessionPlacement = { kind: "tab"; sessionId: string } | { kind: "split" };

/**
 * Wohin eine neue Sitzung kommt (Abend 18d, korrigiert 18f): als Tab in die Gruppe der jüngsten offenen Sitzung, die NICHT
 * in der Gruppe des Dashboards liegt; gibt es keine, ein Split. Nie ein Tab in der Dashboard-Gruppe: links bleibt das Cockpit.
 */
export function planNewSessionPlacement(input: NewSessionPlacementInput): NewSessionPlacement {
  const target = input.candidates.find((c) => c.sessionId !== "" && !c.inDashboardGroup);
  return target ? { kind: "tab", sessionId: target.sessionId } : { kind: "split" };
}
