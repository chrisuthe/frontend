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

/** How many robust standard deviations an arrival may sit from its visit. */
const OUTLIER_SIGMAS = 3;

/** Below this many arrivals a visit's own spread is too noisy to judge by. */
const MIN_SAMPLES_TO_JUDGE = 5;

/**
 * Fit the arrivals, or return `null` when they cannot determine the model.
 *
 * Arrivals from a single instant, or too few of them to pin down both the clock
 * rate and every offset, leave the system singular; reporting nothing is the
 * only honest answer to that.
 */
export function fitLatencies(samples: ArrivalSample[]): LatencyFit | null {
  if (samples.length < 3) return null;

  const rows = unwrap(samples);
  const players = [...new Set(rows.map((row) => row.sample.playerId))];
  // The first speaker anchors the result: its offset is fixed at zero, so only
  // the others carry a free parameter.
  const free = players.slice(1);

  const used = rows.filter((row) => !row.outlier);
  if (used.length < free.length + 3) return null;

  const fit = solve(used, free);
  if (!fit) return null;
  return report(rows, used, fit, players);
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

/**
 * Resolve every arrival's phase into one continuous run of values, and mark the
 * arrivals that disagree with the rest of their visit.
 *
 * Wrapping each arrival against a single fixed reference would be simpler and
 * wrong: the drift term grows without bound, so on a phone whose clock is off by
 * the 1000 ppm the microphone probe still calls merely degraded, the phase folds
 * through half a period after about four minutes and the fit returns a confident
 * wrong answer.
 *
 * Unwrapping against the nearest neighbour instead keeps every comparison short.
 * Inside a visit the arrivals span a few seconds, and consecutive visits are a
 * walk apart, so both steps stay far below the half-period at which the
 * ambiguity bites.
 *
 * Outliers are judged inside a visit rather than against the finished fit,
 * because every arrival in a visit shares one speaker and one moment: a
 * reflection picked up instead of the direct sound stands out against its
 * neighbours, whereas against the global fit it has already dragged its own
 * speaker's offset towards itself and drags the honest arrivals out with it.
 */
function unwrap(samples: ArrivalSample[]): FitRow[] {
  const ordered = [...samples].sort((left, right) => left.at - right.at);
  const reference = ordered[0].at;
  const rows: FitRow[] = [];

  // Each visit is pinned to its own first arrival, so one bad detection shifts
  // only itself rather than everything captured after it.
  let previous: number | null = null;
  for (const visit of groupByVisit(ordered)) {
    const pivot = phaseOf(visit[0].at);
    const local = visit.map((sample) =>
      wrapToPeriod(phaseOf(sample.at) - pivot),
    );

    const centre = median(local);
    // Annotated because `previous` is assigned from `base` further down, which
    // otherwise makes the inference circular.
    const periods: number =
      previous === null
        ? 0
        : Math.round((previous - centre - pivot) / CHIRP_PERIOD_SECONDS);
    const base: number = pivot + periods * CHIRP_PERIOD_SECONDS;
    previous = base + centre;

    const outliers = findOutliers(local, centre);
    visit.forEach((sample, index) => {
      rows.push({
        sample,
        elapsed: sample.at - reference,
        phase: base + local[index],
        outlier: outliers[index],
      });
    });
  }

  return rows;
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

  const spread = Math.max(
    RESIDUAL_FLOOR_SECONDS,
    1.4826 * median(local.map((value) => Math.abs(value - centre))),
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

function report(
  rows: FitRow[],
  used: readonly FitRow[],
  fit: Solution,
  players: string[],
): LatencyFit {
  const offsetsMs: Record<string, number> = {};
  for (const playerId of players)
    offsetsMs[playerId] = (fit.offsets.get(playerId) ?? 0) * 1000;

  const residuals = used.map((row) => row.phase - predict(row, fit));
  const centre = median(residuals);
  const visits = summarizeVisits(rows, fit);

  return {
    offsetsMs,
    rateRatio: 1 + fit.drift,
    rateErrorPpm: fit.drift * 1e6,
    residualMs:
      1.4826 *
      median(residuals.map((value) => Math.abs(value - centre))) *
      1000,
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

function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = sorted.length >> 1;
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}
