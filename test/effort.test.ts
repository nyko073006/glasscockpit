import { describe, expect, it } from "vitest";
import { effortArgs, isEffortStep } from "../src/core/effort";
import { EFFORT_STEPS } from "../src/core/constants";

describe("effort", () => {
  it("Stufen in dieser Reihenfolge", () => {
    expect([...EFFORT_STEPS]).toEqual(["aus", "low", "medium", "high", "xhigh", "max"]);
  });
  it("aus ergibt kein Flag, sonst --effort <stufe>", () => {
    expect(effortArgs("aus")).toEqual([]);
    for (const s of ["low", "medium", "high", "xhigh", "max"] as const) expect(effortArgs(s)).toEqual(["--effort", s]);
  });
  it("effortArgs liefert jedes Mal ein neues Array", () => {
    const a = effortArgs("aus");
    a.push("x");
    expect(effortArgs("aus")).toEqual([]);
  });
  it("isEffortStep", () => {
    for (const s of EFFORT_STEPS) expect(isEffortStep(s)).toBe(true);
    for (const v of ["Aus", "ultra", "", null, undefined, 3, "toString"]) expect(isEffortStep(v)).toBe(false);
  });
});
