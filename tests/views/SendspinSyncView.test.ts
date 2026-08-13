import SendspinSyncResults from "@/components/sendspin-sync/SendspinSyncResults.vue";
import { CHIRP_PERIOD_SECONDS } from "@/helpers/sendspin-sync/chirp";
import type { CalibrationApplyResult } from "@/plugins/api/interfaces";
import SendspinSyncView from "@/views/SendspinSyncView.vue";
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { routeLeaveGuards, run, toastSuccess } = vi.hoisted(() => ({
  routeLeaveGuards: [] as (() => unknown)[],
  toastSuccess: vi.fn(),
  run: {
    loadPlayers: vi.fn(),
    refresh: vi.fn(),
    begin: vi.fn(),
    measure: vi.fn(),
    discard: vi.fn(),
    apply: vi.fn(),
    finish: vi.fn(),
    restart: vi.fn(),
  },
}));

vi.mock("vue-router", () => ({
  onBeforeRouteLeave: (guard: () => unknown) => routeLeaveGuards.push(guard),
}));

vi.mock("vue-sonner", () => ({
  toast: { success: toastSuccess, error: vi.fn() },
}));

vi.mock("@/composables/sendspin-sync/useCalibrationRun", () => ({
  BRACKET_LIMIT_MS: 1,
  SCATTER_LIMIT_MS: 1,
  useCalibrationRun: () => state,
}));

// The probe owns a microphone and thirty seconds of capture; none of that is what
// these tests are about.
vi.mock("@/components/sendspin-sync/SendspinSyncProbe.vue", () => ({
  default: { name: "SendspinSyncProbe", template: "<div />" },
}));

const PLAYERS = [
  { player_id: "living", name: "Living room", busy: false, adjustable: true },
  { player_id: "kitchen", name: "Kitchen", busy: true, adjustable: true },
];

let state: ReturnType<typeof makeState>;

function makeState() {
  return {
    players: ref(PLAYERS),
    sessionState: ref<unknown>(null),
    sessionLost: ref<string | null>(null),
    busy: ref(false),
    phase: ref("picking"),
    selected: ref<string[]>([]),
    visits: ref<unknown[]>([]),
    measuringPlayerId: ref<string | null>(null),
    anchor: ref<string | null>(null),
    remaining: ref<string[]>([]),
    needsBracket: ref(false),
    needsCheck: ref(false),
    fit: ref<unknown>(null),
    loss: ref({ dropouts: 0, worstFraction: 0 }),
    spacingSeconds: ref<number | null>(CHIRP_PERIOD_SECONDS),
    verdict: ref<string | null>(null),
    trustworthy: ref(false),
    crossChecked: ref(false),
    applyResult: ref<CalibrationApplyResult | null>(null),
    openError: ref<string | null>(null),
    ...run,
  };
}

let wrappers: ReturnType<typeof mount>[] = [];

/**
 * Mount the view, and remember it so the test tears it down.
 *
 * The view listens for `pagehide` on the window, so a wrapper left mounted would
 * still be handing speakers back during the next test.
 *
 * `$t` is mocked for the child components, which take it from the global. The view
 * itself imports `$t` directly, so its own strings resolve against the real
 * `en.json` — which is why the assertions below read as English and why a renamed
 * key fails here rather than turning into a blank on a phone.
 */
function mountView() {
  const wrapper = mount(SendspinSyncView, {
    global: { mocks: { $t: (key: string) => key } },
  });
  wrappers.push(wrapper);
  return wrapper;
}

beforeEach(() => {
  wrappers = [];
  routeLeaveGuards.length = 0;
  state = makeState();
  for (const fake of Object.values(run)) fake.mockReset();
  run.begin.mockResolvedValue(true);
  run.apply.mockResolvedValue(true);
  for (const name of ["loadPlayers", "refresh", "finish", "restart"] as const)
    run[name].mockResolvedValue(undefined);
});

afterEach(() => {
  for (const wrapper of wrappers) wrapper.unmount();
  vi.restoreAllMocks();
});

describe("SendspinSyncView", () => {
  it("looks for an existing session and the eligible speakers on arrival", async () => {
    mountView();
    await Promise.resolve();

    expect(run.refresh).toHaveBeenCalledOnce();
    expect(run.loadPlayers).toHaveBeenCalledOnce();
  });

  it("offers the speaker picker before anything has started", () => {
    const wrapper = mountView();

    expect(wrapper.text()).toContain(
      "providers.sendspin_sync.calibration.pick.title",
    );
    expect(wrapper.text()).not.toContain(
      "providers.sendspin_sync.calibration.walk.step.start.title",
    );
  });

  it("hands the speakers back when the route is left", async () => {
    mountView();
    expect(routeLeaveGuards).toHaveLength(1);

    await routeLeaveGuards[0]();

    // The session's own inactivity timeout is a backstop against a phone that
    // vanished, not this flow's cleanup path: leaving must give the speakers back
    // rather than leave them muted for fifteen minutes.
    expect(run.restart).toHaveBeenCalledOnce();
  });

  it("hands the speakers back when the page goes away", () => {
    mountView();

    window.dispatchEvent(new Event("pagehide"));

    expect(run.restart).toHaveBeenCalledOnce();
  });

  it("stops listening for the page going away once it is unmounted", () => {
    const wrapper = mountView();
    wrapper.unmount();
    run.restart.mockClear();

    window.dispatchEvent(new Event("pagehide"));

    expect(run.restart).not.toHaveBeenCalled();
  });

  it("shows the walk once a run has started", async () => {
    state.phase.value = "walking";
    state.selected.value = ["living", "kitchen"];
    state.anchor.value = "living";
    const wrapper = mountView();
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain(
      "providers.sendspin_sync.calibration.walk.step.start.title",
    );
    expect(wrapper.text()).toContain("Living room");
  });

  it("replaces the flow with the reason a run was voided", async () => {
    state.phase.value = "voided";
    const wrapper = mountView();
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("This run has to be thrown away");
    expect(wrapper.text()).not.toContain(
      "providers.sendspin_sync.calibration.pick.title",
    );
    expect(wrapper.find('[role="status"]').exists()).toBe(true);
  });

  it("names an expired session rather than blaming the microphone", async () => {
    state.phase.value = "voided";
    state.sessionLost.value = "expired";
    const wrapper = mountView();
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("The calibration session timed out");
  });

  it("says another calibration is running instead of cutting it off", async () => {
    state.sessionState.value = { anchor_player_id: "living" };
    const wrapper = mountView();
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("A calibration is already running");
    // The server holds one session at a time, so starting would be refused.
    expect(wrapper.text()).toContain("End the running calibration");
  });

  it("keeps the diagnostics reachable without putting them in the way", () => {
    const wrapper = mountView();

    expect(wrapper.text()).toContain("Microphone diagnostics");
  });

  it("says the delays were updated when the server wrote some", async () => {
    await applyFrom({ applied: { living: 0 }, manual: { kitchen: 12 } });

    expect(toastSuccess).toHaveBeenCalledWith("Speaker delays updated.");
  });

  it("does not claim an update when nothing could be written", async () => {
    // Every speaker was measured and normalised; none of them took the delay. A
    // toast saying otherwise is the one place all the care below leaks out.
    await applyFrom({ applied: {}, manual: { living: 0, kitchen: 12 } });

    expect(toastSuccess).toHaveBeenCalledWith(
      "Delays worked out. Add each one to the speaker's current delay.",
    );
  });
});

/** Walk the view as far as the results panel and press Apply. */
async function applyFrom(result: CalibrationApplyResult) {
  state.phase.value = "walking";
  state.selected.value = ["living", "kitchen"];
  state.anchor.value = "living";
  state.trustworthy.value = true;
  state.verdict.value = "pinned";
  state.fit.value = {
    offsetsMs: { living: 0, kitchen: 12.345 },
    rateRatio: 1.00004,
    rateErrorPpm: 40,
    residualMs: 0.03,
    scatterMs: { living: 0.02, kitchen: 0.04 },
    bracketSpanSeconds: 90,
    bracketResidualMs: null,
    runSpanSeconds: 100,
    visits: [],
    used: 30,
    rejected: 1,
  };
  run.apply.mockImplementation(async () => {
    state.applyResult.value = result;
    return true;
  });

  const wrapper = mountView();
  await wrapper.vm.$nextTick();
  await wrapper
    .findComponent(SendspinSyncResults)
    .find("button")
    .trigger("click");
  await wrapper.vm.$nextTick();
}
