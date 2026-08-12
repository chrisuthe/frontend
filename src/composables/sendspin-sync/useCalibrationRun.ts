/**
 * The calibration walk, from picking speakers to applying the result.
 *
 * Holds the flow together: the server session that plays the chirps, the
 * microphone that hears them, and the fit that turns arrivals into one latency
 * per speaker. The view reads the state this exposes and calls the four verbs;
 * none of the timing rules live up there.
 *
 * The walk deliberately ends by measuring the first speaker a second time. Every
 * speaker is measured in its own few-second window, one after another, which
 * makes a slowly drifting phone clock and a run of steadily growing latencies
 * very nearly the same shape — so on a single pass the clock rate is separable
 * from the offsets only over the few seconds one visit spans, which is nowhere
 * near enough. Measuring one speaker at both ends of the walk gives it the whole
 * run as a baseline, and without that the result is not offered for applying.
 *
 * That first repeat *determines* the rate rather than testing it: the fit absorbs
 * any disagreement between the two readings into the rate exactly, leaving no
 * residual behind. Measuring a second speaker twice is what makes the rate
 * testable, so the flow invites it without demanding it — and what is being
 * checked, or not, is said plainly rather than implied by a number that would read
 * as a pass either way.
 */

import { CHIRP_PERIOD_SECONDS } from "@/helpers/sendspin-sync/chirp";
import { scanArrivals } from "@/helpers/sendspin-sync/chirpArrivals";
import {
  fitLatencies,
  type ArrivalSample,
  type LatencyFit,
} from "@/helpers/sendspin-sync/latencyFit";
import {
  isApplicable,
  MIN_BRACKET_FRACTION,
  runVerdict,
} from "@/helpers/sendspin-sync/verdict";
import type { CalibrationApplyResult } from "@/plugins/api/interfaces";
import { computed, ref, watch } from "vue";
import { useCalibrationSession } from "./useCalibrationSession";
import { useChirpCapture } from "./useChirpCapture";

/** Chirps collected per speaker. */
const CHIRPS_PER_VISIT = 10;

/**
 * How long to wait after soloing before recording.
 *
 * The server unmutes the speaker being measured and then mutes the others, so the
 * first chirp periods after a solo still carry the speaker that was audible
 * before. Those have to be thrown away rather than measured.
 */
const SETTLE_SECONDS = 1;

/** Long enough for {@link CHIRPS_PER_VISIT} chirps wherever the first one lands. */
const RECORD_SECONDS = (CHIRPS_PER_VISIT + 1) * CHIRP_PERIOD_SECONDS;

/** A speaker measured once. */
export interface Measurement {
  visit: number;
  playerId: string;
  /** Chirps found, against the number the recording was long enough to hold. */
  found: number;
  expected: number;
  /** Typical peak-to-noise ratio of those arrivals. */
  medianSnr: number;
  /** Render quanta the microphone delivered nothing for. */
  dropouts: number;
}

export type RunPhase = "picking" | "walking" | "measuring" | "voided";

export function useCalibrationRun() {
  const session = useCalibrationSession();
  const capture = useChirpCapture();

  const phase = ref<RunPhase>("picking");
  const selected = ref<string[]>([]);
  const visits = ref<Measurement[]>([]);
  const applyResult = ref<CalibrationApplyResult | null>(null);
  const openError = ref<string | null>(null);
  /** The speaker currently being recorded, so the view can show it where it is. */
  const measuringPlayerId = ref<string | null>(null);

  const samples = ref<ArrivalSample[]>([]);
  let nextVisit = 0;

  /** The speaker every other reading is relative to, and the one to re-measure. */
  const anchor = computed(() => selected.value[0] ?? null);

  const measured = computed(
    () => new Set(visits.value.map((visit) => visit.playerId)),
  );
  const remaining = computed(() =>
    selected.value.filter((playerId) => !measured.value.has(playerId)),
  );

  /**
   * True once every speaker is done but the bracketing re-measure is not.
   *
   * Two readings of one speaker are not enough on their own: taken moments apart
   * they pin the clock rate over seconds rather than over the walk, which is no
   * better than not bracketing at all. So this keeps asking until the bracket
   * actually spans the run.
   */
  const needsBracket = computed(() => {
    if (remaining.value.length > 0) return false;
    const current = fit.value;
    if (!current || current.bracketSpanSeconds === null) return true;
    return (
      current.bracketSpanSeconds < MIN_BRACKET_FRACTION * current.runSpanSeconds
    );
  });

  const fit = computed<LatencyFit | null>(() => fitLatencies(samples.value));

  /** What this run can honestly say about itself, or `null` before it can. */
  const verdict = computed(() =>
    fit.value ? runVerdict(fit.value, selected.value) : null,
  );

  /** Whether the offsets may be applied. */
  const trustworthy = computed(() =>
    verdict.value ? isApplicable(verdict.value) : false,
  );

  // A context that stopped leaves the arrivals either side of the gap on
  // unrelated timelines, so the run is over whenever this fires.
  watch(capture.voided, (voided) => {
    if (voided) phase.value = "voided";
  });
  watch(session.lost, (lost) => {
    if (lost) phase.value = "voided";
  });

  /**
   * Take the selected speakers over, open the microphone, and start walking.
   *
   * Must be called straight from a user gesture so the browser counts the tap as
   * permission to open an `AudioContext`.
   */
  async function begin(force = false): Promise<boolean> {
    if (phase.value !== "picking" || selected.value.length < 2) return false;

    const opening = await capture.open();
    if (!opening.opened) {
      openError.value = opening.error?.name ?? "OpenFailed";
      return false;
    }
    openError.value = null;

    if (!(await session.start(selected.value, force))) {
      await capture.close();
      return false;
    }

    phase.value = "walking";
    return true;
  }

  /** Measure one speaker: make it audible, let it settle, then listen. */
  async function measure(playerId: string): Promise<boolean> {
    if (phase.value !== "walking") return false;
    phase.value = "measuring";
    measuringPlayerId.value = playerId;

    try {
      if (!(await session.solo(playerId))) return false;
      await settle();
      if (capture.voided.value) return false;

      const recording = await capture.record(RECORD_SECONDS);
      if (!recording) return false;

      const scan = scanArrivals(recording.samples, {
        sampleRate: recording.sampleRate,
        firstFrame: recording.firstFrame,
      });

      const visit = nextVisit++;
      samples.value = [
        ...samples.value,
        ...scan.arrivals.map((arrival) => ({
          visit,
          playerId,
          at: arrival.at,
        })),
      ];
      visits.value = [
        ...visits.value,
        {
          visit,
          playerId,
          found: scan.arrivals.length,
          expected: scan.expected,
          medianSnr: scan.medianSnr,
          dropouts: recording.dropouts,
        },
      ];
      return scan.arrivals.length > 0;
    } finally {
      measuringPlayerId.value = null;
      // A void that landed mid-measurement must not be overwritten back to a
      // state that invites another one.
      if (phase.value === "measuring")
        phase.value =
          capture.voided.value || session.lost.value ? "voided" : "walking";
    }
  }

  /** Hand the offsets to the server, and keep the delays it worked out. */
  async function apply(): Promise<boolean> {
    const offsets = fit.value?.offsetsMs;
    if (!offsets || !trustworthy.value) return false;

    const result = await session.apply(offsets);
    if (!result) return false;

    applyResult.value = result;
    return true;
  }

  /** End the run: stop the session, release the microphone. */
  async function finish(): Promise<void> {
    await session.stop();
    await capture.close();
  }

  /**
   * Throw the run away and go back to picking speakers.
   *
   * Used after a void, where nothing measured so far can be salvaged: the
   * arrivals either side of the gap have no common time base, so keeping any of
   * them would only make the next fit wrong in a way nothing would show.
   */
  async function restart(): Promise<void> {
    await finish();
    capture.reset();
    session.reset();
    visits.value = [];
    samples.value = [];
    nextVisit = 0;
    applyResult.value = null;
    openError.value = null;
    phase.value = "picking";
  }

  function settle(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, SETTLE_SECONDS * 1000));
  }

  return {
    // server state
    players: session.players,
    sessionState: session.state,
    sessionLost: session.lost,
    busy: session.busy,
    loadPlayers: session.loadPlayers,
    refresh: session.refresh,
    // capture state
    voided: capture.voided,
    recording: capture.recording,
    sampleRate: capture.sampleRate,
    openError,
    // the walk
    phase,
    selected,
    visits,
    measuringPlayerId,
    anchor,
    remaining,
    needsBracket,
    fit,
    verdict,
    trustworthy,
    applyResult,
    begin,
    measure,
    apply,
    finish,
    restart,
  };
}
