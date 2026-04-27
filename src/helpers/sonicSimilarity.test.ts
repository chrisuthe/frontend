import { describe, expect, it } from "vitest";
import { calculateCoveragePercent } from "./sonicSimilarity";

describe("calculateCoveragePercent", () => {
  it("returns null when indexSize is undefined", () => {
    expect(calculateCoveragePercent(undefined, 100)).toBeNull();
  });

  it("returns null when totalAnalyzed is undefined", () => {
    expect(calculateCoveragePercent(50, undefined)).toBeNull();
  });

  it("returns null when totalAnalyzed is zero", () => {
    expect(calculateCoveragePercent(50, 0)).toBeNull();
  });

  it("returns null when totalAnalyzed is negative", () => {
    expect(calculateCoveragePercent(50, -1)).toBeNull();
  });

  it("returns 0 when indexSize is zero and total is positive", () => {
    expect(calculateCoveragePercent(0, 100)).toBe(0);
  });

  it("rounds to nearest whole percent", () => {
    expect(calculateCoveragePercent(33, 100)).toBe(33);
    expect(calculateCoveragePercent(335, 1000)).toBe(34);
  });

  it("clamps to 100 when indexSize exceeds totalAnalyzed", () => {
    expect(calculateCoveragePercent(150, 100)).toBe(100);
  });

  it("returns 100 for exact equality", () => {
    expect(calculateCoveragePercent(100, 100)).toBe(100);
  });
});
