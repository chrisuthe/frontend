/**
 * Reading the spacing of the chirps a recording actually holds.
 *
 * {@link CHIRP_PERIOD_SECONDS} is shared with the server's `sendspin_sync` by
 * hand: nothing negotiates it, and nothing in the protocol carries it. When the
 * two sides disagree about it, every arrival is numbered onto the wrong chirp and
 * the result is not a poor measurement but a meaningless one — which from the
 * outside looks like a badly walked run, a drifting clock, or speakers that
 * cannot be placed. So the spacing is measured off the recording and checked
 * against the one this build was compiled with.
 *
 * It is measured by correlating the recording's own correlation envelope with
 * itself. A chirp train repeats, so the envelope's whole pattern — direct sound,
 * reflections, decaying tail and all — repeats with it, and the first lag at which
 * that pattern lines up with itself is the spacing. Taking the whole pattern is
 * what makes this work in the room the rest of the detector is built for: picking
 * peaks instead would count a reverberant tail hundreds of milliseconds behind a
 * chirp as a chirp of its own, and read the spacing far too short.
 */

import { CHIRP_PERIOD_SECONDS } from "./chirp";

/**
 * How finely the envelope is reduced before it is lined up against itself.
 *
 * A matched-filter peak is a fraction of a millisecond wide, so keeping each
 * millisecond's tallest sample keeps every arrival and every reflection while
 * cutting the work by the sample rate. What is being decided is whether a spacing
 * is the expected one at all, and a millisecond settles that many times over: the
 * worst clock the flow admits drifts a single millisecond across one recording.
 */
const BIN_SECONDS = 1e-3;

/**
 * The narrowest spacing looked for, as a fraction of the expected period.
 *
 * Sits well below the closest spacing any server would emit — half a period is
 * the mismatch that can actually happen — and still far beyond the reverberation
 * that follows a chirp, so a tail cannot be mistaken for the next chirp along. A
 * server emitting faster than this reads as some multiple of its true spacing,
 * which is refused just the same.
 */
const MIN_SPACING_RATIO = 0.25;

/** The widest spacing looked for, so a server emitting at half the rate is read. */
const MAX_SPACING_RATIO = 2.5;

/**
 * How well the recording must line up with itself for a chirp train to be there
 * at all.
 *
 * A train dominates the recording's energy — the chirps and their tails are the
 * only structure in it — so lining up on the spacing recovers most of that
 * energy, and a real one comes back several times this. Room noise on its own
 * reaches a few hundredths across the lags searched, so anything under this is
 * silence or a speaker that was never audible, and the honest answer for those is
 * that the spacing cannot be read rather than that it disagrees.
 */
const MIN_ALIGNMENT = 0.2;

/**
 * How strongly a lag must line up against the best in the band to be taken for
 * the spacing itself.
 *
 * A train lines up with itself at every multiple of its spacing, so the spacing
 * is the *first* lag that lines up and not the strongest one. Each further
 * multiple pairs up one fewer chirp, so no multiple stands far above the
 * fundamental and half the best is comfortably above the ripple between them.
 */
const MIN_PEAK_FRACTION = 0.5;

/**
 * How far the spacing a recording shows may sit from the period this build
 * expects, as a fraction of it.
 *
 * Everything real is orders of magnitude inside this: the worst clock the flow
 * admits stretches the spacing by a thousandth, and the measurement itself is
 * good to a millisecond. Everything that would fail is a whole factor outside it,
 * a half-period server being the case that will actually happen. So the tolerance
 * only has to be loose enough never to accuse a healthy run.
 */
export const MAX_SPACING_ERROR = 0.05;

/**
 * The chirp spacing this recording shows, in seconds, or `null` when it cannot
 * say.
 *
 * `null` for a recording with no chirp train in it — a speaker that was never
 * audible, or one heard too faintly to line up with itself — and for one too
 * short to hold two chirps. None of those is evidence that the spacing is wrong,
 * so none of them may be reported as such.
 *
 * Takes the matched filter's envelope rather than the recording itself, because
 * that is where a chirp is one peak instead of 60 ms of sweep.
 */
export function observedSpacing(
  envelope: Float32Array,
  sampleRate: number,
): number | null {
  const binFrames = Math.max(1, Math.round(BIN_SECONDS * sampleRate));
  const binSeconds = binFrames / sampleRate;
  const bins = centredPeaks(envelope, binFrames);

  const from = Math.round(
    (MIN_SPACING_RATIO * CHIRP_PERIOD_SECONDS) / binSeconds,
  );
  // Never past half the recording, whatever the band would otherwise reach: a
  // wider lag has too few bins still overlapping to say anything.
  const to = Math.min(
    Math.round((MAX_SPACING_RATIO * CHIRP_PERIOD_SECONDS) / binSeconds),
    bins.length >> 1,
  );
  if (to <= from + 1) return null;

  const alignment = alignmentByLag(bins, from, to);

  let best = 0;
  for (const score of alignment) if (score > best) best = score;
  if (best < MIN_ALIGNMENT) return null;

  const threshold = Math.max(MIN_ALIGNMENT, MIN_PEAK_FRACTION * best);
  let lag = 0;
  while (lag < alignment.length && alignment[lag] < threshold) lag++;
  if (lag >= alignment.length) return null;

  // The threshold is crossed on the way up, so climb to the top of the lobe
  // rather than timing the crossing, which moves with the level.
  while (lag + 1 < alignment.length && alignment[lag + 1] > alignment[lag])
    lag++;

  return (from + lag) * binSeconds;
}

/**
 * The envelope as one value per bin, each bin's tallest sample, about their own
 * mean.
 *
 * Centring is what makes the lags below a measure of the pattern rather than of
 * the room: an envelope is positive throughout, so left as it is, every lag
 * carries the same large product of the noise floor with itself and the chirps'
 * own contribution is a ripple on top of it.
 */
function centredPeaks(envelope: Float32Array, binFrames: number): Float64Array {
  const count = Math.floor(envelope.length / binFrames);
  const bins = new Float64Array(count);

  for (let bin = 0; bin < count; bin++) {
    const end = (bin + 1) * binFrames;
    let peak = 0;
    for (let frame = bin * binFrames; frame < end; frame++)
      if (envelope[frame] > peak) peak = envelope[frame];
    bins[bin] = peak;
  }

  let total = 0;
  for (const value of bins) total += value;
  const mean = count ? total / count : 0;
  for (let bin = 0; bin < count; bin++) bins[bin] -= mean;

  return bins;
}

/**
 * How well the bins line up with themselves at each lag from `from` to `to`, as a
 * fraction of their own energy.
 *
 * Divided by the energy of the whole recording rather than of the overlap alone,
 * so a lag is charged for the bins it has no partner for. That leans the reading
 * towards the shortest spacing that explains the recording, which is the one being
 * looked for.
 */
function alignmentByLag(
  bins: Float64Array,
  from: number,
  to: number,
): Float64Array {
  let energy = 0;
  for (const value of bins) energy += value * value;

  const alignment = new Float64Array(to - from + 1);
  if (energy <= 0) return alignment;

  for (let lag = from; lag <= to; lag++) {
    let sum = 0;
    for (let bin = 0; bin + lag < bins.length; bin++)
      sum += bins[bin] * bins[bin + lag];
    alignment[lag - from] = sum / energy;
  }

  return alignment;
}

/** Whether a spacing read off a recording is the one this build expects. */
export function spacingMatchesPeriod(spacingSeconds: number): boolean {
  return (
    Math.abs(spacingSeconds - CHIRP_PERIOD_SECONDS) <=
    MAX_SPACING_ERROR * CHIRP_PERIOD_SECONDS
  );
}
