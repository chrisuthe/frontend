import { useCalibrationSession } from "@/composables/sendspin-sync/useCalibrationSession";
import type { CalibrationSessionState } from "@/plugins/api/interfaces";
import { effectScope } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendCommand } = vi.hoisted(() => ({ sendCommand: vi.fn() }));

vi.mock("@/plugins/api", () => ({ default: { sendCommand } }));

const PLAYERS = [
  { player_id: "living", name: "Living room", busy: false },
  { player_id: "kitchen", name: "Kitchen", busy: true },
];

function sessionState(
  overrides: Partial<CalibrationSessionState> = {},
): CalibrationSessionState {
  return {
    anchor_player_id: "living",
    queue_id: "queue-1",
    player_ids: ["living", "kitchen"],
    soloed_player_id: null,
    streaming: true,
    ...overrides,
  };
}

let scopes: ReturnType<typeof effectScope>[] = [];

function withScope<T>(factory: () => T): T {
  const scope = effectScope();
  scopes.push(scope);
  return scope.run(factory)!;
}

/** The arguments of every call to one command, oldest first. */
function callsTo(command: string): unknown[][] {
  return sendCommand.mock.calls
    .filter((call) => call[0] === command)
    .map((call) => call.slice(1));
}

beforeEach(() => {
  scopes = [];
  sendCommand.mockReset();
  // The real command always hands back a promise, including for the teardown
  // `stop_session` a test has not queued a result for.
  sendCommand.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  for (const scope of scopes) scope.stop();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("useCalibrationSession", () => {
  it("lists the speakers a session can run against", async () => {
    sendCommand.mockResolvedValue(PLAYERS);
    const session = withScope(() => useCalibrationSession());

    expect(await session.loadPlayers()).toBe(true);
    expect(session.players.value).toEqual(PLAYERS);
    expect(callsTo("sendspin_sync/eligible_players")).toHaveLength(1);
  });

  it("starts a session over the speakers in the order they were picked", async () => {
    sendCommand.mockResolvedValue(sessionState());
    const session = withScope(() => useCalibrationSession());

    expect(await session.start(["living", "kitchen"], true)).toBe(true);
    expect(callsTo("sendspin_sync/start_session")[0][0]).toEqual({
      player_ids: ["living", "kitchen"],
      force: true,
    });
    expect(session.state.value).toEqual(sessionState());
  });

  it("solos one speaker without disturbing the stream", async () => {
    sendCommand.mockResolvedValue(
      sessionState({ soloed_player_id: "kitchen" }),
    );
    const session = withScope(() => useCalibrationSession());

    expect(await session.solo("kitchen")).toBe(true);
    expect(callsTo("sendspin_sync/solo_player")[0][0]).toEqual({
      player_id: "kitchen",
    });
    expect(session.state.value?.soloed_player_id).toBe("kitchen");
  });

  it("passes the measured offsets through untouched", async () => {
    // The offsets are relative and the server does the normalising: pre-shifting
    // or flipping them here would double the correction it then applies.
    const offsets = { living: 0, kitchen: -7.25 };
    sendCommand.mockResolvedValue({ living: 8, kitchen: 0 });
    const session = withScope(() => useCalibrationSession());

    expect(await session.apply(offsets)).toEqual({ living: 8, kitchen: 0 });
    expect(callsTo("sendspin_sync/apply_measurements")[0][0]).toEqual({
      offsets_ms: offsets,
    });
  });

  it("reports an expired session rather than failing one button", async () => {
    const session = withScope(() => useCalibrationSession());
    sendCommand.mockResolvedValueOnce(sessionState());
    await session.start(["living", "kitchen"]);

    // The walk took too long: the server gave the speakers back, so soloing fails
    // and asking for the session confirms there is none.
    sendCommand.mockRejectedValueOnce(new Error("No calibration session"));
    sendCommand.mockResolvedValueOnce(null);

    expect(await session.solo("kitchen")).toBe(false);
    expect(session.lost.value).toBe("expired");
    expect(session.state.value).toBeNull();
  });

  it("separates a server that broke from a session that expired", async () => {
    const session = withScope(() => useCalibrationSession());
    sendCommand.mockResolvedValueOnce(sessionState());
    await session.start(["living", "kitchen"]);

    // The command failed but the session is still there, so this is not an expiry.
    sendCommand.mockRejectedValueOnce(new Error("Player unavailable"));
    sendCommand.mockResolvedValueOnce(sessionState());

    expect(await session.solo("kitchen")).toBe(false);
    expect(session.lost.value).toBe("failed");
    expect(session.state.value).not.toBeNull();
  });

  it("re-solos the current speaker so the session cannot time out", async () => {
    vi.useFakeTimers();
    const session = withScope(() => useCalibrationSession());
    sendCommand.mockResolvedValue(
      sessionState({ soloed_player_id: "kitchen" }),
    );
    await session.start(["living", "kitchen"]);
    await session.solo("kitchen");

    const before = callsTo("sendspin_sync/solo_player").length;
    await vi.advanceTimersByTimeAsync(300_000);

    // Only the commands that change a session put its inactivity timer back, and
    // re-soloing the speaker that is already soloed is a no-op on the audio path.
    expect(callsTo("sendspin_sync/solo_player").length).toBe(before + 1);
  });

  it("reads the session when there is nothing soloed to re-solo yet", async () => {
    vi.useFakeTimers();
    const session = withScope(() => useCalibrationSession());
    sendCommand.mockResolvedValue(sessionState());
    await session.start(["living", "kitchen"]);

    await vi.advanceTimersByTimeAsync(300_000);

    expect(callsTo("sendspin_sync/session")).toHaveLength(1);
    expect(callsTo("sendspin_sync/solo_player")).toHaveLength(0);
  });

  it("stops nudging a session it has already lost", async () => {
    vi.useFakeTimers();
    const session = withScope(() => useCalibrationSession());
    sendCommand.mockResolvedValueOnce(
      sessionState({ soloed_player_id: "living" }),
    );
    await session.start(["living", "kitchen"]);

    sendCommand.mockRejectedValueOnce(new Error("gone"));
    sendCommand.mockResolvedValueOnce(null);
    await session.solo("living");
    expect(session.lost.value).toBe("expired");

    sendCommand.mockClear();
    await vi.advanceTimersByTimeAsync(900_000);
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("gives the speakers back, and does not report a stop that failed", async () => {
    const session = withScope(() => useCalibrationSession());
    sendCommand.mockResolvedValueOnce(sessionState());
    await session.start(["living", "kitchen"]);

    sendCommand.mockRejectedValueOnce(new Error("already gone"));
    await session.stop();

    expect(callsTo("sendspin_sync/stop_session")).toHaveLength(1);
    expect(session.state.value).toBeNull();
    // A session the server has already dropped is the outcome wanted here.
    expect(session.lost.value).toBeNull();
  });

  it("does not stop a session it never started", async () => {
    const session = withScope(() => useCalibrationSession());

    await session.stop();

    expect(callsTo("sendspin_sync/stop_session")).toHaveLength(0);
  });

  it("stops the session when its scope goes away", async () => {
    const scope = effectScope();
    const session = scope.run(() => useCalibrationSession())!;
    sendCommand.mockResolvedValue(sessionState());
    await session.start(["living", "kitchen"]);

    sendCommand.mockClear();
    scope.stop();
    await Promise.resolve();

    expect(callsTo("sendspin_sync/stop_session")).toHaveLength(1);
  });
});
