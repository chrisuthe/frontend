import { useCalibrationRun } from "@/composables/sendspin-sync/useCalibrationRun";
import type { Recording } from "@/composables/sendspin-sync/useChirpCapture";
import {
  chirpPhase,
  CHIRP_PERIOD_SECONDS,
  CHIRP_SECONDS,
} from "@/helpers/sendspin-sync/chirp";
import { BRACKET_LIMIT_MS } from "@/helpers/sendspin-sync/verdict";
import { effectScope, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const RATE = 48000;
const CHIRP_LENGTH = Math.round(CHIRP_SECONDS * RATE);

const fakes = vi.hoisted(() => ({
  session: {
    loadPlayers: vi.fn(),
    refresh: vi.fn(),
    start: vi.fn(),
    solo: vi.fn(),
    apply: vi.fn(),
    stop: vi.fn(),
    reset: vi.fn(),
  },
  capture: {
    open: vi.fn(),
    record: vi.fn(),
    reset: vi.fn(),
    close: vi.fn(),
  },
}));

vi.mock("@/composables/sendspin-sync/useCalibrationSession", async () => {
  const { ref: vueRef } = await vi.importActual<typeof import("vue")>("vue");
  return {
    useCalibrationSession: () => ({
      players: vueRef([
        { player_id: "living", name: "Living room", busy: false },
        { player_id: "kitchen", name: "Kitchen", busy: false },
      ]),
      state: vueRef(null),
      lost: sessionLost,
      busy: vueRef(false),
      ...fakes.session,
    }),
  };
});

vi.mock("@/composables/sendspin-sync/useChirpCapture", async () => {
  const { ref: vueRef } = await vi.importActual<typeof import("vue")>("vue");
  return {
    useChirpCapture: () => ({
      opened: vueRef(true),
      recording: vueRef(false),
      voided,
      sampleRate: vueRef(RATE),
      contextStates: vueRef([]),
      ...fakes.capture,
    }),
  };
});

let voided = ref<"suspended" | null>(null);
let sessionLost = ref<"expired" | "failed" | null>(null);
let scopes: ReturnType<typeof effectScope>[] = [];

function withScope<T>(factory: () => T): T {
  const scope = effectScope();
  scopes.push(scope);
  return scope.run(factory)!;
}

/**
 * A recording of one speaker, placed on the phone's own audio clock.
 *
 * The arrival times satisfy the model the fit has to undo: a chirp emitted on the
 * server's metronome lands at `(n * period + offset) / (1 - drift)` on the phone's
 * clock. Building the audio itself rather than the arrival times means the real
 * detector and the real fit both run here.
 */
function recordingAt(options: {
  startSeconds: number;
  offsetSeconds: number;
  drift: number;
  seconds?: number;
}): Recording {
  const { startSeconds, offsetSeconds, drift } = options;
  const length = Math.round((options.seconds ?? 5.5) * RATE);
  const samples = new Float32Array(length);
  const firstFrame = Math.round(startSeconds * RATE);

  const first = Math.ceil(
    (startSeconds * (1 - drift) - offsetSeconds) / CHIRP_PERIOD_SECONDS,
  );
  for (let chirp = first; ; chirp++) {
    const at = (chirp * CHIRP_PERIOD_SECONDS + offsetSeconds) / (1 - drift);
    const index = at * RATE - firstFrame;
    if (index >= length) break;
    if (index >= 0) placeChirp(samples, index);
  }

  let state = 5;
  for (let index = 0; index < length; index++) {
    state = (state * 1103515245 + 12345) % 2147483648;
    samples[index] += (state / 2147483648 - 0.5) * 0.01;
  }
  return { samples, firstFrame, sampleRate: RATE, dropouts: 0 };
}

function placeChirp(buffer: Float32Array, at: number): void {
  for (let index = Math.max(0, Math.ceil(at)); index < buffer.length; index++) {
    const progress = (index - at) / CHIRP_LENGTH;
    if (progress >= 1) break;
    const window = 0.5 * (1 - Math.cos(2 * Math.PI * progress));
    buffer[index] += 0.5 * window * Math.sin(chirpPhase(progress));
  }
}

/** Drive one measurement past the settling wait. */
async function measure(
  run: ReturnType<typeof useCalibrationRun>,
  playerId: string,
): Promise<boolean> {
  const pending = run.measure(playerId);
  await vi.advanceTimersByTimeAsync(1000);
  return await pending;
}

async function started() {
  const run = withScope(() => useCalibrationRun());
  run.selected.value = ["living", "kitchen"];
  expect(await run.begin()).toBe(true);
  return run;
}

beforeEach(() => {
  scopes = [];
  voided = ref(null);
  sessionLost = ref(null);
  vi.useFakeTimers();

  for (const fake of [
    ...Object.values(fakes.session),
    ...Object.values(fakes.capture),
  ])
    fake.mockReset();

  fakes.capture.open.mockResolvedValue({
    opened: true,
    sampleRate: RATE,
    constraints: null,
    wakeLock: null,
    error: null,
  });
  fakes.capture.record.mockResolvedValue(null);
  fakes.capture.close.mockResolvedValue(undefined);
  fakes.session.start.mockResolvedValue(true);
  fakes.session.solo.mockResolvedValue(true);
  fakes.session.stop.mockResolvedValue(undefined);
  fakes.session.apply.mockResolvedValue({ living: 12, kitchen: 0 });
});

afterEach(() => {
  for (const scope of scopes) scope.stop();
  vi.useRealTimers();
});

describe("useCalibrationRun", () => {
  it("will not start against fewer than two speakers", async () => {
    const run = withScope(() => useCalibrationRun());
    run.selected.value = ["living"];

    expect(await run.begin()).toBe(false);
    expect(fakes.capture.open).not.toHaveBeenCalled();
  });

  it("opens the microphone before taking the speakers over", async () => {
    const run = await started();

    // The microphone is what the whole run depends on, and a refusal after the
    // speakers were commandeered would leave them muted for nothing.
    expect(fakes.capture.open.mock.invocationCallOrder[0]).toBeLessThan(
      fakes.session.start.mock.invocationCallOrder[0],
    );
    expect(run.phase.value).toBe("walking");
  });

  it("gives the speakers back when the microphone was refused", async () => {
    fakes.capture.open.mockResolvedValue({
      opened: false,
      sampleRate: null,
      constraints: null,
      wakeLock: null,
      error: { name: "NotAllowedError", message: "Denied" },
    });
    const run = withScope(() => useCalibrationRun());
    run.selected.value = ["living", "kitchen"];

    expect(await run.begin()).toBe(false);
    expect(run.openError.value).toBe("NotAllowedError");
    expect(fakes.session.start).not.toHaveBeenCalled();
  });

  it("solos a speaker and lets it settle before recording", async () => {
    const run = await started();
    fakes.capture.record.mockResolvedValue(
      recordingAt({ startSeconds: 0, offsetSeconds: 0, drift: 0 }),
    );

    await measure(run, "living");

    expect(fakes.session.solo).toHaveBeenCalledWith("living");
    // The server unmutes the target and then mutes the others, so the first chirp
    // periods after a solo still carry the speaker that was audible before.
    expect(fakes.session.solo.mock.invocationCallOrder[0]).toBeLessThan(
      fakes.capture.record.mock.invocationCallOrder[0],
    );
    expect(run.visits.value).toHaveLength(1);
    expect(run.visits.value[0].found).toBeGreaterThanOrEqual(10);
  });

  it("asks for the first speaker again once the rest are done", async () => {
    const run = await started();
    fakes.capture.record.mockResolvedValue(
      recordingAt({ startSeconds: 0, offsetSeconds: 0, drift: 0 }),
    );

    await measure(run, "living");
    expect(run.needsBracket.value).toBe(false);
    expect(run.remaining.value).toEqual(["kitchen"]);

    await measure(run, "kitchen");
    expect(run.remaining.value).toEqual([]);
    expect(run.needsBracket.value).toBe(true);
  });

  it("recovers the speaker latencies from a real walk", async () => {
    const run = await started();
    const drift = 60e-6;

    for (const visit of [
      { startSeconds: 0, offsetSeconds: 0, player: "living" },
      { startSeconds: 30, offsetSeconds: 0.012, player: "kitchen" },
      { startSeconds: 60, offsetSeconds: 0, player: "living" },
    ]) {
      fakes.capture.record.mockResolvedValue(recordingAt({ ...visit, drift }));
      expect(await measure(run, visit.player)).toBe(true);
    }

    const fit = run.fit.value!;
    expect(fit.offsetsMs.living).toBeCloseTo(0, 6);
    expect(fit.offsetsMs.kitchen).toBeCloseTo(12, 1);
    expect(fit.rateErrorPpm).toBeCloseTo(60, 0);
    expect(fit.bracketSpanSeconds).toBeGreaterThan(50);
    expect(fit.residualMs).toBeLessThan(0.1);
    expect(run.trustworthy.value).toBe(true);
    // One repeated speaker sets the clock rate; it cannot also test it.
    expect(fit.bracketResidualMs).toBeNull();
    expect(run.verdict.value).toBe("pinned");
  });

  it("refuses to apply a run that was never bracketed", async () => {
    const run = await started();
    for (const visit of [
      { startSeconds: 0, offsetSeconds: 0, player: "living" },
      { startSeconds: 30, offsetSeconds: 0.012, player: "kitchen" },
    ]) {
      fakes.capture.record.mockResolvedValue(
        recordingAt({ ...visit, drift: 0 }),
      );
      await measure(run, visit.player);
    }

    // Without a second reading of one speaker there is nothing separating the
    // phone's clock drift from the latencies being measured.
    expect(run.fit.value!.bracketSpanSeconds).toBeNull();
    expect(run.verdict.value).toBe("unbracketed");
    expect(run.trustworthy.value).toBe(false);
    expect(await run.apply()).toBe(false);
    expect(fakes.session.apply).not.toHaveBeenCalled();
  });

  it("refuses to apply a run whose repeated readings disagree", async () => {
    const run = await started();
    run.selected.value = ["living", "kitchen"];
    for (const visit of [
      { startSeconds: 0, offsetSeconds: 0, player: "living" },
      { startSeconds: 30, offsetSeconds: 0.012, player: "kitchen" },
      { startSeconds: 60, offsetSeconds: 0, player: "living" },
      // Kitchen read 5 ms further out than it did the first time. With two
      // speakers repeated there is one constraint more than the clock rate can
      // absorb, so this finally shows up instead of vanishing into the rate.
      { startSeconds: 90, offsetSeconds: 0.017, player: "kitchen" },
    ]) {
      fakes.capture.record.mockResolvedValue(
        recordingAt({ ...visit, drift: 0 }),
      );
      await measure(run, visit.player);
    }

    expect(run.verdict.value).toBe("disagrees");
    expect(run.fit.value!.bracketResidualMs!).toBeGreaterThan(BRACKET_LIMIT_MS);
    expect(run.trustworthy.value).toBe(false);
    expect(await run.apply()).toBe(false);
  });

  it("cannot detect a repeat that shifted linearly, and does not pretend to", async () => {
    const run = await started();
    for (const visit of [
      { startSeconds: 0, offsetSeconds: 0, player: "living" },
      { startSeconds: 30, offsetSeconds: 0.012, player: "kitchen" },
      // The anchor reading 6 ms further out than at the start. With only this one
      // repeat the fit absorbs it into the clock rate exactly — 100 ppm, entirely
      // ordinary for a phone — and kitchen comes out 3 ms wrong.
      { startSeconds: 60, offsetSeconds: 0.006, player: "living" },
    ]) {
      fakes.capture.record.mockResolvedValue(
        recordingAt({ ...visit, drift: 0 }),
      );
      await measure(run, visit.player);
    }

    const fit = run.fit.value!;
    expect(fit.rateErrorPpm).toBeCloseTo(100, 0);
    expect(fit.offsetsMs.kitchen).toBeCloseTo(9, 0);
    // So no disagreement is reported, because there is genuinely none to see —
    // and the run says the rate was pinned rather than checked.
    expect(fit.bracketResidualMs).toBeNull();
    expect(run.verdict.value).toBe("pinned");
  });

  it("hands the offsets over once the bracket closes", async () => {
    const run = await started();
    for (const visit of [
      { startSeconds: 0, offsetSeconds: 0, player: "living" },
      { startSeconds: 30, offsetSeconds: 0.012, player: "kitchen" },
      { startSeconds: 60, offsetSeconds: 0, player: "living" },
    ]) {
      fakes.capture.record.mockResolvedValue(
        recordingAt({ ...visit, drift: 0 }),
      );
      await measure(run, visit.player);
    }

    expect(await run.apply()).toBe(true);
    expect(fakes.session.apply).toHaveBeenCalledWith(run.fit.value!.offsetsMs);
    expect(run.applied.value).toEqual({ living: 12, kitchen: 0 });
  });

  it("refuses to apply while a speaker has never been heard", async () => {
    const run = await started();
    for (const visit of [
      { startSeconds: 0, offsetSeconds: 0, player: "living" },
      { startSeconds: 60, offsetSeconds: 0, player: "living" },
    ]) {
      fakes.capture.record.mockResolvedValue(
        recordingAt({ ...visit, drift: 0 }),
      );
      await measure(run, visit.player);
    }
    const silence = recordingAt({
      startSeconds: 30,
      offsetSeconds: 0,
      drift: 0,
    });
    silence.samples.fill(0);
    fakes.capture.record.mockResolvedValue(silence);
    await measure(run, "kitchen");

    // kitchen contributed no arrivals, so it has no offset. Applying anyway would
    // re-normalise the speakers that do have one and leave kitchen where it was,
    // making the misalignment worse than before calibration.
    expect(run.fit.value!.offsetsMs).not.toHaveProperty("kitchen");
    expect(run.verdict.value).toBe("unmeasured");
    expect(run.trustworthy.value).toBe(false);
    expect(await run.apply()).toBe(false);
    expect(fakes.session.apply).not.toHaveBeenCalled();
  });

  it("will not accept two readings taken moments apart as a bracket", async () => {
    const run = await started();
    for (const visit of [
      { startSeconds: 0, offsetSeconds: 0, player: "living" },
      // Tapping "measure again" straight away: two readings of the anchor, but
      // over six seconds of what becomes a two minute run.
      { startSeconds: 6, offsetSeconds: 0, player: "living" },
      { startSeconds: 120, offsetSeconds: 0.012, player: "kitchen" },
    ]) {
      fakes.capture.record.mockResolvedValue(
        recordingAt({ ...visit, drift: 0 }),
      );
      await measure(run, visit.player);
    }

    // The clock rate would be fitted over 6 of 125 seconds, which pins it about as
    // well as not bracketing at all — so the walk keeps asking for the real one.
    expect(run.fit.value!.bracketSpanSeconds).toBeCloseTo(6, 0);
    expect(run.verdict.value).toBe("short_bracket");
    expect(run.trustworthy.value).toBe(false);
    expect(run.needsBracket.value).toBe(true);
    expect(await run.apply()).toBe(false);
  });

  it("accepts the bracket once it spans the walk", async () => {
    const run = await started();
    for (const visit of [
      { startSeconds: 0, offsetSeconds: 0, player: "living" },
      { startSeconds: 6, offsetSeconds: 0, player: "living" },
      { startSeconds: 120, offsetSeconds: 0.012, player: "kitchen" },
      { startSeconds: 180, offsetSeconds: 0, player: "living" },
    ]) {
      fakes.capture.record.mockResolvedValue(
        recordingAt({ ...visit, drift: 0 }),
      );
      await measure(run, visit.player);
    }

    expect(run.needsBracket.value).toBe(false);
    expect(run.trustworthy.value).toBe(true);
  });

  it("voids the run when the audio context stops, and measures no further", async () => {
    const run = await started();
    voided.value = "suspended";
    await vi.advanceTimersByTimeAsync(0);

    expect(run.phase.value).toBe("voided");
    expect(await measure(run, "living")).toBe(false);
    expect(fakes.session.solo).not.toHaveBeenCalled();
  });

  it("voids the run when the server session goes away", async () => {
    const run = await started();
    sessionLost.value = "expired";
    await vi.advanceTimersByTimeAsync(0);

    expect(run.phase.value).toBe("voided");
  });

  it("throws a voided run away rather than salvaging part of it", async () => {
    const run = await started();
    fakes.capture.record.mockResolvedValue(
      recordingAt({ startSeconds: 0, offsetSeconds: 0, drift: 0 }),
    );
    await measure(run, "living");
    voided.value = "suspended";
    await vi.advanceTimersByTimeAsync(0);

    await run.restart();

    // Arrivals from before the gap cannot be placed on the same timeline as
    // anything after it, so keeping any of them would only hide the problem.
    expect(run.visits.value).toEqual([]);
    expect(run.fit.value).toBeNull();
    expect(run.phase.value).toBe("picking");
    expect(fakes.session.stop).toHaveBeenCalled();
    expect(fakes.capture.close).toHaveBeenCalled();
  });

  it("keeps a reading that found nothing, so its confidence can be seen", async () => {
    const run = await started();
    const silence = recordingAt({
      startSeconds: 0,
      offsetSeconds: 0,
      drift: 0,
      seconds: 5.5,
    });
    silence.samples.fill(0);
    fakes.capture.record.mockResolvedValue(silence);

    expect(await measure(run, "living")).toBe(false);
    expect(run.visits.value).toHaveLength(1);
    expect(run.visits.value[0].found).toBe(0);
    expect(run.phase.value).toBe("walking");
  });

  it("releases everything when the run is finished", async () => {
    const run = await started();

    await run.finish();

    expect(fakes.session.stop).toHaveBeenCalledOnce();
    expect(fakes.capture.close).toHaveBeenCalledOnce();
  });
});
