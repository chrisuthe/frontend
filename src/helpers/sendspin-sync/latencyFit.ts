/**
 * Turns chirp arrival times into one latency figure per speaker.
 *
 * The server emits chirps on one uninterrupted stream, so the chirp train is a
 * metronome running on the server clock. A speaker's latency is therefore a
 * phase offset against that metronome, and the phone never needs to know the
 * server's absolute time — only where each arrival falls inside the period.
 *
 * Every arrival is modelled as
 *
 *     phase = c + d * elapsed + offset[speaker]
 *
 * where `c` absorbs the microphone's own input latency and the arbitrary phase
 * the session happened to start on, `d` is the phone audio clock's fractional
 * excess over the server's, and `offset[speaker]` is the figure being measured.
 * `c` and the first speaker's offset are degenerate with each other, so the
 * first speaker's offset is fixed at zero and every result is relative to it —
 * which is exactly what the server's `apply_measurements` expects.
 *
 * Fitting `d` across the whole session is not optional. Consumer clocks sit
 * inside ±100 ppm, which over a several-minute walk is several milliseconds of
 * drift — larger than the speaker latencies being measured.
 *
 * No chirp is ever counted or indexed. Each arrival contributes only its phase
 * within the period, and those phases are unwrapped against each other — first
 * inside a measurement, then from one measurement to the next. The integer
 * number of periods that unwrapping introduces is common to every sample, so `c`
 * absorbs it and it never has to be known.
 *
 * Unwrapping from one measurement to the next is the one step with more than one
 * arithmetically valid answer: the phone hears nothing for tens of seconds
 * between speakers, and the branches either side of that silence differ by
 * exactly one period. `d` absorbs a wrong branch without complaint, so the fit
 * alone cannot tell them apart. Physics can — a phone's audio clock cannot be
 * thousands of ppm out — so the branch is chosen on the rate it implies.
 */

import { CHIRP_PERIOD_SECONDS } from "./chirp";

/** One detected chirp arrival, timed on the phone's own audio clock. */
export interface ArrivalSample {
  /**
   * Which contiguous measurement this came from.
   *
   * A speaker measured twice produces two visits, which is what makes the
   * bracket check below possible.
   */
  visit: number;
  playerId: string;
  /** Arrival time in seconds on the phone's audio clock. */
  at: number;
}

export interface VisitFit {
  visit: number;
  playerId: string;
  samples: number;
  /** Samples that survived the outlier pass and reached the fit. */
  used: number;
  /** Where this visit sits against the fitted line, in milliseconds. */
  meanResidualMs: number;
  /** Spread of this visit's own arrivals about their mean, in milliseconds. */
  spreadMs: number;
}

export interface LatencyFit {
  /** Per-speaker arrival offset in milliseconds, relative to the first speaker. */
  offsetsMs: Record<string, number>;
  /** The phone audio clock against the server's, as a ratio. */
  rateRatio: number;
  /** The same reading as parts per million, which is how clocks are specified. */
  rateErrorPpm: number;
  /** Robust spread of the residuals across every used sample, in milliseconds. */
  residualMs: number;
  /**
   * The same spread taken one speaker at a time, in milliseconds.
   *
   * One figure for the run cannot tell a single spoiled speaker from detection
   * that was poor everywhere, and those want different things done about them.
   */
  scatterMs: Record<string, number>;
  /**
   * The longest gap between two readings of one speaker, or `null` when no
   * speaker was measured twice.
   *
   * This is what makes `d` mean anything. Measuring speakers one after another
   * makes a slowly drifting clock and a run of steadily growing latencies very
   * nearly the same shape, so within a single pass along the speakers `d` is
   * determined only by the few seconds each visit spans — far too short a
   * baseline to be worth anything. One speaker measured at both ends of the walk
   * gives it a baseline of the whole run.
   */
  bracketSpanSeconds: number | null;
  /**
   * How far the repeated readings of one speaker disagree, in milliseconds, or
   * `null` when nothing here can check them.
   *
   * Read the `null` carefully, because it is the usual case and it does not mean
   * agreement. A single repeated reading is the one constraint that *determines*
   * `d`; the fit then absorbs any disagreement between those two readings into
   * `d` exactly, and no residual is left behind to look at. A speaker whose
   * second reading is 6 ms out simply produces a clock rate 100 ppm further off —
   * perfectly ordinary for a phone — and every other offset quietly wrong.
   *
   * A number appears only once the readings outnumber what `d` can absorb: a
   * speaker measured three times, or two different speakers each measured twice.
   * Then one constraint fixes `d` and the rest genuinely test it.
   */
  bracketResidualMs: number | null;
  /**
   * How long the whole run took, on the phone's clock.
   *
   * The clock rate's uncertainty falls with the baseline it was measured over and
   * its effect on the offsets grows with the run, so this is what
   * {@link bracketSpanSeconds} has to be judged against.
   */
  runSpanSeconds: number;
  visits: VisitFit[];
  used: number;
  rejected: number;
}

/**
 * Arrivals this far apart or less are treated as equally good when deciding what
 * a visit's outliers are.
 *
 * Without a floor, a handful of unusually consistent arrivals shrinks the robust
 * spread to almost nothing and the pass throws away good samples.
 */
const RESIDUAL_FLOOR_SECONDS = 50e-6;

/**
 * And no further apart than this, however wide the visit's own spread is.
 *
 * The threshold is scaled off the data, so a badly detected visit widens it
 * until it swallows the very arrivals it exists to catch: at the 17 ms of spread
 * a spoiled walk produces it reaches 75 ms and rejects nothing. Sound covers two
 * thirds of a metre in this time and the matched filter resolves forty times
 * finer, so past here the pass stops taking the data's word for what is normal.
 */
const RESIDUAL_CEILING_SECONDS = 2e-3;

/** How many robust standard deviations an arrival may sit from its visit. */
const OUTLIER_SIGMAS = 3;

/** Below this many arrivals a visit's own spread is too noisy to judge by. */
const MIN_SAMPLES_TO_JUDGE = 5;

/**
 * The furthest a phone's audio clock can plausibly sit from the server's.
 *
 * Consumer crystals are specified inside ±100 ppm, and the microphone probe
 * already calls 1000 ppm degraded while still letting the run proceed — so the
 * line past which a rate stops being a reading has to sit above what the rest of
 * the flow tolerates. Twice that, and twenty times a healthy clock, refuses
 * nothing real while still catching a fit that has swallowed a whole chirp
 * period: half a second misassigned across a two-and-a-half-minute walk implies
 * some 3300 ppm.
 */
export const MAX_PLAUSIBLE_RATE_PPM = 2000;

/**
 * How many times over the branch search may correct a misassignment.
 *
 * One gap unwrapped onto the wrong chirp is a walk that went quiet at an awkward
 * moment. Several is a recording nothing sensible can be made of, and hunting
 * further only finds a combination that happens to look possible.
 */
const MAX_BRANCH_ROUNDS = 2;

/**
 * Fit the arrivals, or return `null` when they cannot determine the model.
 *
 * Arrivals from a single instant, or too few of them to pin down both the clock
 * rate and every offset, leave the system singular; reporting nothing is the
 * only honest answer to that.
 *
 * A fit whose rate no clock could have is still returned rather than withheld:
 * it is the evidence for refusing the run, and `runVerdict` is where the refusal
 * is decided. Read {@link LatencyFit.rateErrorPpm} against
 * {@link MAX_PLAUSIBLE_RATE_PPM} before trusting anything else here.
 */
export function fitLatencies(samples: ArrivalSample[]): LatencyFit | null {
  if (samples.length < 3) return null;

  const ordered = [...samples].sort((left, right) => left.at - right.at);
  const visits = describeVisits(ordered);
  const players = [...new Set(ordered.map((sample) => sample.playerId))];
  // The first speaker anchors the result: its offset is fixed at zero, so only
  // the others carry a free parameter.
  const free = players.slice(1);
  const reference = ordered[0].at;

  const baseline = evaluate(visits, chain(visits), reference, free);
  if (!baseline) return null;

  return report(
    baseline.plausible
      ? baseline
      : reconcile(visits, reference, free, baseline),
    players,
  );
}

/** Reduce a span of seconds to its phase within the chirp period. */
export function wrapToPeriod(seconds: number): number {
  return (
    seconds - CHIRP_PERIOD_SECONDS * Math.round(seconds / CHIRP_PERIOD_SECONDS)
  );
}

/** One arrival with the terms the fit works in. */
interface FitRow {
  sample: ArrivalSample;
  elapsed: number;
  /** Arrival phase with the period ambiguity resolved. */
  phase: number;
  /** Set when this arrival did not agree with the rest of its own visit. */
  outlier: boolean;
}

/** One visit's arrivals as phases, with the arrivals that disagree marked. */
interface VisitPhases {
  samples: ArrivalSample[];
  /**
   * Phase of the visit's first arrival, which {@link local} is measured from.
   *
   * Pinning a visit to its own first arrival keeps one bad detection to itself
   * rather than shifting everything captured after it.
   */
  pivot: number;
  /** Each arrival's phase relative to {@link pivot}. */
  local: number[];
  /** Where the visit's arrivals sit among {@link local}. */
  centre: number;
  outliers: boolean[];
}

/**
 * Reduce each visit to phases, and mark the arrivals that disagree with the rest
 * of their own visit.
 *
 * Outliers are judged inside a visit rather than against the finished fit,
 * because every arrival in a visit shares one speaker and one moment: a
 * reflection picked up instead of the direct sound stands out against its
 * neighbours, whereas against the global fit it has already dragged its own
 * speaker's offset towards itself and drags the honest arrivals out with it.
 *
 * Nothing here depends on how the visits are unwrapped against each other, so
 * the branch search below can retry that step without redoing any of this.
 */
function describeVisits(ordered: ArrivalSample[]): VisitPhases[] {
  return groupByVisit(ordered).map((samples) => {
    const pivot = phaseOf(samples[0].at);
    const local = samples.map((sample) =>
      wrapToPeriod(phaseOf(sample.at) - pivot),
    );
    const centre = median(local);

    return {
      samples,
      pivot,
      local,
      centre,
      outliers: findOutliers(local, centre),
    };
  });
}

/**
 * How many whole periods to add to each visit, pinning each to the one before it.
 *
 * Wrapping every arrival against a single fixed reference would be simpler and
 * wrong: the drift term grows without bound, so on a phone whose clock is off by
 * the 1000 ppm the microphone probe still calls merely degraded, the phase folds
 * through half a period after about four minutes and the fit returns a confident
 * wrong answer. Chaining keeps every comparison to the length of one gap, where
 * drift alone cannot reach the half period at which the ambiguity bites.
 *
 * What can reach it is the speakers. Consecutive visits differ by their offsets
 * as well as by drift, and a speaker a couple of hundred milliseconds behind —
 * an ordinary Bluetooth one — is most of the way there on its own. So this is
 * where the fit starts, not where it finishes.
 */
function chain(visits: VisitPhases[]): number[] {
  const periods: number[] = [];

  let previous: number | null = null;
  for (const visit of visits) {
    // Annotated because `previous` is assigned from `count` below, which
    // otherwise makes the inference circular.
    const count: number =
      previous === null
        ? 0
        : Math.round(
            (previous - visit.centre - visit.pivot) / CHIRP_PERIOD_SECONDS,
          );
    periods.push(count);
    previous = visit.pivot + count * CHIRP_PERIOD_SECONDS + visit.centre;
  }

  return periods;
}

/** One whole branch assignment, solved and judged. */
interface Candidate {
  /** Whole periods added to each visit, in the order they were captured. */
  periods: number[];
  rows: FitRow[];
  used: FitRow[];
  solution: Solution;
  /** Robust spread of the used residuals, in seconds. */
  residual: number;
  /** Whether the clock rate this branch implies is one a real clock could have. */
  plausible: boolean;
}

/** Unwrap by the given branch, fit it, and measure how well it came out. */
function evaluate(
  visits: VisitPhases[],
  periods: number[],
  reference: number,
  free: string[],
): Candidate | null {
  const rows: FitRow[] = [];
  visits.forEach((visit, index) => {
    const base = visit.pivot + periods[index] * CHIRP_PERIOD_SECONDS;
    visit.samples.forEach((sample, arrival) => {
      rows.push({
        sample,
        elapsed: sample.at - reference,
        phase: base + visit.local[arrival],
        outlier: visit.outliers[arrival],
      });
    });
  });

  const used = rows.filter((row) => !row.outlier);
  if (used.length < free.length + 3) return null;

  const solution = solve(used, free);
  if (!solution) return null;

  return {
    periods,
    rows,
    used,
    solution,
    residual: robustSpread(
      used.map((row) => row.phase - predict(row, solution)),
    ),
    plausible: Math.abs(solution.drift) * 1e6 <= MAX_PLAUSIBLE_RATE_PPM,
  };
}

/**
 * Look for a branch the physics allows, once the chained one turns out not to be.
 *
 * A visit unwrapped onto the wrong chirp shifts every visit after it by the same
 * whole period, so the corrections worth trying are exactly that: one period,
 * either way, applied from one gap onwards. The fit cannot choose between them
 * on how well they fit — a whole period is precisely what the drift term absorbs
 * without complaint, which is how the wrong branch came to be reported in the
 * first place — so the rate each one implies is what decides.
 *
 * Returns the best it found, which may still be impossible. A run with no
 * possible branch at all is one to refuse, and saying so is the caller's job.
 */
function reconcile(
  visits: VisitPhases[],
  reference: number,
  free: string[],
  baseline: Candidate,
): Candidate {
  let best = baseline;

  for (let round = 0; round < MAX_BRANCH_ROUNDS && !best.plausible; round++) {
    let improved: Candidate | null = null;

    for (let gap = 1; gap < visits.length; gap++)
      for (const shift of [-1, 1]) {
        const periods = best.periods.map((count, index) =>
          index >= gap ? count + shift : count,
        );
        const candidate = evaluate(visits, periods, reference, free);
        if (candidate && better(candidate, improved ?? best))
          improved = candidate;
      }

    if (!improved) break;
    best = improved;
  }

  return best;
}

/**
 * Whether one branch beats another: possible first, then the tighter fit.
 *
 * A branch that fits the arrivals worse is never the answer, however possible
 * the rate it implies — otherwise a genuinely broken clock would be handed a
 * respectable-looking rate it does not have. The misassignment this search
 * exists to undo costs nothing in fit, which is exactly why the rate has to
 * break the tie.
 *
 * Fits that agree to within the detection floor are the same fit as far as the
 * arrivals can say, so a difference smaller than that is not a reason to move.
 */
function better(candidate: Candidate, incumbent: Candidate): boolean {
  if (candidate.residual > incumbent.residual + RESIDUAL_FLOOR_SECONDS)
    return false;
  if (candidate.plausible !== incumbent.plausible) return candidate.plausible;
  return candidate.residual < incumbent.residual - RESIDUAL_FLOOR_SECONDS;
}

/**
 * Flag the arrivals too far from their visit's centre to be the direct sound.
 *
 * A visit that would lose half its arrivals keeps all of them: at that point the
 * measurement is not one stray reflection but a bad recording, and the caller
 * needs to see that in the spread rather than have it quietly filtered away.
 */
function findOutliers(local: number[], centre: number): boolean[] {
  if (local.length < MIN_SAMPLES_TO_JUDGE) return local.map(() => false);

  const spread = Math.min(
    RESIDUAL_CEILING_SECONDS,
    Math.max(RESIDUAL_FLOOR_SECONDS, robustSpread(local)),
  );
  const limit = OUTLIER_SIGMAS * spread;

  const outliers = local.map((value) => Math.abs(value - centre) > limit);
  const rejected = outliers.filter(Boolean).length;
  return rejected * 2 > local.length ? local.map(() => false) : outliers;
}

/** Where an arrival falls inside the chirp period, in seconds. */
function phaseOf(at: number): number {
  const phase = at % CHIRP_PERIOD_SECONDS;
  return phase < 0 ? phase + CHIRP_PERIOD_SECONDS : phase;
}

/** Split arrivals into contiguous runs sharing a visit, keeping capture order. */
function groupByVisit(ordered: ArrivalSample[]): ArrivalSample[][] {
  const visits: ArrivalSample[][] = [];
  for (const sample of ordered) {
    const current = visits[visits.length - 1];
    if (current && current[0].visit === sample.visit) current.push(sample);
    else visits.push([sample]);
  }
  return visits;
}

/** The fitted parameters: the constant, the rate error, and one offset each. */
interface Solution {
  constant: number;
  drift: number;
  offsets: Map<string, number>;
}

/**
 * Least squares over the design `[1, elapsed, ...speaker indicators]`.
 *
 * The parameter count is two plus the number of speakers after the first, so the
 * normal equations stay small enough that forming them directly costs nothing.
 */
function solve(rows: readonly FitRow[], free: string[]): Solution | null {
  const width = 2 + free.length;
  const column = new Map(free.map((playerId, index) => [playerId, 2 + index]));

  const normal = Array.from({ length: width }, () => new Float64Array(width));
  const target = new Float64Array(width);

  for (const row of rows) {
    const basis = new Float64Array(width);
    basis[0] = 1;
    basis[1] = row.elapsed;
    const offset = column.get(row.sample.playerId);
    if (offset !== undefined) basis[offset] = 1;

    for (let i = 0; i < width; i++) {
      if (basis[i] === 0) continue;
      for (let j = 0; j < width; j++) normal[i][j] += basis[i] * basis[j];
      target[i] += basis[i] * row.phase;
    }
  }

  const solution = gaussian(normal, target);
  if (!solution) return null;

  return {
    constant: solution[0],
    drift: solution[1],
    offsets: new Map(
      free.map((playerId, index) => [playerId, solution[2 + index]]),
    ),
  };
}

/** Gauss-Jordan with partial pivoting; `null` when the system is singular. */
function gaussian(
  matrix: Float64Array[],
  vector: Float64Array,
): number[] | null {
  const width = vector.length;
  const rows = matrix.map((row, index) => [...row, vector[index]]);

  for (let pivot = 0; pivot < width; pivot++) {
    let best = pivot;
    for (let row = pivot + 1; row < width; row++)
      if (Math.abs(rows[row][pivot]) > Math.abs(rows[best][pivot])) best = row;

    // A vanishing pivot means a parameter the arrivals cannot separate — a
    // speaker with no samples, or every sample taken at one instant.
    if (Math.abs(rows[best][pivot]) < 1e-12) return null;
    [rows[pivot], rows[best]] = [rows[best], rows[pivot]];

    const scale = rows[pivot][pivot];
    for (let column = pivot; column <= width; column++)
      rows[pivot][column] /= scale;

    for (let row = 0; row < width; row++) {
      if (row === pivot || rows[row][pivot] === 0) continue;
      const factor = rows[row][pivot];
      for (let column = pivot; column <= width; column++)
        rows[row][column] -= factor * rows[pivot][column];
    }
  }

  return rows.map((row) => row[width]);
}

function predict(row: FitRow, fit: Solution): number {
  return (
    fit.constant +
    fit.drift * row.elapsed +
    (fit.offsets.get(row.sample.playerId) ?? 0)
  );
}

function report(candidate: Candidate, players: string[]): LatencyFit {
  const { rows, used, solution } = candidate;

  const offsetsMs: Record<string, number> = {};
  for (const playerId of players)
    offsetsMs[playerId] = (solution.offsets.get(playerId) ?? 0) * 1000;

  const visits = summarizeVisits(rows, solution);

  return {
    offsetsMs,
    rateRatio: 1 + solution.drift,
    rateErrorPpm: solution.drift * 1e6,
    residualMs: candidate.residual * 1000,
    scatterMs: speakerScatter(used, solution, players),
    ...bracket(visits, rows),
    runSpanSeconds: rows.reduce(
      (longest, row) => Math.max(longest, row.elapsed),
      0,
    ),
    visits,
    used: used.length,
    rejected: rows.length - used.length,
  };
}

/** Each speaker's own arrivals against the fitted line, in milliseconds. */
function speakerScatter(
  used: readonly FitRow[],
  fit: Solution,
  players: string[],
): Record<string, number> {
  const residuals = new Map(
    players.map((playerId) => [playerId, [] as number[]]),
  );
  for (const row of used)
    residuals.get(row.sample.playerId)?.push(row.phase - predict(row, fit));

  const scatterMs: Record<string, number> = {};
  for (const [playerId, values] of residuals)
    scatterMs[playerId] = robustSpread(values) * 1000;
  return scatterMs;
}

function summarizeVisits(rows: FitRow[], fit: Solution): VisitFit[] {
  return groupRows(rows).map((group) => {
    const kept = group.filter((row) => !row.outlier);
    const judged = kept.length ? kept : group;
    const residuals = judged.map((row) => row.phase - predict(row, fit));
    const mean =
      residuals.reduce((total, value) => total + value, 0) / residuals.length;

    return {
      visit: group[0].sample.visit,
      playerId: group[0].sample.playerId,
      samples: group.length,
      used: kept.length,
      meanResidualMs: mean * 1000,
      spreadMs:
        Math.sqrt(
          residuals.reduce((total, value) => total + (value - mean) ** 2, 0) /
            residuals.length,
        ) * 1000,
    };
  });
}

/** The fitted rows regrouped per visit, in the order they were captured. */
function groupRows(rows: FitRow[]): FitRow[][] {
  const groups: FitRow[][] = [];
  for (const row of rows) {
    const current = groups[groups.length - 1];
    if (current && current[0].sample.visit === row.sample.visit)
      current.push(row);
    else groups.push([row]);
  }
  return groups;
}

/**
 * Work out what the repeated readings in this run can and cannot say.
 *
 * The span comes from whichever speaker was measured twice furthest apart, since
 * that is the baseline `d` rests on. The prescribed walk re-measures the first
 * speaker last, so that is normally the pair; picking by span rather than by name
 * means a run that brackets a different speaker still counts.
 *
 * A disagreement is only reported once there are more repeated readings than `d`
 * has freedom to absorb. Every repeat past the first is one such constraint, so
 * two of them leave something over to check against — and one does not, however
 * badly the two readings actually disagree.
 */
function bracket(
  visits: VisitFit[],
  rows: FitRow[],
): { bracketSpanSeconds: number | null; bracketResidualMs: number | null } {
  const at = new Map<number, number>();
  for (const row of rows)
    if (!at.has(row.sample.visit)) at.set(row.sample.visit, row.elapsed);

  let span: number | null = null;
  let constraints = 0;
  let worst = 0;

  for (const playerId of new Set(visits.map((visit) => visit.playerId))) {
    const repeated = visits.filter((visit) => visit.playerId === playerId);
    if (repeated.length < 2) continue;
    constraints += repeated.length - 1;

    const first = repeated[0];
    const last = repeated[repeated.length - 1];
    const gap = Math.abs(
      (at.get(last.visit) ?? 0) - (at.get(first.visit) ?? 0),
    );
    if (span === null || gap > span) span = gap;

    const residuals = repeated.map((visit) => visit.meanResidualMs);
    worst = Math.max(worst, Math.max(...residuals) - Math.min(...residuals));
  }

  return {
    bracketSpanSeconds: span,
    bracketResidualMs: constraints >= 2 ? worst : null,
  };
}

/** Median absolute deviation, scaled to read as a standard deviation. */
function robustSpread(values: readonly number[]): number {
  const centre = median(values);
  return 1.4826 * median(values.map((value) => Math.abs(value - centre)));
}

function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = sorted.length >> 1;
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}
