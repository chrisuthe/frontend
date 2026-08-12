/**
 * What a finished calibration run can honestly say about itself.
 *
 * One place decides this, because two consumers ask: the results panel, to say
 * what happened, and the run, to decide whether the offsets may be applied. Split
 * across both they would eventually disagree, and the disagreement would show up
 * as a panel warning next to an enabled Apply button.
 *
 * The order the checks run in is the order of severity, so the worst thing wrong
 * with a run is the thing the user is told about.
 */

import { MAX_PLAUSIBLE_RATE_PPM, type LatencyFit } from "./latencyFit";

export type RunVerdict =
  /** The arrivals only fit a clock rate no clock could have. */
  | "irreconcilable"
  /** A speaker the run set out to measure was never heard. */
  | "unmeasured"
  /** No speaker was measured twice, so the clock rate rests on seconds. */
  | "unbracketed"
  /** Measured twice, but too close together to pin the clock rate down. */
  | "short_bracket"
  /** The arrivals do not sit on the fitted line. */
  | "scattered"
  /** Enough repeats to test the clock rate, and they disagree. */
  | "disagrees"
  /** Enough repeats to test the clock rate, and they agree. */
  | "checked"
  /** The clock rate is pinned down, but one repeat cannot also test it. */
  | "pinned";

/** How far repeated readings of one speaker may disagree, in milliseconds. */
export const BRACKET_LIMIT_MS = 1;

/**
 * How far the arrivals may scatter about the fitted line, in milliseconds.
 *
 * A matched filter on a clean recording lands well inside a tenth of this.
 */
export const SCATTER_LIMIT_MS = 1;

/**
 * How far one speaker's own arrivals may spread within a single reading.
 *
 * Checked per reading as well as across the run, because the run-wide figure is a
 * median: one spoiled speaker out of six leaves it untouched.
 */
export const VISIT_SPREAD_LIMIT_MS = 1;

/**
 * How much of the run the bracketing readings must span.
 *
 * The offset error the fitted clock rate injects is roughly its own uncertainty
 * times the length of the run, and that uncertainty falls with the baseline the
 * rate was measured over. So what matters is the *ratio* of the two, not merely
 * that a speaker was measured twice: two readings ten seconds apart in a
 * three-minute walk pin the rate about as well as not bracketing at all, while
 * passing any test that only asks whether a repeat exists.
 */
export const MIN_BRACKET_FRACTION = 0.5;

/** Judge a finished fit against the speakers the run set out to measure. */
export function runVerdict(fit: LatencyFit, selected: string[]): RunVerdict {
  // Ahead of everything, because it is not one thing wrong with the run: a rate
  // this far out means the arrivals were reconciled onto the wrong chirp
  // somewhere, and every offset that follows from them is meaningless rather
  // than merely uncertain.
  if (Math.abs(fit.rateErrorPpm) > MAX_PLAUSIBLE_RATE_PPM)
    return "irreconcilable";

  if (selected.some((playerId) => !(playerId in fit.offsetsMs)))
    return "unmeasured";

  const span = fit.bracketSpanSeconds;
  if (span === null) return "unbracketed";
  if (span < MIN_BRACKET_FRACTION * fit.runSpanSeconds) return "short_bracket";

  // Ahead of the scatter checks because it is the more specific diagnosis: a
  // disagreement between repeats also shows up as scatter, and "walk it again"
  // is better advice than "something moved".
  if (
    fit.bracketResidualMs !== null &&
    fit.bracketResidualMs > BRACKET_LIMIT_MS
  )
    return "disagrees";

  if (fit.residualMs > SCATTER_LIMIT_MS) return "scattered";
  if (worstSpreadMs(fit) > VISIT_SPREAD_LIMIT_MS) return "scattered";

  return fit.bracketResidualMs === null ? "pinned" : "checked";
}

/** Whether a run in this state may have its offsets applied. */
export function isApplicable(verdict: RunVerdict): boolean {
  return verdict === "pinned" || verdict === "checked";
}

/** The widest spread within any single reading, in milliseconds. */
export function worstSpreadMs(fit: LatencyFit): number {
  return fit.visits.reduce(
    (worst, visit) => Math.max(worst, visit.spreadMs),
    0,
  );
}
