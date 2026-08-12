import { CHIRP_PERIOD_SECONDS } from "@/helpers/sendspin-sync/chirp";
import {
  fitLatencies,
  wrapToPeriod,
  type ArrivalSample,
} from "@/helpers/sendspin-sync/latencyFit";
import { describe, expect, it } from "vitest";

const CHIRPS_PER_VISIT = 10;

interface Visit {
  playerId: string;
  /** Index of the first chirp of this visit in the server's chirp train. */
  fromChirp: number;
}

/**
 * Build arrivals that satisfy the model exactly.
 *
 * The phone's arrival time for a chirp follows from inverting
 * `wrap(at) = drift * at + offset`, which is what the fit has to undo. Solving
 * it forward rather than approximating keeps the expected answer exact, so a
 * failure means the estimator is wrong and not that the fixture was sloppy.
 */
function synthesize(
  visits: Visit[],
  offsets: Record<string, number>,
  drift: number,
): ArrivalSample[] {
  return visits.flatMap((visit, index) =>
    Array.from({ length: CHIRPS_PER_VISIT }, (_, step) => {
      const chirp = visit.fromChirp + step;
      const offset = offsets[visit.playerId];
      return {
        visit: index,
        playerId: visit.playerId,
        at: (chirp * CHIRP_PERIOD_SECONDS + offset) / (1 - drift),
      };
    }),
  );
}

/** A speaker's mean arrival phase, which is the reading a drift-blind fit gets. */
function meanPhase(samples: ArrivalSample[], playerId: string): number {
  const reference = samples[0].at;
  const phases = samples
    .filter((sample) => sample.playerId === playerId)
    .map((sample) => wrapToPeriod(sample.at - reference));
  return phases.reduce((total, value) => total + value, 0) / phases.length;
}

/** Deterministic jitter, so a failure is always reproducible. */
function jitter(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648 - 0.5;
  };
}

/** The walk the flow prescribes: each speaker in turn, the first one again last. */
const WALK: Visit[] = [
  { playerId: "living", fromChirp: 0 },
  { playerId: "kitchen", fromChirp: 60 },
  { playerId: "study", fromChirp: 120 },
  { playerId: "living", fromChirp: 180 },
];

const OFFSETS = { living: 0, kitchen: 0.012, study: -0.007 };

describe("wrapToPeriod", () => {
  it("keeps a span inside half a period either side of zero", () => {
    expect(wrapToPeriod(0.01)).toBeCloseTo(0.01, 12);
    expect(wrapToPeriod(100.01)).toBeCloseTo(0.01, 12);
    expect(wrapToPeriod(99.99)).toBeCloseTo(-0.01, 12);
    expect(wrapToPeriod(-0.01)).toBeCloseTo(-0.01, 12);
  });
});

describe("fitLatencies", () => {
  it("recovers the clock rate and every offset from exact arrivals", () => {
    const fit = fitLatencies(synthesize(WALK, OFFSETS, 40e-6));

    expect(fit).not.toBeNull();
    expect(fit!.rateErrorPpm).toBeCloseTo(40, 6);
    expect(fit!.rateRatio).toBeCloseTo(1 + 40e-6, 12);
    expect(fit!.offsetsMs.living).toBeCloseTo(0, 9);
    expect(fit!.offsetsMs.kitchen).toBeCloseTo(12, 6);
    expect(fit!.offsetsMs.study).toBeCloseTo(-7, 6);
    expect(fit!.rejected).toBe(0);
    expect(fit!.used).toBe(WALK.length * CHIRPS_PER_VISIT);
  });

  it("reports the baseline the clock rate was measured over", () => {
    const fit = fitLatencies(synthesize(WALK, OFFSETS, 40e-6))!;

    // living is measured at chirp 0 and again at chirp 180, so 90 seconds apart.
    expect(fit.bracketSpanSeconds).toBeCloseTo(90, 0);
    expect(fit.residualMs).toBeLessThan(0.001);
  });

  it("has no baseline at all when no speaker was measured twice", () => {
    const once = WALK.slice(0, 3);
    const fit = fitLatencies(synthesize(once, OFFSETS, 40e-6))!;

    expect(fit.bracketSpanSeconds).toBeNull();
    expect(fit.bracketResidualMs).toBeNull();
  });

  it("will not claim to have checked a rate that one repeat merely set", () => {
    // The single repeat is the one constraint that determines the rate, so the
    // fit absorbs any disagreement between its two readings into the rate and
    // leaves nothing behind. Reporting a near-zero residual here would read as a
    // pass for a run that was never tested.
    const shifted: Visit[] = [
      { playerId: "living", fromChirp: 0 },
      { playerId: "kitchen", fromChirp: 60 },
      { playerId: "living", fromChirp: 120 },
    ];
    const drifted = synthesize(shifted, OFFSETS, 0).map((sample, index) =>
      // The anchor's second visit reads 6 ms further out than its first.
      index >= 20 ? { ...sample, at: sample.at + 0.006 } : sample,
    );

    const fit = fitLatencies(drifted)!;
    expect(fit.bracketResidualMs).toBeNull();
    expect(fit.bracketSpanSeconds).toBeCloseTo(60, 0);
    // The shift went into the rate instead, which is exactly why it cannot be
    // seen: 100 ppm is unremarkable for a phone.
    expect(fit.rateErrorPpm).toBeCloseTo(100, 0);
  });

  it("reports a disagreement once two speakers were each measured twice", () => {
    const twice: Visit[] = [
      { playerId: "living", fromChirp: 0 },
      { playerId: "kitchen", fromChirp: 60 },
      { playerId: "living", fromChirp: 120 },
      { playerId: "kitchen", fromChirp: 180 },
    ];
    const clean = fitLatencies(synthesize(twice, OFFSETS, 40e-6))!;
    expect(clean.bracketResidualMs).not.toBeNull();
    expect(clean.bracketResidualMs!).toBeLessThan(0.001);

    // Now kitchen's second reading is 5 ms out. With one constraint more than the
    // rate can absorb, it finally shows.
    const spoiled = synthesize(twice, OFFSETS, 40e-6).map((sample, index) =>
      index >= 30 ? { ...sample, at: sample.at + 0.005 } : sample,
    );
    expect(fitLatencies(spoiled)!.bracketResidualMs!).toBeGreaterThan(1);
  });

  it("holds up when the arrivals carry detection jitter", () => {
    const noise = jitter(7);
    const samples = synthesize(WALK, OFFSETS, 40e-6).map((sample) => ({
      ...sample,
      // ±0.2 ms, comfortably worse than a matched filter's own resolution.
      at: sample.at + noise() * 4e-4,
    }));

    // Ten arrivals per visit cannot average ±0.2 ms of jitter away entirely, so
    // the bar is the one the measurement has to clear: well inside a
    // millisecond, not exact recovery.
    const fit = fitLatencies(samples)!;
    expect(Math.abs(fit.offsetsMs.kitchen - 12)).toBeLessThan(0.2);
    expect(Math.abs(fit.offsetsMs.study - -7)).toBeLessThan(0.2);
    expect(fit.rateErrorPpm).toBeCloseTo(40, 0);
  });

  it("rejects an arrival that fell on a different path", () => {
    const samples = synthesize(WALK, OFFSETS, 40e-6);
    // A reflection picked up instead of the direct arrival: plausible in
    // isolation, impossible against the rest of the visit.
    samples[15] = { ...samples[15], at: samples[15].at + 0.03 };

    const fit = fitLatencies(samples)!;
    expect(fit.rejected).toBeGreaterThanOrEqual(1);
    expect(fit.offsetsMs.kitchen).toBeCloseTo(12, 3);
    expect(fit.offsetsMs.study).toBeCloseTo(-7, 3);
  });

  it("fits the drift out, which a per-speaker average cannot", () => {
    // 120 ppm across a 100 second walk: within spec for a consumer crystal, and
    // already an order of magnitude above the offsets being measured.
    const samples = synthesize(WALK, OFFSETS, 120e-6);
    const fit = fitLatencies(samples)!;

    expect(fit.offsetsMs.kitchen).toBeCloseTo(12, 6);
    expect(fit.offsetsMs.study).toBeCloseTo(-7, 6);

    const naive =
      (meanPhase(samples, "study") - meanPhase(samples, "living")) * 1000;
    expect(Math.abs(naive - -7)).toBeGreaterThan(1);
  });

  it("survives a drift big enough to wrap the phase right round", () => {
    // 1000 ppm is the point the microphone probe starts warning at, so it is a
    // clock the flow still lets through. Across a ten minute walk the drift term
    // passes a whole period: wrapping every arrival against one fixed reference
    // would fold here and report a confident wrong answer.
    const walk: Visit[] = [
      { playerId: "living", fromChirp: 0 },
      { playerId: "kitchen", fromChirp: 300 },
      { playerId: "study", fromChirp: 600 },
      { playerId: "porch", fromChirp: 900 },
      { playerId: "living", fromChirp: 1200 },
    ];
    const offsets = { ...OFFSETS, porch: 0.019 };

    const fit = fitLatencies(synthesize(walk, offsets, 1000e-6))!;
    expect(fit.rateErrorPpm).toBeCloseTo(1000, 3);
    expect(fit.offsetsMs.kitchen).toBeCloseTo(12, 5);
    expect(fit.offsetsMs.study).toBeCloseTo(-7, 5);
    expect(fit.offsetsMs.porch).toBeCloseTo(19, 5);
    // Measured on the phone's clock, so a ten minute walk reads 0.6 s long at
    // this drift — which is the whole reason the drift has to be fitted.
    expect(fit.bracketSpanSeconds!).toBeCloseTo(600.6, 1);
  });

  it("reports nothing when the arrivals cannot determine the model", () => {
    expect(fitLatencies([])).toBeNull();
    expect(
      fitLatencies([
        { visit: 0, playerId: "living", at: 0 },
        { visit: 0, playerId: "living", at: 0.5 },
      ]),
    ).toBeNull();

    // Every arrival at one instant leaves the clock rate unidentifiable.
    expect(
      fitLatencies(
        Array.from({ length: 8 }, () => ({
          visit: 0,
          playerId: "living",
          at: 1,
        })),
      ),
    ).toBeNull();
  });

  it("summarizes each visit separately, in the order they were measured", () => {
    const fit = fitLatencies(synthesize(WALK, OFFSETS, 40e-6))!;

    expect(fit.visits.map((visit) => visit.playerId)).toEqual([
      "living",
      "kitchen",
      "study",
      "living",
    ]);
    for (const visit of fit.visits) {
      expect(visit.samples).toBe(CHIRPS_PER_VISIT);
      expect(visit.used).toBe(CHIRPS_PER_VISIT);
      expect(Math.abs(visit.meanResidualMs)).toBeLessThan(0.001);
      expect(visit.spreadMs).toBeLessThan(0.001);
    }
  });
});
