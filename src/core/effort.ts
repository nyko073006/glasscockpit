import { EFFORT_STEPS } from "./constants";

export type EffortStep = (typeof EFFORT_STEPS)[number];

export function isEffortStep(v: unknown): v is EffortStep {
  return typeof v === "string" && (EFFORT_STEPS as readonly string[]).includes(v);
}

/** Argumente für die nächste Claude-Sitzung: `aus` heißt kein Flag (es gilt settings.json), sonst `--effort <stufe>`. */
export function effortArgs(step: EffortStep): string[] {
  return step === "aus" ? [] : ["--effort", step];
}
