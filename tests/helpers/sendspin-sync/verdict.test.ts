import type { LatencyFit, VisitFit } from "@/helpers/sendspin-sync/latencyFit";
import {
  isApplicable,
  runVerdict,
  worstSpreadMs,
} from "@/helpers/sendspin-sync/verdict";
import { describe, expect, it } from "vitest";

const SELECTED = ["living", "kitchen"];

function visit(overrides: Partial<VisitFit> = {}): VisitFit {
  return {
    visit: 0,
    playerId: "living",
    samples: 10,
    used: 10,
    meanResidualMs: 0,
    spreadMs: 0.05,
    ...overrides,
  };
}

/** A run that came out well, which each case below spoils in one way. */
function fitFixture(overrides: Partial<LatencyFit> = {}): LatencyFit {
  return {
    offsetsMs: { living: 0, kitchen: 12 },
    rateRatio: 1.00004,
    rateErrorPpm: 40,
    residualMs: 0.05,
    scatterMs: { living: 0.05, kitchen: 0.05 },
    bracketSpanSeconds: 90,
    bracketResidualMs: null,
    runSpanSeconds: 100,
    visits: [visit(), visit({ visit: 1, playerId: "kitchen" })],
    used: 20,
    rejected: 0,
    ...overrides,
  };
}

describe("runVerdict", () => {
  it("says the rate is pinned when one repeat set it and nothing is wrong", () => {
    const verdict = runVerdict(fitFixture(), SELECTED);

    expect(verdict).toBe("pinned");
    expect(isApplicable(verdict)).toBe(true);
  });

  it("refuses a rate no clock could have, ahead of everything else", () => {
    // One chirp period misassigned across a two and a half minute walk. Worst
    // first, and this is the worst there is: the arrivals were reconciled onto
    // the wrong chirp, so the missing speaker and the scatter it also shows are
    // symptoms rather than the fault.
    const verdict = runVerdict(
      fitFixture({
        rateErrorPpm: -3318.7,
        offsetsMs: { living: 0 },
        residualMs: 17.03,
      }),
      SELECTED,
    );

    expect(verdict).toBe("irreconcilable");
    expect(isApplicable(verdict)).toBe(false);
  });

  it("lets a poor but possible clock through to the other checks", () => {
    // The microphone probe calls 1000 ppm degraded and still lets the run go
    // ahead, so the refusal has to sit above it rather than duplicate it.
    expect(runVerdict(fitFixture({ rateErrorPpm: 1000 }), SELECTED)).toBe(
      "pinned",
    );
  });

  it("names an unheard speaker ahead of anything else that is wrong", () => {
    // Worst first: a missing speaker makes the whole result actively harmful, so
    // it is reported even though this run is also unbracketed and scattered.
    const verdict = runVerdict(
      fitFixture({
        offsetsMs: { living: 0 },
        bracketSpanSeconds: null,
        residualMs: 9,
      }),
      SELECTED,
    );

    expect(verdict).toBe("unmeasured");
    expect(isApplicable(verdict)).toBe(false);
  });

  it("refuses a run where nothing was measured twice", () => {
    expect(runVerdict(fitFixture({ bracketSpanSeconds: null }), SELECTED)).toBe(
      "unbracketed",
    );
  });

  it("refuses a bracket too short to pin the rate over the run", () => {
    // Half the run is the bar, so these two sit either side of it.
    expect(
      runVerdict(
        fitFixture({ bracketSpanSeconds: 40, runSpanSeconds: 100 }),
        SELECTED,
      ),
    ).toBe("short_bracket");
    expect(
      runVerdict(
        fitFixture({ bracketSpanSeconds: 60, runSpanSeconds: 100 }),
        SELECTED,
      ),
    ).toBe("pinned");
  });

  it("refuses a run whose arrivals do not sit on the line", () => {
    expect(runVerdict(fitFixture({ residualMs: 1.5 }), SELECTED)).toBe(
      "scattered",
    );
  });

  it("catches one spoiled reading the run-wide figure cannot see", () => {
    // `residualMs` is a median across every arrival, so a single bad speaker out
    // of several leaves it untouched. Its own spread is what shows it up.
    const verdict = runVerdict(
      fitFixture({
        residualMs: 0.05,
        visits: [
          visit(),
          visit({ visit: 1, playerId: "kitchen", spreadMs: 4 }),
        ],
      }),
      SELECTED,
    );

    expect(verdict).toBe("scattered");
    expect(isApplicable(verdict)).toBe(false);
  });

  it("reports a genuine cross-check, in both directions", () => {
    expect(runVerdict(fitFixture({ bracketResidualMs: 0.4 }), SELECTED)).toBe(
      "checked",
    );
    expect(runVerdict(fitFixture({ bracketResidualMs: 2 }), SELECTED)).toBe(
      "disagrees",
    );
  });

  it("prefers a disagreement over the scatter it also causes", () => {
    // Repeats that disagree also widen the scatter, and "walk it again" is more
    // use to the reader than "something moved".
    expect(
      runVerdict(fitFixture({ bracketResidualMs: 3, residualMs: 2 }), SELECTED),
    ).toBe("disagrees");
  });

  it("only lets a pinned or checked run be applied", () => {
    expect(isApplicable("pinned")).toBe(true);
    expect(isApplicable("checked")).toBe(true);
    for (const verdict of [
      "irreconcilable",
      "unmeasured",
      "unbracketed",
      "short_bracket",
      "scattered",
      "disagrees",
    ] as const)
      expect(isApplicable(verdict)).toBe(false);
  });
});

describe("worstSpreadMs", () => {
  it("is the widest spread of any single reading", () => {
    expect(
      worstSpreadMs(
        fitFixture({
          visits: [
            visit({ spreadMs: 0.2 }),
            visit({ visit: 1, spreadMs: 3.5 }),
          ],
        }),
      ),
    ).toBe(3.5);
  });

  it("is zero when there is nothing to judge", () => {
    expect(worstSpreadMs(fitFixture({ visits: [] }))).toBe(0);
  });
});
