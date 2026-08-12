/**
 * Drives the server side of a calibration run.
 *
 * The server holds one session at a time: it takes the chosen speakers over,
 * starts the chirp track on a single uninterrupted stream, and makes one speaker
 * at a time audible. This composable is the only place that talks to it, so the
 * view never has to know the command names or the order they have to come in.
 *
 * The session tears itself down after a period of inactivity, and only the
 * commands that change it — starting, soloing, applying — put that timer back.
 * Reading the session does not. So the run is kept alive by re-soloing whichever
 * speaker is already soloed, which the server treats as a no-op on the audio
 * path: it sends no mute command to the soloed speaker, only to the others, and
 * those are muted already.
 *
 * Leaning on a side effect of `solo_player` to reset a timer is a workaround, and
 * the right home for a keepalive is the server. Until there is one, the nudge is
 * at least kept away from anything it could disturb: the timer restarts on every
 * command that reaches the server, so it can only fire after a long spell of the
 * user walking or standing still. A measurement is always preceded by a solo, so
 * a nudge can never land inside one.
 *
 * A session that has gone anyway is reported rather than swallowed. Every command
 * suppresses the global error toast and reports through `lost` instead, because
 * "the session expired while you were walking" needs to be said in those terms
 * and needs to stop the flow rather than fail one button.
 */

import api from "@/plugins/api";
import type {
  CalibrationApplyResult,
  CalibrationPlayer,
  CalibrationSessionState,
} from "@/plugins/api/interfaces";
import { computed, onScopeDispose, ref } from "vue";

/**
 * How often the session is nudged so its inactivity timeout cannot fire.
 *
 * The server allows 900 seconds, which is generous enough to walk a large house;
 * nudging at a third of that leaves room for two missed nudges before a session
 * would actually be lost.
 */
const KEEPALIVE_MS = 300_000;

/** Why the run cannot continue against the server. */
export type SessionLoss = "expired" | "failed";

export function useCalibrationSession() {
  const players = ref<CalibrationPlayer[]>([]);
  const state = ref<CalibrationSessionState | null>(null);
  const lost = ref<SessionLoss | null>(null);

  let keepalive: ReturnType<typeof setInterval> | null = null;
  // Counted rather than flagged: a keepalive nudge overlapping a user action must
  // not clear the flag while the other command is still in flight.
  const inFlight = ref(0);
  const busy = computed(() => inFlight.value > 0);

  onScopeDispose(() => {
    void stop();
  });

  /** The Sendspin speakers a session can be run against. */
  async function loadPlayers(): Promise<boolean> {
    const eligible = await send<CalibrationPlayer[]>(
      "sendspin_sync/eligible_players",
    );
    if (!eligible) return false;
    players.value = eligible;
    return true;
  }

  /** Adopt a session the server is already running, if there is one. */
  async function refresh(): Promise<CalibrationSessionState | null> {
    const current = await send<CalibrationSessionState | null>(
      "sendspin_sync/session",
    );
    state.value = current ?? null;
    return state.value;
  }

  /**
   * Take the given speakers over and start the chirp track.
   *
   * `force` takes over speakers that are busy with the user's own content, which
   * the caller is expected to have warned about first.
   */
  async function start(playerIds: string[], force = false): Promise<boolean> {
    const started = await send<CalibrationSessionState>(
      "sendspin_sync/start_session",
      { player_ids: playerIds, force },
    );
    if (!started) return false;

    state.value = started;
    lost.value = null;
    startKeepalive();
    return true;
  }

  /** Make one speaker of the session audible, leaving the stream running. */
  async function solo(playerId: string): Promise<boolean> {
    const soloed = await send<CalibrationSessionState>(
      "sendspin_sync/solo_player",
      { player_id: playerId },
    );
    if (!soloed) return false;

    state.value = soloed;
    // This command re-armed the server's timer, so the nudge waits again from
    // here — which is what keeps it out of the measurement that follows.
    startKeepalive();
    return true;
  }

  /**
   * Hand the measured offsets over, and return the delay worked out per speaker.
   *
   * The offsets are relative: the phone measures every speaker against a shared,
   * arbitrary baseline, so only the differences between them carry meaning. The
   * server normalises them against the delays the speakers already carry, which
   * is what makes re-running calibration converge instead of drift.
   *
   * Every speaker gets a delay; the split says which of them the server was able
   * to write, and the two halves do not mean the same thing. An `applied` figure
   * is absolute and already in place. A `manual` figure is an increment: the
   * device is still applying a delay of its own, which this run measured but the
   * server will not guess at, so the number has to be added to it rather than
   * written over it.
   */
  async function apply(
    offsetsMs: Record<string, number>,
  ): Promise<CalibrationApplyResult | null> {
    const result = await send<CalibrationApplyResult>(
      "sendspin_sync/apply_measurements",
      { offsets_ms: offsetsMs },
    );
    if (result) startKeepalive();
    return result ?? null;
  }

  /** End the session and give every speaker back. */
  async function stop(): Promise<void> {
    stopKeepalive();
    if (!state.value) return;
    state.value = null;
    // Best effort: a session the server has already dropped is the outcome
    // wanted here, so a failure to stop it is not worth reporting.
    await api
      .sendCommand("sendspin_sync/stop_session", undefined, {
        suppressGlobalError: true,
      })
      .catch(() => undefined);
  }

  /** Clear the fault from a run that has been thrown away. */
  function reset(): void {
    lost.value = null;
    state.value = null;
  }

  /**
   * Send one command, reporting a lost session rather than throwing.
   *
   * Returns `undefined` on failure. A command that fails while the server no
   * longer has a session is an expiry — the case the user has to be told about
   * plainly — and anything else is reported as a plain failure.
   */
  async function send<Result>(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<Result | undefined> {
    inFlight.value++;
    try {
      return await api.sendCommand<Result>(command, args, {
        suppressGlobalError: true,
      });
    } catch (error) {
      console.error(`[Sendspin Sync] ${command} failed`, error);
      lost.value = (await sessionGone()) ? "expired" : "failed";
      if (lost.value === "expired") {
        state.value = null;
        stopKeepalive();
      }
      return undefined;
    } finally {
      inFlight.value--;
    }
  }

  /** Whether the server has stopped holding a session at all. */
  async function sessionGone(): Promise<boolean> {
    try {
      const current = await api.sendCommand<CalibrationSessionState | null>(
        "sendspin_sync/session",
        undefined,
        { suppressGlobalError: true },
      );
      return !current;
    } catch {
      // The server could not be asked, so this is not an expiry.
      return false;
    }
  }

  function startKeepalive(): void {
    stopKeepalive();
    keepalive = setInterval(() => void nudge(), KEEPALIVE_MS);
  }

  function stopKeepalive(): void {
    if (keepalive === null) return;
    clearInterval(keepalive);
    keepalive = null;
  }

  /**
   * Push the session's inactivity timeout back.
   *
   * Re-soloing the speaker that is already soloed is what re-arms it. Before the
   * first speaker has been soloed there is nothing to re-solo, and reading the
   * session is enough to notice it has gone.
   */
  async function nudge(): Promise<void> {
    const soloed = state.value?.soloed_player_id;
    if (soloed) await solo(soloed);
    else await refresh();
  }

  return {
    players,
    state,
    lost,
    busy,
    loadPlayers,
    refresh,
    start,
    solo,
    apply,
    stop,
    reset,
  };
}
